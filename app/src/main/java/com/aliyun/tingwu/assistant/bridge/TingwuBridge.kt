package com.aliyun.tingwu.assistant.bridge

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import com.aliyun.tingwu.assistant.MainActivity

class TingwuBridge(
    private val activity: MainActivity
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * 前台卡片 UI 点击“开始录音”请求
     */
    @JavascriptInterface
    fun startRecording() {
        mainHandler.post {
            activity.handleStartRecording()
        }
    }

    /**
     * 后台听悟引擎确认网页实际已开始收音 (双向 ACK 握手，杜绝虚假走表)
     */
    @JavascriptInterface
    fun notifyRecordingAck(started: Boolean) {
        mainHandler.post {
            activity.handleRecordingAck(started)
        }
    }

    /**
     * 前台卡片 UI 点击“结束录音”
     */
    @JavascriptInterface
    fun stopRecording() {
        mainHandler.post {
            activity.handleStopRecording()
        }
    }

    /**
     * 后台听悟引擎捕获到实时语音识别与双语翻译数据包，向原生层回传
     */
    @JavascriptInterface
    fun onTranscriptionReceived(json: String) {
        mainHandler.post {
            activity.relayTranscriptionToUi(json)
        }
    }

    /**
     * 后台听悟引擎上报连接或登录状态
     */
    @JavascriptInterface
    fun notifyEngineState(state: String, desc: String) {
        mainHandler.post {
            activity.updateEngineState(state, desc)
        }
    }

    /**
     * 前台 UI 字号与常亮修改
     */
    @JavascriptInterface
    fun updateSettings(fontSize: Int, keepScreenOn: Boolean) {
        mainHandler.post {
            activity.updateDisplaySettings(fontSize, keepScreenOn)
        }
    }

    /**
     * 重新刷新引擎
     */
    @JavascriptInterface
    fun reloadEngine() {
        mainHandler.post {
            activity.reloadEngine()
        }
    }

    /**
     * 前台卡片请求拉取历史会议记录
     */
    @JavascriptInterface
    fun fetchHistoryList() {
        mainHandler.post {
            activity.fetchHistoryListFromEngine()
        }
    }

    /**
     * 后台听悟引擎回传提取到的历史会议列表
     */
    @JavascriptInterface
    fun onHistoryListReceived(json: String) {
        mainHandler.post {
            activity.relayHistoryListToUi(json)
        }
    }

    /**
     * 点击历史记录卡片查看详情
     */
    @JavascriptInterface
    fun openHistoryDetail(docId: String) {
        mainHandler.post {
            activity.handleOpenHistoryDetail(docId)
        }
    }
}
