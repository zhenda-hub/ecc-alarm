const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');

let mainWindow;
let notificationWindow = null; // 确保只有一个通知窗口
let timerInterval = null;

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
    
    // 创建菜单栏
    const menu = Menu.buildFromTemplate([
        {
            label: '通知系统',
            submenu: [
                {
                    label: '显示测试通知',
                    click: () => {
                        showNotification('这是一个测试通知\n时间: ' + new Date().toLocaleString());
                    }
                },
                {
                    label: '停止定时通知',
                    click: () => {
                        stopTimer();
                    }
                },
                {
                    label: '启动定时通知',
                    click: () => {
                        startTimer();
                    }
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

function createNotificationWindow(message) {
    // 如果已经有通知窗口存在，先关闭它
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        console.log('关闭现有通知窗口...');
        notificationWindow.destroy();
        notificationWindow = null;
    }
    
    // 创建新的通知窗口
    notificationWindow = new BrowserWindow({
        fullscreen: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: false,
        modal: true, // 设为模态窗口
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    notificationWindow.loadFile('notification.html');
    
    // 发送消息内容
    notificationWindow.webContents.once('dom-ready', () => {
        if (notificationWindow && !notificationWindow.isDestroyed()) {
            notificationWindow.webContents.send('show-message', message);
        }
    });
    
    // 处理窗口关闭事件
    notificationWindow.on('close', (event) => {
        // 只有通过确认按钮才能关闭
        event.preventDefault();
    });
    
    // 处理窗口销毁事件
    notificationWindow.on('closed', () => {
        console.log('通知窗口已销毁');
        notificationWindow = null;
    });
    
    return notificationWindow;
}

function showNotification(message) {
    // 检查是否已经有通知在显示
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        console.log('已有通知在显示，跳过本次通知');
        return;
    }
    
    createNotificationWindow(message);
    console.log(`[${new Date().toLocaleString()}] 显示通知: ${message.split('\n')[0]}`);
}

function startTimer() {
    // 先清除现有定时器
    stopTimer();
    
    let count = 0;
    console.log('定时器已启动，30秒间隔...');
    
    timerInterval = setInterval(() => {
        // 检查是否已经有通知在显示
        if (notificationWindow && !notificationWindow.isDestroyed()) {
            console.log('通知窗口正在显示，跳过本次定时通知');
            return;
        }
        
        count++;
        const message = `定时提醒 #${count}\n\n请及时处理相关事务！\n\n必须点击确认按钮才能继续操作\n\n时间: ${new Date().toLocaleString()}`;
        showNotification(message);
    }, 30000); // 30秒间隔
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
        console.log('定时器已停止');
    }
}

function cleanup() {
    console.log('清理资源...');
    
    // 停止定时器
    stopTimer();
    
    // 关闭通知窗口
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        notificationWindow.destroy();
        notificationWindow = null;
    }
}

// IPC 事件处理
ipcMain.on('notification-confirmed', (event) => {
    console.log(`[${new Date().toLocaleString()}] 通知已确认处理`);
    
    if (notificationWindow && !notificationWindow.isDestroyed()) {
        // 移除 close 事件的阻止，允许正常关闭
        notificationWindow.removeAllListeners('close');
        notificationWindow.close();
        notificationWindow = null;
    }
});

// 应用事件
app.whenReady().then(() => {
    createMainWindow();
    startTimer();
    
    console.log('========================================');
    console.log('跨平台通知系统已启动！');
    console.log('- 定时通知：每30秒一次（如果没有通知在显示）');
    console.log('- 菜单栏：可手动控制通知');
    console.log('- 单实例通知：避免重复弹窗');
    console.log('- 按 Ctrl+Q 或菜单退出程序');
    console.log('========================================');
});

app.on('window-all-closed', (event) => {
    event.preventDefault();
});

app.on('before-quit', () => {
    cleanup();
    console.log('通知系统正在退出...');
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    cleanup();
});