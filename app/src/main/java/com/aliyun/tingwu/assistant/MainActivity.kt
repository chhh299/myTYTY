package com.aliyun.tingwu.assistant

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.aliyun.tingwu.assistant.audio.AudioRecorderManager
import com.aliyun.tingwu.assistant.bridge.TingwuBridge
import com.aliyun.tingwu.assistant.databinding.ActivityMainBinding
import com.aliyun.tingwu.assistant.service.RecordingService
import com.aliyun.tingwu.assistant.webview.DesktopSpoofHelper
import com.aliyun.tingwu.assistant.webview.TingwuWebChromeClient
import com.aliyun.tingwu.assistant.webview.TingwuWebViewClient

class MainActivity : AppCompatActivity() {

    companion object {
        private const val REQUEST_PERMISSIONS_CODE = 2001
        private const val TINGWU_HOME_URL = "https://tingwu.aliyun.com/home"
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var audioRecorderManager: AudioRecorderManager
    private lateinit var bridge: TingwuBridge

    private var isRecording = false
    private var recordSeconds = 0
    private var isDesktopViewActive = false
    private var backPressedTime = 0L

    private val timerHandler = Handler(Looper.getMainLooper())
    private val timerRunnable = object : Runnable {
        override fun run() {
            if (isRecording) {
                recordSeconds++
                val timeStr = formatTimer(recordSeconds)
                binding.uiWebView.evaluateJavascript(
                    "window.onNativeTimerTick && window.onNativeTimerTick('$timeStr');",
                    null
                )
                timerHandler.postDelayed(this, 1000)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        audioRecorderManager = AudioRecorderManager(this)
        bridge = TingwuBridge(this)

        initCookieManager()
        setupUiWebView()
        setupEngineWebView()
        setupListeners()
        setupBackNavigation()
        requestAppPermissions()
    }

    private fun initCookieManager() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(binding.engineWebView, true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupUiWebView() {
        binding.uiWebView.apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            addJavascriptInterface(bridge, "TingwuBridge")
            loadUrl("file:///android_asset/ui/index.html")
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupEngineWebView() {
        val engine = binding.engineWebView
        DesktopSpoofHelper.setupDesktopSettings(engine)

        engine.addJavascriptInterface(bridge, "TingwuBridge")
        engine.webViewClient = TingwuWebViewClient(this) { isLoading, _ ->
            binding.loadingIndicator.visibility = if (isLoading) View.VISIBLE else View.GONE
        }
        engine.webChromeClient = TingwuWebChromeClient { progress ->
            binding.loadingIndicator.progress = progress
        }

        // 加载通义听悟官方主页
        engine.loadUrl(TINGWU_HOME_URL)
    }

    private fun setupListeners() {
        binding.btnReturnToMobileUi.setOnClickListener {
            hideDesktopEngineView()
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (isDesktopViewActive) {
                    hideDesktopEngineView()
                } else if (binding.engineWebView.canGoBack()) {
                    binding.engineWebView.goBack()
                } else {
                    val currentTime = System.currentTimeMillis()
                    if (currentTime - backPressedTime < 2000) {
                        finish()
                    } else {
                        backPressedTime = currentTime
                        Toast.makeText(this@MainActivity, "再按一次退出 mytyty", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
    }

    private fun requestAppPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.MODIFY_AUDIO_SETTINGS
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
        }

        val ungranted = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (ungranted.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                ungranted.toTypedArray(),
                REQUEST_PERMISSIONS_CODE
            )
        }
    }

    // ========================================================
    // 录音生命周期与硬件联动
    // ========================================================

    fun handleStartRecording() {
        if (isRecording) return

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            requestAppPermissions()
            Toast.makeText(this, "请先授予麦克风权限", Toast.LENGTH_SHORT).show()
            return
        }

        isRecording = true
        recordSeconds = 0

        // 1. 启动前台保活服务与 WakeLock
        RecordingService.startService(this)

        // 2. 路由蓝牙耳机麦克风
        audioRecorderManager.startBluetoothSco()

        // 3. 启动本地 AAC 录音防灾双备份
        audioRecorderManager.startLocalBackupRecording()

        // 4. 远程触发桌面版网页的“开始录音”
        binding.engineWebView.evaluateJavascript(
            "window.__tingwuController && window.__tingwuController.startRecording();",
            null
        )

        // 5. 启动计时器并同步 UI
        timerHandler.post(timerRunnable)
        binding.uiWebView.evaluateJavascript(
            "window.onNativeRecordingStatus && window.onNativeRecordingStatus(true);",
            null
        )
    }

    fun handleStopRecording() {
        if (!isRecording) return

        isRecording = false

        // 1. 停止前台服务
        RecordingService.stopService(this)

        // 2. 关闭蓝牙通道与本地备份
        audioRecorderManager.stopBluetoothSco()
        audioRecorderManager.stopLocalBackupRecording()

        // 3. 远程触发桌面版网页的“结束录音”
        binding.engineWebView.evaluateJavascript(
            "window.__tingwuController && window.__tingwuController.stopRecording();",
            null
        )

        // 4. 停止计时器并同步 UI
        timerHandler.removeCallbacks(timerRunnable)
        binding.uiWebView.evaluateJavascript(
            "window.onNativeRecordingStatus && window.onNativeRecordingStatus(false);",
            null
        )
    }

    // ========================================================
    // 数据流中继与设置
    // ========================================================

    fun relayTranscriptionToUi(json: String) {
        // 安全转义传给前台 WebView
        val escapedJson = json.replace("\\", "\\\\").replace("'", "\\'")
        binding.uiWebView.evaluateJavascript(
            "window.onNativeTranscriptionReceived && window.onNativeTranscriptionReceived('$escapedJson');",
            null
        )
    }

    fun updateDisplaySettings(fontSize: Int, keepScreenOn: Boolean) {
        if (keepScreenOn) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    fun showDesktopEngineView() {
        isDesktopViewActive = true
        binding.uiWebView.visibility = View.GONE
        binding.engineWebView.visibility = View.VISIBLE
        binding.btnReturnToMobileUi.visibility = View.VISIBLE
    }

    fun hideDesktopEngineView() {
        isDesktopViewActive = false
        binding.engineWebView.visibility = View.GONE
        binding.btnReturnToMobileUi.visibility = View.GONE
        binding.uiWebView.visibility = View.VISIBLE
    }

    fun reloadEngineWebView() {
        binding.engineWebView.reload()
        Toast.makeText(this, "正在重新加载听悟后台引擎…", Toast.LENGTH_SHORT).show()
    }

    fun showHistoryRecords() {
        showDesktopEngineView()
        binding.engineWebView.loadUrl(TINGWU_HOME_URL)
    }

    private fun formatTimer(totalSec: Int): String {
        val h = totalSec / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        return String.format("%02d:%02d:%02d", h, m, s)
    }

    override fun onDestroy() {
        timerHandler.removeCallbacks(timerRunnable)
        if (isRecording) {
            handleStopRecording()
        }
        super.onDestroy()
    }
}
