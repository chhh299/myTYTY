package com.aliyun.tingwu.assistant.webview

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebSettings
import android.webkit.WebView
import java.io.BufferedReader
import java.io.InputStreamReader

object DesktopSpoofHelper {

    // 标准 Windows 11 Chrome 桌面版 User-Agent
    const val DESKTOP_USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

    /**
     * 配置 WebView 为 100% 桌面模式运行环境，并支持视口自适应缩放
     */
    @SuppressLint("SetJavaScriptEnabled")
    fun setupDesktopSettings(webView: WebView) {
        val settings = webView.settings

        // 1. 请求头伪装为 PC Chrome
        settings.userAgentString = DESKTOP_USER_AGENT

        // 2. 宽视口与桌面等比缩放 (关键：让原本超宽的电脑页面等比缩进手机屏幕，防止右侧短信登录被切断)
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        // 3. 开启缩放控制 (支持双指缩放微调)
        settings.setSupportZoom(true)
        settings.builtInZoomControls = true
        settings.displayZoomControls = false

        // 4. 核心功能开启
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true

        // 5. 音频与录音策略 (关键：允许网页无需手势直接启动音频捕获流)
        settings.mediaPlaybackRequiresUserGesture = false

        // 6. 混合内容允许
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        // 7. 缓存策略
        settings.cacheMode = WebSettings.LOAD_DEFAULT
    }

    /**
     * 生成在 DOM 初始化前注入的 JS 伪装脚本
     * 篡改 navigator.platform 与 navigator.userAgentData
     */
    fun getPreloadSpoofScript(): String {
        return """
            (function() {
                try {
                    Object.defineProperty(navigator, 'platform', {
                        get: function() { return 'Win32'; },
                        configurable: false
                    });

                    if (navigator.userAgentData) {
                        var mockUaData = {
                            brands: [
                                { brand: 'Chromium', version: '128' },
                                { brand: 'Not;A=Brand', version: '24' },
                                { brand: 'Google Chrome', version: '128' }
                            ],
                            mobile: false,
                            platform: 'Windows'
                        };
                        Object.defineProperty(navigator, 'userAgentData', {
                            get: function() { return mockUaData; },
                            configurable: false
                        });
                    }

                    if (!window.chrome) {
                        window.chrome = { app: {}, runtime: {}, loadTimes: function() {}, csi: function() {} };
                    }
                } catch (e) {
                    console.error('[mytyty] 预加载伪装异常:', e);
                }
            })();
        """.trimIndent()
    }

    /**
     * 从 assets 读取文本文件
     */
    fun loadAssetFile(context: Context, fileName: String): String {
        return try {
            val inputStream = context.assets.open(fileName)
            val reader = BufferedReader(InputStreamReader(inputStream))
            reader.use { it.readText() }
        } catch (e: Exception) {
            e.printStackTrace()
            ""
        }
    }
}
