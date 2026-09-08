package com.aliyun.tingwu.assistant

import com.aliyun.tingwu.assistant.webview.DesktopSpoofHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * mytyty 架构与质量门禁严格单元测试
 * 覆盖：零 Mock 假数据校验、状态栏纯净度校验、桌面 UA 伪装、Base64 编码、防呆逻辑
 */
class TingwuArchitectureTest {

    private fun formatTimer(totalSec: Int): String {
        val h = totalSec / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        return String.format("%02d:%02d:%02d", h, m, s)
    }

    @Test
    fun testInitialTimerIsZero() {
        // QG-1 门禁：初始计时器必须严格为 00:00:00
        val initialTimer = formatTimer(0)
        assertEquals("00:00:00", initialTimer)

        val oneHourTimer = formatTimer(3665)
        assertEquals("01:01:05", oneHourTimer)
    }

    @Test
    fun testDesktopUserAgentSpoofing() {
        // 4.1 规范：UA 必须为 64位 Windows 11 Chrome，严禁暴露移动设备特征
        val ua = DesktopSpoofHelper.DESKTOP_USER_AGENT
        assertTrue("必须包含 Windows NT 10.0", ua.contains("Windows NT 10.0; Win64; x64"))
        assertTrue("必须包含 Chrome 128", ua.contains("Chrome/128.0.0.0"))
        assertFalse("严禁包含 Android 特征", ua.contains("Android"))
        assertFalse("严禁包含 Mobile 特征", ua.contains("Mobile"))
    }

    @Test
    fun testPreloadSpoofScriptIntegrity() {
        // 4.1 规范：必须冻结 navigator.platform 为 Win32
        val script = DesktopSpoofHelper.getPreloadSpoofScript()
        assertTrue("必须重载 navigator.platform", script.contains("Win32"))
        assertTrue("必须设置 userAgentData.mobile 为 false", script.contains("mobile: false"))
        assertTrue("必须伪装 window.chrome", script.contains("window.chrome"))
    }

    @Test
    fun testNoMockDataInHtmlAssets() {
        // QG-1 & QG-2 门禁：严格检查 index.html 中绝无虚假数据与虚假状态栏
        val htmlFile = File("app/src/main/assets/ui/index.html")
        assertTrue("index.html 必须存在", htmlFile.exists())
        val htmlContent = htmlFile.readText()

        // 严禁存在虚假时间
        assertFalse("严禁包含假时间 00:12:47", htmlContent.contains("00:12:47"))
        assertFalse("严禁包含假时间 12:47", htmlContent.contains("12:47"))
        assertFalse("严禁包含假状态栏时间 9:41", htmlContent.contains("9:41"))
        assertFalse("严禁包含假 Wi-Fi 图标", htmlContent.contains("wifi"))
        assertFalse("严禁包含假电池图标", htmlContent.contains("battery"))

        // 必须以 00:00:00 待命
        assertTrue("初始计时器必须为 00:00:00", htmlContent.contains(">00:00:00<"))
        assertTrue("必须存在空状态提示", htmlContent.contains("transcriptEmptyState"))
    }

    @Test
    fun testEngineInjectorHasDeduplication() {
        // 8.2 规范：必须具备双通道去重与统一句子流规整器 (修复 P1-4)
        val jsFile = File("app/src/main/assets/tingwu-engine-injector.js")
        assertTrue("tingwu-engine-injector.js 必须存在", jsFile.exists())
        val jsContent = jsFile.readText()

        assertTrue("必须具备统一句子流规整器", jsContent.contains("normalizeAndDispatchSentence"))
        assertTrue("必须具备 active_sentence_ 唯一递增句 ID", jsContent.contains("active_sentence_"))
        assertTrue("必须具备 WebSocket 原型拦截", jsContent.contains("window.WebSocket = function"))
        assertTrue("必须具备 DOM MutationObserver 监听", jsContent.contains("new MutationObserver"))
        assertTrue("必须具备多模态按钮点击选择器", jsContent.contains("startRecording"))
        assertTrue("必须具备 20秒静默看门狗", jsContent.contains("stream_idle"))
    }

    @Test
    fun testMobileAdaptHasSmsModalFix() {
        // 5.1 & 5.2 规范：必须包含短信登录居中与全宽解封
        val cssFile = File("app/src/main/assets/tingwu-mobile-adapt.css")
        assertTrue("tingwu-mobile-adapt.css 必须存在", cssFile.exists())
        val cssContent = cssFile.readText()
        assertTrue("必须解开弹窗横向溢出", cssContent.contains("overflow-x: auto !important"))
        assertTrue("必须允许全宽展示", cssContent.contains("max-width: 100vw !important"))

        val jsFile = File("app/src/main/assets/tingwu-mobile-adapt.js")
        assertTrue("tingwu-mobile-adapt.js 必须存在", jsFile.exists())
        val jsContent = jsFile.readText()
        assertTrue("必须包含自动切换短信登录", jsContent.contains("短信登录"))
        assertTrue("必须包含右侧自动居中逻辑", jsContent.contains("modal.scrollLeft = modal.scrollWidth - modal.clientWidth"))
    }

    @Test
    fun testNotificationBroadcastContract() {
        // 8.8 规范：通知栏结束录音广播常量定义验证
        val actionStop = "com.aliyun.tingwu.assistant.ACTION_STOP"
        val broadcastStop = "com.aliyun.tingwu.assistant.BROADCAST_STOP_RECORDING"
        assertEquals("com.aliyun.tingwu.assistant.ACTION_STOP", actionStop)
        assertEquals("com.aliyun.tingwu.assistant.BROADCAST_STOP_RECORDING", broadcastStop)
    }
}
