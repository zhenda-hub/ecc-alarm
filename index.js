const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');

// 任务URL配置
const TASK_URLS = {
    day: 'https://paas.hxmis.com/o/eccdigital/onduty/onduty_task/?role_type=服务台&duty_type=白班',
    night: 'https://paas.hxmis.com/o/eccdigital/onduty/onduty_task/?role_type=服务台&duty_type=夜班'
    // day: 'https://baidu.com',
    // night: 'https://google.com'
};

// 日志功能相关变量
// let currentLogFile = '';
let logStream = null;

// 从远程API获取任务数据
function fetchTasksFromUrl(url) {
    return new Promise((resolve, reject) => {
        writeLog('INFO', `开始请求 API: ${url}`);
        const startTime = Date.now();

        https.get(url, {
            rejectUnauthorized: false  // 如果需要忽略SSL证书验证
        }, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const endTime = Date.now();
                    const elapsed = endTime - startTime;
                    writeLog('INFO', `API响应完成，耗时: ${elapsed}ms`);

                    const result = JSON.parse(data);
                    writeLog('DEBUG', `API响应内容: ${JSON.stringify(result)}`);

                    if (result.code === 200) {
                        const tasks = result.task || [];
                        writeLog('INFO', `成功获取 ${tasks.length} 条任务`);
                        resolve(tasks);
                    } else {
                        const error = new Error(`API返回错误: ${result.code}`);
                        writeLog('ERROR', `API请求失败: ${error.message}`);
                        reject(error);
                    }
                } catch (err) {
                    writeLog('ERROR', `解析API响应失败: ${err.message}`);
                    reject(err);
                }
            });
        }).on('error', (err) => {
            writeLog('ERROR', `API请求错误: ${err.message}`);
            reject(err);
        });
    });
}

// 同时获取白班和夜班任务并合并
async function fetchAllTasks() {
    try {
        writeLog('INFO', '开始获取任务数据');
        const startTime = Date.now();
        
        const [dayTasks, nightTasks] = await Promise.all([
            fetchTasksFromUrl(TASK_URLS.day),
            fetchTasksFromUrl(TASK_URLS.night)
        ]);
        
        // 确保返回的是数组
        const dayTasksArray = Array.isArray(dayTasks) ? dayTasks : [];
        const nightTasksArray = Array.isArray(nightTasks) ? nightTasks : [];
        
        const allTasks = [...dayTasksArray, ...nightTasksArray];
        const endTime = Date.now();
        
        writeLog('INFO', `任务获取完成 - 总耗时: ${endTime - startTime}ms`);
        writeLog('INFO', `任务统计:\n` + 
            `- 白班任务: ${dayTasksArray.length} 条\n` +
            `- 夜班任务: ${nightTasksArray.length} 条\n` +
            `- 总任务数: ${allTasks.length} 条`);
        
        // 记录详细的任务信息
        writeLog('DEBUG', '完整任务列表: ' + JSON.stringify(allTasks, null, 2));
        
        return {
            tasks: allTasks,
            lastUpdate: new Date().toISOString()
        };
    } catch (error) {
        writeLog('ERROR', `获取任务失败: ${error.message}`);
        writeLog('ERROR', `错误详情: ${error.stack || '无堆栈信息'}`);
        
        // 尝试加载现有配置
        try {
            const configPath = getConfigPath();
            if (fs.existsSync(configPath)) {
                const existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                writeLog('WARN', '使用现有配置文件');
                return existingConfig;
            }
        } catch (readError) {
            writeLog('ERROR', `读取现有配置失败: ${readError.message}`);
        }
        
        throw error;
    }
}

// 获取日志文件路径
function getLogFilePath() {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1); // 设置为本周一
    const weekStartStr = weekStart.toISOString().split('T')[0];
    
    // 在开发环境使用项目目录，在生产环境使用用户数据目录
    const baseDir = !app.isPackaged ? 
        path.join(__dirname, 'logs') : 
        path.join(app.getPath('userData'), 'logs');
    
    // 确保日志目录存在
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    
    const logPath = path.join(baseDir, `${weekStartStr}.log`);
    // console.log('日志文件路径:', logPath); // 添加调试输出
    return logPath;
}

// 写入日志
function writeLog(type, message) {
    console.log(`准备写入日志: [${type}] ${message}`); // 调试输出
    
    try {
        const logPath = getLogFilePath();
        const now = new Date().toISOString();
        const logMessage = `[${now}] [${type}] ${message}\n`;
        
        // 直接使用同步写入方式
        fs.appendFileSync(logPath, logMessage, 'utf8');
        console.log('日志写入成功'); // 调试输出
        
    } catch (error) {
        console.error('写入日志失败:', error);
        console.error('错误详情:', {
            error: error.message,
            stack: error.stack,
            path: getLogFilePath()
        });
    }
}

let mainWindow;
let notificationWindow = null;
// let hiddenNotificationWindow = null;  // 预加载的通知窗口
let notificationQueue = [];
let config = null;
let dailyFetchTimeout = null; // 每日任务获取定时器

// 创建并配置主应用窗口
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 350,
        height: 550,
        show: true, // 修改：立即显示窗口
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    // 加载首页
    mainWindow.loadFile('index.html');
    
    // app 菜单配置
    const isMac = process.platform === 'darwin';
    const menuTemplate = [
        ...(isMac ? [{
            label: app.getName(),
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideothers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        {
            label: '功能',
            submenu: [
                {
                    label: '发送测试通知',
                    accelerator: 'CmdOrCtrl+T',
                    click: () => {
                        addNotification('这是一个测试通知\n时间: ' + new Date().toLocaleString());
                    }
                }
            ]
        },
        {
            label: '配置',
            submenu: [
                {
                    label: '刷新任务配置',
                    accelerator: 'CmdOrCtrl+R',
                    click: async () => {
                        try {
                            await loadConfig();
                            require('electron').dialog.showMessageBox(mainWindow, {
                                type: 'info',
                                title: '配置更新成功',
                                message: `已成功获取 ${config.tasks.length} 条任务`,
                                detail: `更新时间: ${new Date().toLocaleString()}`
                            });
                        } catch (error) {
                            require('electron').dialog.showErrorBox(
                                '配置更新失败',
                                `无法获取最新任务: ${error.message}`
                            );
                        }
                    }
                },
                {
                    label: '查看当前配置',
                    click: () => {
                        const configPath = getConfigPath();
                        writeLog('INFO', '打开配置缓存');
                        require('electron').shell.showItemInFolder(configPath);
                    }
                },
                { type: 'separator' },
                {
                    label: '上次更新时间',
                    enabled: false,
                    click: () => {}
                }
            ]
        },
        {
            label: '帮助',
            submenu: [
                {
                    label: '打开日志目录',
                    click: () => {
                        const logsDir = !app.isPackaged ? 
                            path.join(__dirname, 'logs') : 
                            path.join(app.getPath('userData'), 'logs');
                        writeLog('INFO', '打开日志目录');
                        require('electron').shell.openPath(logsDir);
                    }
                },
                {
                    label: '使用说明',
                    click: () => {
                        writeLog('INFO', '显示使用说明');
                        require('electron').dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: '使用说明',
                            message: 'ECC 桌面提醒系统使用说明',
                            detail: `1. 配置文件位置：
- Windows: %APPDATA%\\ecc-alarm\\config.json
- Linux: ~/.config/ecc-alarm/config.json
- macOS: ~/Library/Application Support/ecc-alarm/config.json

2. 配置文件格式：
- 支持每日定时通知
- 支持间隔重复通知
- 通知内容支持换行

`
// 3. 日志文件：
// - 按周自动分割
// - 记录所有操作和通知状态
                        });
                    }
                },
                {
                    label: '快捷键说明',
                    click: () => {
                        writeLog('INFO', '显示快捷键说明');
                        require('electron').dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: '快捷键说明',
                            message: '快捷键列表',
                            detail: `Ctrl/Cmd + T: 发送测试通知
Ctrl/Cmd + R: 重新加载配置
Ctrl/Cmd + Q: 退出程序（Windows）`
                        });
                    }
                },
                { type: 'separator' },
                {
                    label: '关于',
                    click: () => {
                        writeLog('INFO', '显示关于信息');
                        require('electron').dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: '关于',
                            message: 'ECC 桌面提醒系统',
                            detail: `版本: ${app.getVersion()}\n作者: zhangzhenda\n\n一个简单而强大的桌面提醒工具。`
                        });
                    }
                },
                ...(!isMac ? [
                    { type: 'separator' },
                    {
                        label: '退出',
                        accelerator: 'CmdOrCtrl+Q',
                        click: () => {
                            cleanup();
                            app.quit();
                        }
                    }
                ] : [])
            ]
        }
    ];
    
    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

// 跨平台配置文件路径
function getConfigPath() {
    // 开发环境
    if (!app.isPackaged) {
        return path.join(__dirname, 'config.json');
    }
    
    // 生产环境 - 使用系统相应的用户数据目录
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'config.json');
}

// 加载配置
async function loadConfig() {
    writeLog('INFO', '开始加载配置');
    try {
        const taskData = await fetchAllTasks();
        
        // 确保 taskData 中包含必要的字段
        if (!taskData || !taskData.tasks) {
            throw new Error('获取到的任务数据格式不正确');
        }
        
        config = {
            lastUpdate: new Date().toISOString(),
            tasks: taskData.tasks || [],
            settings: {
                backgroundColor: '#c62828',
                windowScale: 'fullscreen'
            }
        };
        
        // 保存最新配置到缓存
        const configPath = getConfigPath();
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        
        writeLog('INFO', `配置更新成功，共 ${config.tasks.length} 条任务`);
        return config;
    } catch (error) {
        writeLog('ERROR', `更新配置失败: ${error.message}`);
        // 如果更新失败，尝试加载缓存的配置
        try {
            const configPath = getConfigPath();
            if (fs.existsSync(configPath)) {
                const cachedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                writeLog('WARN', '使用缓存配置');
                config = cachedConfig;
                return config;
            }
        } catch (cacheError) {
            writeLog('ERROR', `加载缓存配置失败: ${cacheError.message}`);
        }
        throw error;
    }
}

// 跨平台默认配置复制
// function copyDefaultConfigFromResources() {
//     let defaultConfigPath;
    
//     if (app.isPackaged) {
//         // 生产环境：从资源目录读取
//         defaultConfigPath = path.join(process.resourcesPath, 'config.json');
//     } else {
//         // 开发环境：从项目目录读取
//         defaultConfigPath = path.join(__dirname, 'config.json');
//     }
    
//     const userConfigPath = getConfigPath();
    
//     try {
//         if (fs.existsSync(defaultConfigPath)) {
//             // 确保用户数据目录存在
//             const userDataDir = path.dirname(userConfigPath);
//             if (!fs.existsSync(userDataDir)) {
//                 fs.mkdirSync(userDataDir, { recursive: true });
//             }
            
//             // 复制配置文件
//             fs.copyFileSync(defaultConfigPath, userConfigPath);
//             console.log('默认配置文件已复制到:', userConfigPath);
            
//             // 重新加载
//             loadConfig();
//         } else {
//             console.log('未找到默认配置文件，创建内置配置');
//             createDefaultConfig();
//         }
//     } catch (error) {
//         console.error('复制默认配置失败:', error);
//         createDefaultConfig();
//     }
// }

// function createDefaultConfig() {
//     const defaultConfig = {
//         "notifications": [
//             {
//                 "id": "morning_reminder",
//                 "title": "晨间提醒",
//                 "message": "新的一天开始了！\n请检查今日工作计划",
//                 "time": "09:00",
//                 "enabled": true,
//                 "repeat": "daily"
//             },
//             {
//                 "id": "lunch_break",
//                 "title": "午餐休息",
//                 "message": "该休息一下了！\n记得按时吃午餐，保持健康",
//                 "time": "12:00",
//                 "enabled": true,
//                 "repeat": "daily"
//             },
//             {
//                 "id": "afternoon_reminder",
//                 "title": "下午提醒",
//                 "message": "下午时光，继续加油！\n记得多喝水，保护眼睛",
//                 "time": "15:00",
//                 "enabled": true,
//                 "repeat": "daily"
//             }
//         ],
//         "settings": {
//             "defaultInterval": 30,
//             "timezone": "Asia/Shanghai",
//             "enableSound": true,
//             "testMode": false
//         }
//     };
    
//     try {
//         const configPath = getConfigPath();
//         const configDir = path.dirname(configPath);
        
//         if (!fs.existsSync(configDir)) {
//             fs.mkdirSync(configDir, { recursive: true });
//             writeLog('INFO', '创建配置目录', { path: configDir });
//         }
        
//         fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
//         config = defaultConfig;
//         writeLog('INFO', '创建默认配置', {
//             path: configPath,
//             notificationCount: defaultConfig.notifications.length,
//             settings: defaultConfig.settings
//         });
//         setupScheduledNotifications();
//     } catch (error) {
//         writeLog('ERROR', '创建配置文件失败', {
//             path: getConfigPath(),
//             error: error.message
//         });
//         config = defaultConfig;
//     }
// }

// function setupScheduledNotifications() {
//     scheduledNotifications.forEach(scheduled => {
//         if (scheduled.timeout) clearTimeout(scheduled.timeout);
//         if (scheduled.interval) clearInterval(scheduled.interval);
//     });
//     scheduledNotifications = [];
    
//     if (!config || !config.notifications) return;
    
//     config.notifications.forEach(notificationConfig => {
//         if (!notificationConfig.enabled) return;
        
//         if (notificationConfig.repeat === 'daily' && notificationConfig.time) {
//             setupDailyNotification(notificationConfig);
//         } else if (notificationConfig.repeat === 'interval' && notificationConfig.interval) {
//             setupIntervalNotification(notificationConfig);
//         }
//     });
    
//     console.log(`已设置 ${scheduledNotifications.length} 个定时通知`);
// }

// 设置每日定时通知
// function setupDailyNotification(notificationConfig) {
//     const [hour, minute] = notificationConfig.time.split(':').map(Number);
    
//     function scheduleNext() {
//         const now = new Date();
//         const scheduledTime = new Date();
//         scheduledTime.setHours(hour, minute, 0, 0);
        
//         if (scheduledTime <= now) {
//             scheduledTime.setDate(scheduledTime.getDate() + 1);
//         }
        
//         const delay = scheduledTime.getTime() - now.getTime();
        
//         const timeout = setTimeout(() => {
//             addNotification(notificationConfig.message, notificationConfig.title);
//             scheduleNext();
//         }, delay);
        
//         scheduledNotifications.push({
//             id: notificationConfig.id,
//             type: 'daily',
//             timeout: timeout
//         });
        
//         console.log(`${notificationConfig.title} 已安排在 ${scheduledTime.toLocaleString()}`);
//     }
    
//     scheduleNext();
// }

// 设置间隔重复通知
// function setupIntervalNotification(notificationConfig) {
//     const intervalMs = (notificationConfig.interval || config.settings.defaultInterval) * 1000;
//     let count = 0;
    
//     const interval = setInterval(() => {
//         count++;
//         const message = notificationConfig.message.replace('{count}', count);
//         addNotification(message, notificationConfig.title);
//     }, intervalMs);
    
//     scheduledNotifications.push({
//         id: notificationConfig.id,
//         type: 'interval',
//         interval: interval
//     });
    
//     console.log(`${notificationConfig.title} 间隔通知已启动 (${notificationConfig.interval}秒)`);
// }

function addNotification(message, title = '系统通知') {
    const notification = {
        id: Date.now() + Math.random(),
        title: title,
        message: message,
        timestamp: new Date().toLocaleString()
    };
    
    notificationQueue.push(notification);
    writeLog('INFO', `新增通知: ${title} (ID: ${notification.id})`);
    
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        updateNotificationWindow();
    } else {
        showNotificationWindow();
    }
}

// 启动定时通知系统
// function startTimer() {
//     stopTimer();
    
//     if (!config) {
//         writeLog('WARN', '配置未加载，启动默认定时器', {
//             interval: '30秒',
//             type: 'default'
//         });
//         let count = 0;
//         timerInterval = setInterval(() => {
//             count++;
//             addNotification(`定时提醒 #${count}\n\n请及时处理相关事务！\n\n时间: ${new Date().toLocaleString()}`);
//         }, 30000);
//         return;
//     }
    
//     setupScheduledNotifications();
//     writeLog('INFO', '定时通知系统启动', {
//         notificationCount: config.notifications.length,
//         enabledCount: config.notifications.filter(n => n.enabled).length,
//         settings: config.settings
//     });
// }

// 停止所有定时通知任务
// function stopTimer() {
//     if (timerInterval) {
//         clearInterval(timerInterval);
//         timerInterval = null;
//     }
    
//     scheduledNotifications.forEach(scheduled => {
//         if (scheduled.timeout) clearTimeout(scheduled.timeout);
//         if (scheduled.interval) clearInterval(scheduled.interval);
//     });
//     scheduledNotifications = [];
    
//     console.log('所有定时通知已停止');
// }

// 创建全屏通知窗口
function createNotificationWindow() {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        writeLog('DEBUG', '复用现有通知窗口');
        return notificationWindow;
    }
    
    notificationWindow = new BrowserWindow({
        fullscreen: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    writeLog('INFO', '创建通知窗口', {
        fullscreen: true,
        alwaysOnTop: true
    });
    
    notificationWindow.loadFile('notification.html');
    
    notificationWindow.on('close', (event) => {
        writeLog('DEBUG', '拦截通知窗口关闭事件');
        event.preventDefault();
    });
    
    notificationWindow.on('closed', () => {
        writeLog('INFO', '通知窗口已关闭');
        notificationWindow = null;
    });
    
    return notificationWindow;
}

// 显示通知窗口并准备显示通知
function showNotificationWindow() {
    if (notificationQueue.length === 0) return;
    
    createNotificationWindow();
    
    notificationWindow.webContents.once('dom-ready', () => {
        updateNotificationWindow();
    });
}

// 更新通知窗口的通知内容
function updateNotificationWindow() {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.webContents.send('show-notifications', notificationQueue);
    }
}

// 设置每日任务获取定时器
function setupDailyFetch() {
    // 定义获取时间点
    const FETCH_TIMES = [
        { hour: 8, minute: 2 },
        { hour: 8, minute: 4 },
        { hour: 20, minute: 2 },
        { hour: 20, minute: 4 }
    ];

    // 清除现有定时器
    if (dailyFetchTimeout) {
        clearTimeout(dailyFetchTimeout);
        dailyFetchTimeout = null;
    }

    function getNextFetchTime() {
        const now = new Date();
        const today = new Date(now);
        let nextFetch = null;
        let minDelay = Infinity;

        // 检查今天的所有时间点
        for (const time of FETCH_TIMES) {
            const fetchTime = new Date(today);
            fetchTime.setHours(time.hour, time.minute, 0, 0);

            if (fetchTime <= now) {
                // 如果时间已过，设置为明天
                fetchTime.setDate(fetchTime.getDate() + 1);
            }

            const delay = fetchTime.getTime() - now.getTime();
            if (delay < minDelay) {
                minDelay = delay;
                nextFetch = fetchTime;
            }
        }

        return nextFetch;
    }

    function scheduleNextFetch() {
        const nextFetch = getNextFetchTime();
        const delay = nextFetch.getTime() - Date.now();
        
        writeLog('INFO', `下次任务获取定时: ${nextFetch.toLocaleString()}, ${Math.floor(delay/1000/60)}分钟后`);

        dailyFetchTimeout = setTimeout(async () => {
            try {
                await loadConfig();
                writeLog('INFO', `每日任务获取成功 (${nextFetch.getHours()}:${String(nextFetch.getMinutes()).padStart(2, '0')})`);
            } catch (error) {
                writeLog('ERROR', `每日任务获取失败: ${error.message}`);
            }
            // 设置下一次获取
            scheduleNextFetch();
        }, delay);
    }

    // 输出所有定时点的信息
    writeLog('INFO', '设置每日任务获取时间:\n' + 
        FETCH_TIMES.map(t => `- ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`).join('\n')
    );

    // 立即开始调度
    scheduleNextFetch();
}

// 清理应用资源并关闭相关进程
function cleanup() {
    if (dailyFetchTimeout) {
        clearTimeout(dailyFetchTimeout);
        dailyFetchTimeout = null;
    }
    notificationQueue = [];
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.destroy();
    }
    
    // 关闭日志流
    if (logStream) {
        logStream.end();
        logStream = null;
    }
    writeLog('INFO', '应用关闭，清理资源完成');
}

ipcMain.on('notification-confirmed', (event, notificationId) => {
    const notification = notificationQueue.find(n => n.id === notificationId);
    
    if (notification) {
        writeLog('INFO', '通知已确认', {
            id: notificationId,
            title: notification.title,
            createTime: notification.timestamp,
            confirmTime: new Date().toLocaleString()
        });
    } else {
        writeLog('WARN', '确认未知通知', { id: notificationId });
    }
    
    notificationQueue = notificationQueue.filter(n => n.id !== notificationId);
    
    if (notificationQueue.length > 0) {
        writeLog('INFO', '更新通知队列', {
            remaining: notificationQueue.length,
            nextTitle: notificationQueue[0].title
        });
        updateNotificationWindow();
    } else {
        writeLog('INFO', '通知队列清空，关闭窗口');
        if (notificationWindow && !notificationWindow.isDestroyed()) {
            notificationWindow.removeAllListeners('close');
            notificationWindow.close();
        }
    }
});

// app 生命周期处理
app.whenReady().then(() => {
    console.log('应用启动');
    console.log('应用目录:', __dirname);
    console.log('用户数据目录:', app.getPath('userData'));
    
    // 确保基本目录结构存在
    const logsDir = !app.isPackaged ? 
        path.join(__dirname, 'logs') : 
        path.join(app.getPath('userData'), 'logs');
    
    if (!fs.existsSync(logsDir)) {
        console.log('创建日志目录:', logsDir);
        fs.mkdirSync(logsDir, { recursive: true });
    }
    
    writeLog('INFO', '========================================');
    writeLog('INFO', 'ECC桌面提醒系统启动');
    writeLog('INFO', `运行平台: ${process.platform}`);
    writeLog('INFO', `配置文件: ${getConfigPath()}`);
    writeLog('INFO', `日志目录: ${logsDir}`);
    writeLog('INFO', '支持JSON配置定时通知');
    writeLog('INFO', '========================================');
    
    createMainWindow();
    
    // 初始加载配置并设置定时获取
    loadConfig().then(() => {
        setupDailyFetch();
    }).catch(error => {
        writeLog('ERROR', `初始配置加载失败: ${error.message}`);
        // 即使初始加载失败，仍然设置定时获取
        setupDailyFetch();
    });
});


app.on('window-all-closed', (event) => {
    // 在 macOS 上，除非用户明确退出，否则保持应用运行
    if (process.platform !== 'darwin') {
        cleanup();
        app.quit();
    } else {
        event.preventDefault();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

app.on('before-quit', () => {
    writeLog('INFO', '应用准备退出');
    cleanup();
});

process.on('uncaughtException', (error) => {
    writeLog('ERROR', `未捕获异常: ${error.message}`);
    writeLog('ERROR', error.stack || '无堆栈信息');
    cleanup();
});