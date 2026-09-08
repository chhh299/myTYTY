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

        // 处理支付宝、微信、钉钉等三方协议唤起
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                context.startActivity(intent)
                true
            } catch (e: Exception) {
                true // 拦截避免崩溃
            }
        }

        return false
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        onPageLoadStateChanged?.invoke(true, url ?: "")

        // 在 DOM 最早时机注入平台伪装脚本
        view?.evaluateJavascript(DesktopSpoofHelper.getPreloadSpoofScript(), null)

        // 刷新并持久化 Cookie
        CookieManager.getInstance().flush()
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        onPageLoadStateChanged?.invoke(false, url ?: "")

        // 再次注入确保单页应用 (SPA) 路由切换后生效
        view?.evaluateJavascript(DesktopSpoofHelper.getPreloadSpoofScript(), null)

        // 注入核心抓取与操作引擎
        val injectorJs = DesktopSpoofHelper.loadAssetScript(context, "ui/tingwu-injector.js")
        if (injectorJs.isNotEmpty()) {
            view?.evaluateJavascript(injectorJs, null)
        }

        // 注入桌面端样式优化补丁
        val fixCss = DesktopSpoofHelper.loadAssetScript(context, "ui/tingwu-desktop-fix.css")
        if (fixCss.isNotEmpty()) {
            val encodedCss = fixCss.replace("\n", " ").replace("'", "\\'")
            val cssInjectionScript = """
                (function() {
                    var style = document.getElementById('tingwu-desktop-fix');
                    if (!style) {
                        style = document.createElement('style');
                        style.id = 'tingwu-desktop-fix';
                        style.innerHTML = '$encodedCss';
                        document.head.appendChild(style);
                    }
                })();
            """.trimIndent()
            view?.evaluateJavascript(cssInjectionScript, null)
        }

        // 提交持久化 Cookie
        CookieManager.getInstance().flush()
    }
}
