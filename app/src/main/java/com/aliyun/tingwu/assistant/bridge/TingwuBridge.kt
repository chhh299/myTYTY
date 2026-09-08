package com.aliyun.tingwu.assistant.bridge

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.widget.Toast
import com.aliyun.tingwu.assistant.MainActivity

class TingwuBridge(
    private val activity: MainActivity
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * 前台 UI 点击“开始录音”
     */
    @JavascriptInterface
    fun startRecording() {
        mainHandler.post {
            activity.handleStartRecording()
        }
    }

    /**
     * 前台 UI 点击“结束录音”
     */
    @JavascriptInterface
    fun stopRecording() {
        mainHandler.post {
            activity.handleStopRecording()
        }
    }

    /**
     * 后台听悟引擎截获到实时转写与翻译数据包，向原生层回传
     */
    @JavascriptInterface
    fun onTranscriptionReceived(json: String) {
        mainHandler.post {
            activity.relayTranscriptionToUi(json)
        }
    }

    /**
     * 更新显示与常亮设置
     */
    @JavascriptInterface
    fun updateSettings(fontSize: Int, keepScreenOn: Boolean) {
        mainHandler.post {
            activity.updateDisplaySettings(fontSize, keepScreenOn)
        }
    }

    /**
     * 切换到电脑网页完整视图（排查问题或扫码）
     */
    @JavascriptInterface
    fun toggleDesktopView() {
        mainHandler.post {
            activity.showDesktopEngineView()
        }
    }

    /**
     * 复制转写文本到剪贴板
     */
    @JavascriptInterface
    fun copyToClipboard(text: String) {
        mainHandler.post {
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("听悟转写记录", text)
            clipboard.setPrimaryClip(clip)
            Toast.makeText(activity, "已复制到剪贴板", Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * 重新加载听悟后台引擎
     */
    @JavascriptInterface
    fun reloadEngine() {
        mainHandler.post {
            activity.reloadEngineWebView()
        }
    }

    /**
     * 历史记录入口
     */
    @JavascriptInterface
    fun showHistory() {
        mainHandler.post {
            activity.showHistoryRecords()
        }
    }
}
