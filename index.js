// // 跨平台 Squirrel 启动处理 - 只在 Windows 上执行
// if (process.platform === 'win32') {
//     try {
//         if (require('electron-squirrel-startup')) {
//             require('electron').app.quit();
//         }
//     } catch (e) {
//         // 如果 electron-squirrel-startup 不存在，忽略错误
//         // 这样在开发环境或其他平台不会报错
//     }
// }

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow;
let notificationWindow = null;
let timerInterval = null;
let notificationQueue = [];
let config = null;
let scheduledNotifications = [];

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
    
    // 跨平台菜单配置
    const isMac = process.platform === 'darwin';
    const menuTemplate = [
        ...(isMac ? [{
            label: app.getName(),
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideothers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        {
            label: '通知系统',
            submenu: [
                {
                    label: '显示测试通知',
                    click: () => {
                        addNotification('这是一个测试通知\n时间: ' + new Date().toLocaleString());
                    }
                },
                {
                    label: '重新加载配置',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        loadConfig();
                    }
                },
                {
                    label: '打开配置文件夹',
                    click: () => {
                        console.log('配置文件路径:', getConfigPath());
                        require('electron').shell.showItemInFolder(getConfigPath());
                    }
                },
                { type: 'separator' },
                {
                    label: '停止定时通知',
                    click: () => stopTimer()
                },
                {
                    label: '启动定时通知',
                    click: () => startTimer()
                },
                { type: 'separator' },
                ...(!isMac ? [{
                    label: '退出',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => {
                        cleanup();
                        app.quit();
                    }
                }] : [])
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

// 跨平台配置文件加载
function loadConfig() {
    const configPath = getConfigPath();
    
    try {
        if (fs.existsSync(configPath)) {
            const configData = fs.readFileSync(configPath, 'utf8');
            config = JSON.parse(configData);
            console.log('配置文件加载成功:', config.notifications.length, '条通知配置');
            setupScheduledNotifications();
        } else {
            console.log('配置文件不存在，尝试复制默认配置:', configPath);
            copyDefaultConfigFromResources();
        }
    } catch (error) {
        console.error('加载配置文件失败:', error);
        console.log('创建默认配置');
        createDefaultConfig();
    }
}

// 跨平台默认配置复制
function copyDefaultConfigFromResources() {
    let defaultConfigPath;
    
    if (app.isPackaged) {
        // 生产环境：从资源目录读取
        defaultConfigPath = path.join(process.resourcesPath, 'config.json');
    } else {
        // 开发环境：从项目目录读取
        defaultConfigPath = path.join(__dirname, 'config.json');
    }
    
    const userConfigPath = getConfigPath();
    
    try {
        if (fs.existsSync(defaultConfigPath)) {
            // 确保用户数据目录存在
            const userDataDir = path.dirname(userConfigPath);
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, { recursive: true });
            }
            
            // 复制配置文件
            fs.copyFileSync(defaultConfigPath, userConfigPath);
            console.log('默认配置文件已复制到:', userConfigPath);
            
            // 重新加载
            loadConfig();
        } else {
            console.log('未找到默认配置文件，创建内置配置');
            createDefaultConfig();
        }
    } catch (error) {
        console.error('复制默认配置失败:', error);
        createDefaultConfig();
    }
}

function createDefaultConfig() {
    const defaultConfig = {
        "notifications": [
            {
                "id": "morning_reminder",
                "title": "晨间提醒",
                "message": "新的一天开始了！\n请检查今日工作计划",
                "time": "09:00",
                "enabled": true,
                "repeat": "daily"
            },
            {
                "id": "lunch_break",
                "title": "午餐休息",
                "message": "该休息一下了！\n记得按时吃午餐，保持健康",
                "time": "12:00",
                "enabled": true,
                "repeat": "daily"
            },
            {
                "id": "afternoon_reminder",
                "title": "下午提醒",
                "message": "下午时光，继续加油！\n记得多喝水，保护眼睛",
                "time": "15:00",
                "enabled": true,
                "repeat": "daily"
            }
        ],
        "settings": {
            "defaultInterval": 30,
            "timezone": "Asia/Shanghai",
            "enableSound": true,
            "testMode": false
        }
    };
    
    try {
        const configPath = getConfigPath();
        const configDir = path.dirname(configPath);
        
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
        config = defaultConfig;
        console.log('默认配置文件已创建:', configPath);
        setupScheduledNotifications();
    } catch (error) {
        console.error('创建配置文件失败:', error);
        config = defaultConfig;
    }
}

function setupScheduledNotifications() {
    scheduledNotifications.forEach(scheduled => {
        if (scheduled.timeout) clearTimeout(scheduled.timeout);
        if (scheduled.interval) clearInterval(scheduled.interval);
    });
    scheduledNotifications = [];
    
    if (!config || !config.notifications) return;
    
    config.notifications.forEach(notificationConfig => {
        if (!notificationConfig.enabled) return;
        
        if (notificationConfig.repeat === 'daily' && notificationConfig.time) {
            setupDailyNotification(notificationConfig);
        } else if (notificationConfig.repeat === 'interval' && notificationConfig.interval) {
            setupIntervalNotification(notificationConfig);
        }
    });
    
    console.log(`已设置 ${scheduledNotifications.length} 个定时通知`);
}

function setupDailyNotification(notificationConfig) {
    const [hour, minute] = notificationConfig.time.split(':').map(Number);
    
    function scheduleNext() {
        const now = new Date();
        const scheduledTime = new Date();
        scheduledTime.setHours(hour, minute, 0, 0);
        
        if (scheduledTime <= now) {
            scheduledTime.setDate(scheduledTime.getDate() + 1);
        }
        
        const delay = scheduledTime.getTime() - now.getTime();
        
        const timeout = setTimeout(() => {
            addNotification(notificationConfig.message, notificationConfig.title);
            scheduleNext();
        }, delay);
        
        scheduledNotifications.push({
            id: notificationConfig.id,
            type: 'daily',
            timeout: timeout
        });
        
        console.log(`${notificationConfig.title} 已安排在 ${scheduledTime.toLocaleString()}`);
    }
    
    scheduleNext();
}

function setupIntervalNotification(notificationConfig) {
    const intervalMs = (notificationConfig.interval || config.settings.defaultInterval) * 1000;
    let count = 0;
    
    const interval = setInterval(() => {
        count++;
        const message = notificationConfig.message.replace('{count}', count);
        addNotification(message, notificationConfig.title);
    }, intervalMs);
    
    scheduledNotifications.push({
        id: notificationConfig.id,
        type: 'interval',
        interval: interval
    });
    
    console.log(`${notificationConfig.title} 间隔通知已启动 (${notificationConfig.interval}秒)`);
}

function addNotification(message, title = '系统通知') {
    const notification = {
        id: Date.now() + Math.random(),
        title: title,
        message: message,
        timestamp: new Date().toLocaleString()
    };
    
    notificationQueue.push(notification);
    console.log(`[${notification.timestamp}] 新增通知: ${title}`);
    
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        updateNotificationWindow();
    } else {
        showNotificationWindow();
    }
}

function startTimer() {
    stopTimer();
    
    if (!config) {
        console.log('配置未加载，使用默认定时器');
        let count = 0;
        timerInterval = setInterval(() => {
            count++;
            addNotification(`定时提醒 #${count}\n\n请及时处理相关事务！\n\n时间: ${new Date().toLocaleString()}`);
        }, 30000);
        return;
    }
    
    setupScheduledNotifications();
    console.log('基于配置文件的定时通知已启动');
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    
    scheduledNotifications.forEach(scheduled => {
        if (scheduled.timeout) clearTimeout(scheduled.timeout);
        if (scheduled.interval) clearInterval(scheduled.interval);
    });
    scheduledNotifications = [];
    
    console.log('所有定时通知已停止');
}

function createNotificationWindow() {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
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
    
    notificationWindow.loadFile('notification.html');
    
    notificationWindow.on('close', (event) => {
        event.preventDefault();
    });
    
    notificationWindow.on('closed', () => {
        notificationWindow = null;
    });
    
    return notificationWindow;
}

function showNotificationWindow() {
    if (notificationQueue.length === 0) return;
    
    createNotificationWindow();
    
    notificationWindow.webContents.once('dom-ready', () => {
        updateNotificationWindow();
    });
}

function updateNotificationWindow() {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.webContents.send('show-notifications', notificationQueue);
    }
}

function cleanup() {
    stopTimer();
    notificationQueue = [];
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.destroy();
    }
}

ipcMain.on('notification-confirmed', (event, notificationId) => {
    console.log(`[${new Date().toLocaleString()}] 通知已确认: ${notificationId}`);
    
    notificationQueue = notificationQueue.filter(n => n.id !== notificationId);
    
    if (notificationQueue.length > 0) {
        updateNotificationWindow();
    } else {
        if (notificationWindow && !notificationWindow.isDestroyed()) {
            notificationWindow.removeAllListeners('close');
            notificationWindow.close();
        }
    }
});

// 跨平台应用生命周期处理
app.whenReady().then(() => {
    createMainWindow();
    loadConfig();
    startTimer();
    
    console.log('========================================');
    console.log('ECC桌面提醒系统已启动！');
    console.log(`- 平台: ${process.platform}`);
    console.log(`- 配置文件: ${getConfigPath()}`);
    console.log('- 支持JSON配置定时通知');
    console.log('========================================');
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

app.on('before-quit', cleanup);

process.on('uncaughtException', (error) => {
    console.error('未捕获异常:', error);
    cleanup();
});