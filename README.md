# ecc-alarm3

#### 介绍

#### 软件架构

基于Electron的锁屏式弹窗软件

跨平台的桌面软件，要实现到点锁屏式弹窗，必须处理后才能继续操作, 用户不点击处理,就不能做其他操作。
读取一个json配置文件, 来获取通知对象, 通知时间, 通知内容.
多条通知的需求，做一个弹窗，追加多条通知

<!-- #### 安装教程

1.  xxxx
2.  xxxx
3.  xxxx
-->

#### 使用说明

1.  配置json
2.  开始使用


#### 细节设计

##### Q3: 为什么配置文件在 ~/.config/ecc-alarm/:

    这是完全合理且推荐的做法,原因如下:
    遵循操作系统标准:
    Linux: ~/.config/<app-name>/
    macOS: ~/Library/Application Support/<app-name>/
    Windows: %APPDATA%\<app-name>\
    用户数据与应用程序分离:
    便于应用升级
    避免重装应用时丢失用户数据
    保护用户数据安全



TODO:

- [ ] 菜单栏美化
- [ ] config 优化
- [ ] 通知空白问题

- [ ] release发布

- [ ] 代码结构优化
- [ ] 定时测试