package com.aliyun.tingwu.assistant.webview

import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView

class TingwuWebChromeClient(
    private val onProgressUpdate: ((Int) -> Unit)? = null
) : WebChromeClient() {

    companion object {
        private const val TAG = "TingwuChromeClient"
    }

    /**
     * 自动授权通义听悟网页的 WebRTC 麦克风录音权限
     */
    override fun onPermissionRequest(request: PermissionRequest?) {
        if (request == null) return

        val resources = request.resources
        val grantedResources = mutableListOf<String>()

        for (resource in resources) {
            if (resource == PermissionRequest.RESOURCE_AUDIO_CAPTURE) {
                // 授权麦克风收音
                grantedResources.add(resource)
                Log.d(TAG, "已自动批准网页麦克风录音权限请求: $resource")
            }
        }

        if (grantedResources.isNotEmpty()) {
            request.grant(grantedResources.toTypedArray())
        } else {
            request.deny()
        }
    }

    override fun onProgressChanged(view: WebView?, newProgress: Int) {
        super.onProgressChanged(view, newProgress)
        onProgressUpdate?.invoke(newProgress)
    }

    override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
        if (consoleMessage != null) {
            Log.d(
                TAG,
                "[WebConsole] ${consoleMessage.message()} -- From line ${consoleMessage.lineNumber()} of ${consoleMessage.sourceId()}"
            )
        }
        return true
    }
}
