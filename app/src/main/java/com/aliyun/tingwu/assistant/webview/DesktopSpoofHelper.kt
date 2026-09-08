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
     * 配置 WebView 为 100% 桌面模式运行环境
     */
    @SuppressLint("SetJavaScriptEnabled")
    fun setupDesktopSettings(webView: WebView) {
        val settings = webView.settings

        // 1. 请求头伪装
        settings.userAgentString = DESKTOP_USER_AGENT

        // 2. 宽视口与桌面等比缩放
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        // 3. 核心功能开启
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true

        // 4. 音频与多媒体策略
        settings.mediaPlaybackRequiresUserGesture = false

        // 5. 混合内容允许
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        // 6. 缓存策略
        settings.cacheMode = WebSettings.LOAD_DEFAULT
    }

    /**
     * 生成在 DOM 初始化前注入的 JS 伪装脚本
     * 篡改 navigator.platform 与 navigator.userAgentData，规避现代大前端的高级设备探测
     */
    fun getPreloadSpoofScript(): String {
        return """
            (function() {
                try {
                    // 伪装平台特征
                    Object.defineProperty(navigator, 'platform', {
                        get: function() { return 'Win32'; },
                        configurable: false
                    });

                    // 伪装触控特征（保留必要事件同时防止被当成手机网页）
                    Object.defineProperty(navigator, 'maxTouchPoints', {
                        get: function() { return 0; },
                        configurable: false
                    });

                    // 伪装 Client Hints API (声明非移动端)
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

                    // 注入标准 Chrome 运行时对象
                    if (!window.chrome) {
                        window.chrome = { app: {}, runtime: {}, loadTimes: function() {}, csi: function() {} };
                    }
                } catch (e) {
                    console.error('[SpoofHelper] 预加载伪装异常:', e);
                }
            })();
        """.trimIndent()
    }

    /**
     * 从 assets 读取注入脚本
     */
    fun loadAssetScript(context: Context, assetPath: String): String {
        return try {
            val inputStream = context.assets.open(assetPath)
            val reader = BufferedReader(InputStreamReader(inputStream))
            reader.use { it.readText() }
        } catch (e: Exception) {
            e.printStackTrace()
            ""
        }
    }
}
