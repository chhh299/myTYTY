package com.aliyun.tingwu.assistant.webview

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class TingwuWebViewClient(
    private val context: Context,
    private val onPageLoadStateChanged: ((isLoading: Boolean, url: String) -> Unit)? = null
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val url = request?.url?.toString() ?: return false

        // 处理支付宝、微信等三方登录跳转
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                context.startActivity(intent)
                true
            } catch (e: Exception) {
                true
            }
        }

        return false
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        onPageLoadStateChanged?.invoke(true, url ?: "")

        // 在 DOM 最早时刻注入 Windows 11 Chrome 桌面伪装
        view?.evaluateJavascript(DesktopSpoofHelper.getPreloadSpoofScript(), null)
        CookieManager.getInstance().flush()
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        onPageLoadStateChanged?.invoke(false, url ?: "")

        // 注入 Windows 11 平台特征
        view?.evaluateJavascript(DesktopSpoofHelper.getPreloadSpoofScript(), null)

        // 注入登录弹窗全宽展示与防截断 CSS
        val adaptCss = DesktopSpoofHelper.loadAssetFile(context, "tingwu-mobile-adapt.css")
        if (adaptCss.isNotEmpty()) {
            val cleanCss = adaptCss.replace("\n", " ").replace("'", "\\'")
            val cssScript = """
                (function() {
                    var style = document.getElementById('mytyty-mobile-adapt-style');
                    if (!style) {
                        style = document.createElement('style');
                        style.id = 'mytyty-mobile-adapt-style';
                        document.head.appendChild(style);
                    }
                    style.innerHTML = '$cleanCss';
                })();
            """.trimIndent()
            view?.evaluateJavascript(cssScript, null)
        }

        // 注入后台数据穿透与录音调度引擎
        val injectorJs = DesktopSpoofHelper.loadAssetFile(context, "tingwu-engine-injector.js")
        if (injectorJs.isNotEmpty()) {
            view?.evaluateJavascript(injectorJs, null)
        }

        // 注入登录辅助脚本
        val adaptJs = DesktopSpoofHelper.loadAssetFile(context, "tingwu-mobile-adapt.js")
        if (adaptJs.isNotEmpty()) {
            view?.evaluateJavascript(adaptJs, null)
        }

        CookieManager.getInstance().flush()
    }
}
