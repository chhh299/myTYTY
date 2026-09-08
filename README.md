# mytyty (通义听悟移动适配原生客户端)

基于阿里云通义听悟桌面端（`https://tingwu.aliyun.com/home`）打造的高性能专用 Android 客户端。

---

## 核心技术与特性

1. **真实 Windows 11 桌面端深度伪装**：
   - 请求头与运行时伪装为 `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36`。
   - 注入 `navigator.platform = 'Win32'`、`navigator.userAgentData`（`mobile: false, platform: 'Windows'`）及 `window.chrome`。
   - 启用宽视口（`useWideViewPort`）与概览模式（`loadWithOverviewMode`），彻底规避移动端跳转拦截。

2. **登录弹窗与短信验证码展示修复**：
   - 解决阿里云桌面版扫码登录弹窗（~700px 双栏布局）在手机屏幕上被右侧截断、无法查看和点击短信验证码的问题。
   - 注入自适应 CSS 与交互脚本，支持横向平滑触摸滚动并自动将视口对齐至短信/密码登录表单，自动模拟点击短信登录选项卡。

3. **原生硬件麦克风 WebRTC 直通**：
   - `TingwuWebChromeClient` 自动捕获并授权 `PermissionRequest.RESOURCE_AUDIO_CAPTURE`。
   - 阿里云听悟前端的 `navigator.mediaDevices.getUserMedia({ audio: true })` 可直接接管手机物理麦克风。
   - 杜绝任何虚假模拟文本、预设录音时长或假静态流，实现 100% 真实的实时语音转写与云端双语翻译。

4. **四大原生导航 Tab 架构**：
   - **主页**：阿里云通义听悟主页、账号登录入口与个人工作台。
   - **实时**：一键进入实时录音与中英转写翻译工作台。
   - **历史**：查看已保存的会议纪要与云端文档记录。
   - **设置**：会议屏幕常亮（防锁屏中断）、字号缩放微调、清除缓存与重新登录。

5. **无虚假系统 UI**：
   - 彻底剔除所有原型图中的假 Wi-Fi、假电量、假 9:41 状态栏；由 Android 手机系统状态栏真实渲染。

---

## 工程目录结构

```
mytyty/
├── .github/workflows/build-apk.yml     # GitHub Actions 自动化 APK 构建流
├── app/
│   ├── build.gradle.kts                # Gradle 构建配置 (SDK 34)
│   ├── src/main/
│   │   ├── AndroidManifest.xml         # 原生权限与服务声明
│   │   ├── assets/
│   │   │   ├── tingwu-mobile-adapt.css # 登录弹窗自适应与移动排版 CSS
│   │   │   └── tingwu-mobile-adapt.js  # 短信登录自动居中与交互辅助 JS
│   │   ├── java/com/aliyun/tingwu/assistant/
│   │   │   ├── MainActivity.kt         # 主 Activity (四大导航 Tab、字号缩放、常亮控制)
│   │   │   ├── webview/
│   │   │   │   ├── DesktopSpoofHelper.kt     # 桌面 UA 与平台特征伪装
│   │   │   │   ├── TingwuWebViewClient.kt    # 样式/脚本注入与链接调度
│   │   │   │   └── TingwuWebChromeClient.kt  # 麦克风 WebRTC 权限自动授予
│   │   │   ├── audio/AudioRecorderManager.kt # 蓝牙 SCO 路由与录音辅助
│   │   │   └── service/RecordingService.kt   # 前台保活与唤醒锁支持
│   │   └── res/
│   │       ├── layout/activity_main.xml      # 原生顶栏 + 真实 WebView + 底部 4 Tab
│   │       └── values/                       # 颜色、主题、字符串
├── build-apk-local.bat                 # 本地 Gradle 编译脚本 (需 JDK 17)
└── gradlew.bat                         # Gradle Wrapper
```

---

## 获取与编译 APK

### 方式 1：通过 GitHub Actions 自动打包（推荐）
推送代码至 GitHub 仓库（`https://github.com/chhh299/myTYTY.git`），GitHub Actions 将自动执行编译流程，并在 Actions 页面提供 `mytyty-debug-apk` 安装包下载。

### 方式 2：Android Studio 本地编译
1. 在 Android Studio 中打开项目根目录；
2. 等待 Gradle Sync 完成；
3. 选择 **Build -> Build Bundle(s) / APK(s) -> Build APK(s)**。
