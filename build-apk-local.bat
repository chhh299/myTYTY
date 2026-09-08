@echo off
chcp 65001 >nul
title mytyty - 本地 APK 编译脚本
echo ========================================================
echo   正在准备编译 mytyty Android Debug APK...
echo ========================================================

where java >nul 2>nul
if %errorlevel% neq 0 (
    echo [提示] 本机未检测到 JDK 17。
    echo 推荐方案：
    echo 1. 将本工程推送到 GitHub，GitHub Actions 会自动编译并生成 APK 安装包供直接下载；
    echo 2. 或者安装 Android Studio 并直接打开当前目录进行编译。
    echo.
    pause
    exit /b 1
)

echo [OK] 检测到 Java 环境，开始执行 Gradle 编译...
call gradlew.bat assembleDebug

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo   🎉 编译成功！APK 输出路径:
    echo   app\build\outputs\apk\debug\app-debug.apk
    echo ========================================================
) else (
    echo.
    echo [错误] 编译失败，请检查上方日志。
)

pause
