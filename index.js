const { app, BrowserWindow, ipcMain, Menu } = require('electron');

let mainWindow;
let notificationWindow = null;
let timerInterval = null;
let notificationQueue = []; // 新增：通知队列

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 300,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    const menu = Menu.buildFromTemplate([
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
                    label: '添加多条测试通知', // 新增
                    click: () => {
                        addNotification('第一条通知\n重要提醒内容');
                        addNotification('第二条通知\n系统维护通知');
                        addNotification('第三条通知\n安全警告信息');
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
                {
                    label: '退出',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => {
                        cleanup();
                        app.quit();
                    }
                }
            ]
        }
    ]);
    
    Menu.setApplicationMenu(menu);
}

// 新增：添加通知到队列
function addNotification(message) {
    const notification = {
        id: Date.now() + Math.random(),
        message: message,
        timestamp: new Date().toLocaleString()
    };
    
    notificationQueue.push(notification);
    console.log(`[${notification.timestamp}] 新增通知: ${message.split('\n')[0]}`);
    
    // 如果窗口已显示，更新内容；否则显示窗口
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        updateNotificationWindow();
    } else {
        showNotificationWindow();
    }
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

// 新增：更新通知窗口内容
function updateNotificationWindow() {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.webContents.send('show-notifications', notificationQueue);
    }
}

function startTimer() {
    stopTimer();
    
    let count = 0;
    console.log('定时通知已启动，每30秒一次...');
    
    timerInterval = setInterval(() => {
        count++;
        const message = `定时提醒 #${count}\n\n请及时处理相关事务！\n\n时间: ${new Date().toLocaleString()}`;
        addNotification(message);
    }, 30000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
        console.log('定时通知已停止');
    }
}

function cleanup() {
    stopTimer();
    notificationQueue = [];
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.destroy();
    }
}

// 修改：处理通知确认（现在是处理单条）
ipcMain.on('notification-confirmed', (event, notificationId) => {
    console.log(`[${new Date().toLocaleString()}] 通知已确认: ${notificationId}`);
    
    // 移除已处理的通知
    notificationQueue = notificationQueue.filter(n => n.id !== notificationId);
    
    // 如果还有通知，更新显示；否则关闭窗口
    if (notificationQueue.length > 0) {
        updateNotificationWindow();
    } else {
        if (notificationWindow && !notificationWindow.isDestroyed()) {
            notificationWindow.removeAllListeners('close');
            notificationWindow.close();
        }
    }
});

// 其他代码保持不变...
app.whenReady().then(() => {
    createMainWindow();
    startTimer();
    
    console.log('========================================');
    console.log('多通知系统已启动！');
    console.log('- 支持多条通知队列管理');
    console.log('- 菜单栏可添加测试通知');
    console.log('- 按 Ctrl+Q 或菜单退出程序');
    console.log('========================================');
});

app.on('window-all-closed', (event) => {
    event.preventDefault();
});

app.on('before-quit', cleanup);
process.on('uncaughtException', (error) => {
    console.error('未捕获异常:', error);
    cleanup();
});