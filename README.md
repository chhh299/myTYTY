# 通义听悟移动助手 (Tingwu Assistant)

基于阿里云通义听悟（`https://tingwu.aliyun.com/home`）打造的定制化 Android 客户端。

---

## 核心特性

1. **深度 PC 桌面端伪装**：
   - 彻底将请求头与 JS 运行时伪装为 **Windows 11 Chrome 128** 桌面环境。
   - 注入 `navigator.platform = 'Win32'` 与 `navigator.userAgentData.mobile = false`。
   - 强制开启桌面宽视口，规避阿里云听悟的手机端拦截与功能阉割。
2. **1:1 像素级复刻极简卡片 UI**：
   - 完美还原 `tingwu_mobile_ui_mockup.png` 设计图。
   - 顶部听悟助手指示、实时记录卡片、原文/翻译双语实时字幕卡片、显示设置（字号调节与屏幕常亮）。
   - 底部常驻暗黑悬浮录音条（`00:12:47 实时录音中`、一键结束）。
   - 底部 4 个导航 Tab（主页、实时、历史、设置）。
3. **双向数据穿透引擎**：
   - **方案 B（主推）**：注入 WebSocket 代理，直接截获阿里云下发的结构化语音识别与翻译 JSON。
   - **方案 A（兜底）**：DOM MutationObserver 监听实时转写文字变动。
   - 官方问卷、新手引导、遮罩弹窗自动消杀。
   - 登录页面自动切换到短信/密码登录，解决手机扫当前屏幕二维码的死循环。
4. **长时会议录音与硬件保障**：
   - 前台服务（Foreground Service）常驻通知栏与 CPU 唤醒锁（WakeLock），防止锁屏休眠断流。
   - 蓝牙耳机 SCO 麦克风通道自动路由，开会戴耳机也能清晰收音。
   - 本地 AAC/M4A 录音双重安全备份，即使网络完全中断，本地会议录音永不丢失。
   - WebRTC 麦克风录音权限自动静默授权。

---

## 项目工程结构

```
d:\openwork\通义听悟\
├── .github/workflows/build-apk.yml     # GitHub Actions 云端一键自动编译工作流
├── app/
│   ├── build.gradle.kts                # Android 应用构建脚本 (SDK 34)
│   ├── src/main/
│   │   ├── AndroidManifest.xml         # 权限与服务声明
│   │   ├── assets/ui/                  # 打包在 App 内的离线移动端资源
│   │   │   ├── index.html              # 移动端卡片式结构 (Mockup 1:1)
│   │   │   ├── style.css               # 样式与动效系统
│   │   │   ├── app.js                  # 前台交互控制器
│   │   │   ├── mock-bridge.js          # Web 独立模式仿真驱动
│   │   │   ├── tingwu-injector.js      # 听悟桌面端 WebSocket & DOM 注入引擎
│   │   │   └── tingwu-desktop-fix.css  # 电脑视图样式补丁
│   │   ├── java/com/aliyun/tingwu/assistant/
│   │   │   ├── MainActivity.kt         # 主控 Activity (双 WebView 协调)
│   │   │   ├── bridge/TingwuBridge.kt  # 原生与 JS 双向通信桥
│   │   │   ├── webview/                # 桌面伪装与 WebRTC 授权
│   │   │   ├── service/RecordingService.kt # 前台通知栏保活服务
│   │   │   └── audio/AudioRecorderManager.kt# 蓝牙 SCO 与本地备份录音
│   │   └── res/                        # 原生布局、图标、主题配置
├── web-preview/                        # 本地独立 Web 预览环境
│   ├── preview-server.js               # Node.js 零依赖预览服务器
│   └── preview_server.py               # Python 零依赖预览服务器
├── run-preview.bat                     # 双击 1 秒启动本地浏览器测试
├── build-apk-local.bat                 # 本地 Gradle 编译脚本 (需 JDK)
├── gradlew.bat                         # Gradle Wrapper
└── README.md
```

---

## 如何使用与编译

### 方式 1：本地即开即用的 Web 预览（无需安装任何 SDK）
直接双击根目录下的 **`run-preview.bat`**：
- 自动启动本地服务器并在默认浏览器中打开 `http://localhost:8088`。
- 可以直接在浏览器中体验 1:1 的界面交互、实时模拟语音转写、英文翻译、字号调节、屏幕常亮与底部悬浮录音条。

### 方式 2：使用 Android Studio 本地编译 APK
1. 打开 **Android Studio**；
2. 选择 **Open**，直接选择当前目录 `D:\openwork\通义听悟`；
3. Android Studio 会自动下载所需的 Gradle 与 Android SDK；
4. 点击顶部菜单 **Build -> Build Bundle(s) / APK(s) -> Build APK(s)** 即可生成 `app-debug.apk`。

### 方式 3：GitHub Actions 云端全自动打包 APK（推荐）
当前项目已配置 `.github/workflows/build-apk.yml`：
1. 将本工程推送到 GitHub 仓库；
2. GitHub Actions 会自动在云端 Linux 环境中运行编译；
3. 编译完成后，直接在 GitHub Actions 的 **Artifacts** 页面下载打包好的 `TingwuAssistant-debug-apk.zip`。
