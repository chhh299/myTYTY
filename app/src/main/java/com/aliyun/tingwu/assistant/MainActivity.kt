package com.aliyun.tingwu.assistant

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
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
        private const val TINGWU_RECORD_URL = "https://tingwu.aliyun.com/doc/record"
        private const val PREFS_NAME = "mytyty_settings"
        private const val KEY_KEEP_SCREEN_ON = "keep_screen_on"
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var bridge: TingwuBridge
    private lateinit var audioRecorderManager: AudioRecorderManager

    private var isRecording = false
    private var recordSeconds = 0
    private var backPressedTime = 0L
    private var currentTabIndex = 1 // 默认停留在 Tab 2: 实时极简卡片界面

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

        bridge = TingwuBridge(this)
        audioRecorderManager = AudioRecorderManager(this)

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val keepScreenOn = prefs.getBoolean(KEY_KEEP_SCREEN_ON, true)
        updateDisplaySettings(120, keepScreenOn)

        initCookieManager()
        setupUiWebView()
        setupEngineWebView()
        setupTopBar()
        setupBottomNav()
        setupBackNavigation()
        requestAppPermissions()

        // 默认显示 Tab 2: 实时极简卡片，引擎在后台准备
        switchTab(1)
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
            // 加载纯净的移动卡片 UI
            loadUrl("file:///android_asset/ui/index.html")
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupEngineWebView() {
        val engine = binding.engineWebView
        DesktopSpoofHelper.setupDesktopSettings(engine)

        engine.addJavascriptInterface(bridge, "TingwuBridge")

        engine.webViewClient = TingwuWebViewClient(this) { isLoading, url ->
            binding.pageProgressBar.visibility = if (isLoading) View.VISIBLE else View.GONE
            if (url.contains("login") || url.contains("passport")) {
                binding.uiWebView.evaluateJavascript(
                    "window.onNativeEngineState && window.onNativeEngineState('need_login', '需登录阿里云');",
                    null
                )
            } else if (!isLoading && url.contains("tingwu.aliyun.com")) {
                binding.uiWebView.evaluateJavascript(
                    "window.onNativeEngineState && window.onNativeEngineState('ready', '听悟已就绪');",
                    null
                )
            }
        }

        engine.webChromeClient = TingwuWebChromeClient { progress ->
            binding.pageProgressBar.progress = progress
            if (progress >= 100) {
                binding.pageProgressBar.visibility = View.GONE
            }
        }

        // 后台静默加载真实通义听悟
        engine.loadUrl(TINGWU_HOME_URL)
    }

    private fun setupTopBar() {
        binding.btnRefreshPage.setOnClickListener {
            reloadEngine()
            binding.uiWebView.reload()
            Toast.makeText(this, "正在重新连接听悟引擎…", Toast.LENGTH_SHORT).show()
        }

        binding.btnOpenSettings.setOnClickListener {
            showSettingsDialog()
        }
    }

    private fun setupBottomNav() {
        // Tab 1: 主页 (展示官方主页，用于登录账号、解决短信验证码、管理个人空间)
        binding.tabHome.setOnClickListener {
            switchTab(0)
            binding.uiWebView.visibility = View.GONE
            binding.engineWebView.visibility = View.VISIBLE
            val currUrl = binding.engineWebView.url ?: ""
            if (!currUrl.contains("tingwu.aliyun.com/home")) {
                binding.engineWebView.loadUrl(TINGWU_HOME_URL)
            }
            binding.tvUrlSubtitle.text = "主页 · 账号登录与工作台"
        }

        // Tab 2: 实时 (专属移动端极简卡片，实时录音、双语字幕与双语翻译)
        binding.tabLive.setOnClickListener {
            switchTab(1)
            binding.engineWebView.visibility = View.GONE
            binding.uiWebView.visibility = View.VISIBLE
            binding.tvUrlSubtitle.text = "极简卡片 · 实时录音与翻译"
        }

        // Tab 3: 历史 (查看云端已保存的历史会议纪要)
        binding.tabHistory.setOnClickListener {
            switchTab(2)
            binding.uiWebView.visibility = View.GONE
            binding.engineWebView.visibility = View.VISIBLE
            binding.engineWebView.evaluateJavascript(
                "window.__mytytyScrollToHistory && window.__mytytyScrollToHistory();",
                null
            )
            binding.tvUrlSubtitle.text = "历史 · 云端会议与文档记录"
        }

        // Tab 4: 设置 (屏幕常亮、麦克风输入与关于)
        binding.tabSettings.setOnClickListener {
            showSettingsDialog()
        }
    }

    private fun switchTab(index: Int) {
        currentTabIndex = index
        val activeColor = ContextCompat.getColor(this, R.color.primary_dark)
        val inactiveColor = ContextCompat.getColor(this, R.color.nav_inactive)

        val tabTexts = listOf(binding.tvTabHome, binding.tvTabLive, binding.tvTabHistory, binding.tvTabSettings)
        val tabDots = listOf(binding.dotHome, binding.dotLive, binding.dotHistory, binding.dotSettings)

        for (i in tabTexts.indices) {
            if (i == index) {
                tabTexts[i].setTextColor(activeColor)
                tabTexts[i].typeface = Typeface.DEFAULT_BOLD
                tabDots[i].visibility = View.VISIBLE
            } else {
                tabTexts[i].setTextColor(inactiveColor)
                tabTexts[i].typeface = Typeface.DEFAULT
                tabDots[i].visibility = View.INVISIBLE
            }
        }
    }

    // =========================================================
    // 真实录音与 WebRTC 硬件生命周期联动
    // =========================================================

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

        // 1. 启动前台保活服务
        RecordingService.startService(this)

        // 2. 激活蓝牙 SCO 耳机麦克风拾音
        audioRecorderManager.startBluetoothSco()

        // 3. 启动本地双录 AAC 防灾备份
        audioRecorderManager.startLocalBackupRecording()

        // 4. 指挥后台真实的通义听悟 PC 网页开启录音
        binding.engineWebView.evaluateJavascript(
            "window.__tingwuController && window.__tingwuController.startRecording();",
            null
        )

        // 5. 启动计时器并通知前台卡片 UI 切换状态
        timerHandler.post(timerRunnable)
        binding.uiWebView.evaluateJavascript(
            "window.onNativeRecordingStatus && window.onNativeRecordingStatus(true);",
            null
        )
        binding.uiWebView.evaluateJavascript(
            "window.onNativeTimerTick && window.onNativeTimerTick('00:00:00');",
            null
        )
    }

    fun handleStopRecording() {
        if (!isRecording) return

        isRecording = false

        // 1. 停止前台保活服务
        RecordingService.stopService(this)

        // 2. 释放蓝牙与本地录音备份
        audioRecorderManager.stopBluetoothSco()
        audioRecorderManager.stopLocalBackupRecording()

        // 3. 指挥后台通义听悟网页停止录音
        binding.engineWebView.evaluateJavascript(
            "window.__tingwuController && window.__tingwuController.stopRecording();",
            null
        )

        // 4. 停止计时器并通知前台 UI
        timerHandler.removeCallbacks(timerRunnable)
        binding.uiWebView.evaluateJavascript(
            "window.onNativeRecordingStatus && window.onNativeRecordingStatus(false);",
            null
        )
    }

    // =========================================================
    // 数据穿透：后台听悟截获的实时转写 JSON $\rightarrow$ 原生中继 $\rightarrow$ 前台卡片渲染
    // =========================================================

    fun relayTranscriptionToUi(json: String) {
        val escaped = json.replace("\\", "\\\\").replace("'", "\\'")
        binding.uiWebView.evaluateJavascript(
            "window.onNativeTranscriptionReceived && window.onNativeTranscriptionReceived('$escaped');",
            null
        )
    }

    fun updateEngineState(state: String, desc: String) {
        binding.uiWebView.evaluateJavascript(
            "window.onNativeEngineState && window.onNativeEngineState('$state', '$desc');",
            null
        )
    }

    fun updateDisplaySettings(fontSize: Int, keepScreenOn: Boolean) {
        if (keepScreenOn) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_KEEP_SCREEN_ON, keepScreenOn)
            .apply()
    }

    fun reloadEngine() {
        binding.engineWebView.reload()
    }

    private fun showSettingsDialog() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val isKeep = prefs.getBoolean(KEY_KEEP_SCREEN_ON, true)

        val options = arrayOf(
            "会议防息屏常亮: ${if (isKeep) "已开启" else "已关闭"}",
            "重新加载听悟引擎",
            "清除登录 Cookie 重新登录",
            "关于 mytyty"
        )

        AlertDialog.Builder(this)
            .setTitle("设置与选项")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> {
                        val newKeep = !isKeep
                        updateDisplaySettings(120, newKeep)
                        Toast.makeText(this, "屏幕常亮已${if (newKeep) "开启" else "关闭"}", Toast.LENGTH_SHORT).show()
                    }
                    1 -> {
                        reloadEngine()
                        Toast.makeText(this, "正在刷新听悟引擎…", Toast.LENGTH_SHORT).show()
                    }
                    2 -> {
                        CookieManager.getInstance().removeAllCookies(null)
                        CookieManager.getInstance().flush()
                        binding.engineWebView.clearCache(true)
                        binding.engineWebView.loadUrl(TINGWU_HOME_URL)
                        switchTab(0)
                        binding.uiWebView.visibility = View.GONE
                        binding.engineWebView.visibility = View.VISIBLE
                        Toast.makeText(this, "已清除缓存，请在主页登录", Toast.LENGTH_SHORT).show()
                    }
                    3 -> {
                        AlertDialog.Builder(this)
                            .setTitle("关于 mytyty")
                            .setMessage("mytyty v1.0.0\n\n- 定制原生卡片 UI\n- 深度伪装 Windows 11 Chrome\n- 适配阿里云短信验证码展示\n- 真实 WebRTC 物理麦克风穿透")
                            .setPositiveButton("确定", null)
                            .show()
                    }
                }
            }
            .setNegativeButton("关闭", null)
            .show()
    }

    private fun formatTimer(totalSec: Int): String {
        val h = totalSec / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        return String.format("%02d:%02d:%02d", h, m, s)
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (currentTabIndex != 1) {
                    // 如果在主页或历史，按返回键切回实时卡片页
                    switchTab(1)
                    binding.engineWebView.visibility = View.GONE
                    binding.uiWebView.visibility = View.VISIBLE
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

    override fun onDestroy() {
        timerHandler.removeCallbacks(timerRunnable)
        if (isRecording) {
            handleStopRecording()
        }
        binding.uiWebView.destroy()
        binding.engineWebView.destroy()
        super.onDestroy()
    }
}
