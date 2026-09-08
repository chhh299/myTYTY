package com.aliyun.tingwu.assistant

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
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
        private const val PREFS_NAME = "mytyty_settings"
        private const val KEY_KEEP_SCREEN_ON = "keep_screen_on"
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var bridge: TingwuBridge

    private var isRecording = false
    private var recordSeconds = 0
    private var backPressedTime = 0L
    private var currentTabIndex = 1 // 默认停留在 Tab 1: 实时极简卡片界面
    private var currentEngineState = "loading" // 由网页注入感知器更新：loading | need_login | ready

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

    // 监听通知栏“结束录音”广播闭环
    private val stopRecordingReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == RecordingService.BROADCAST_STOP_RECORDING) {
                handleStopRecording()
            }
        }
    }

    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    // 录音握手安全看门狗：防止网络卡顿或页面未响应导致 UI 永远卡死在“正在连接引擎…”
    private val ackWatchdogRunnable = Runnable {
        if (!isRecording) {
            binding.uiWebView.evaluateJavascript(
                "window.onNativeRecordingPending && window.onNativeRecordingPending(false);",
                null
            )
            RecordingService.stopService(this@MainActivity)
            Toast.makeText(this@MainActivity, "连接听悟引擎超时，请检查网络或在“主页”确认登录状态", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // 开启 Chrome 远程调试开关，可通过电脑 chrome://inspect 排查听悟控制台与网络
        WebView.setWebContentsDebuggingEnabled(true)

        bridge = TingwuBridge(this)

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val keepScreenOn = prefs.getBoolean(KEY_KEEP_SCREEN_ON, true)
        updateDisplaySettings(120, keepScreenOn)

        initCookieManager()
        setupUiWebView()
        setupEngineWebView()
        setupTopBar()
        setupBottomNav()
        setupBackNavigation()
        registerStopReceiver()
        setupNetworkMonitor()
        requestAppPermissions()

        // 默认显示 Tab 1: 实时极简卡片，引擎在后台准备
        switchTab(1)
    }

    private fun registerStopReceiver() {
        val filter = IntentFilter(RecordingService.BROADCAST_STOP_RECORDING)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stopRecordingReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(stopRecordingReceiver, filter)
        }
    }

    private fun setupNetworkMonitor() {
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread {
                    if (isRecording) {
                        binding.uiWebView.evaluateJavascript(
                            "window.onNativeEngineState && window.onNativeEngineState('ready', '网络已重连');",
                            null
                        )
                    }
                }
            }

            override fun onLost(network: Network) {
                runOnUiThread {
                    binding.uiWebView.evaluateJavascript(
                        "window.onNativeEngineState && window.onNativeEngineState('loading', '网络连接已断开');",
                        null
                    )
                }
            }
        }
        networkCallback?.let {
            connectivityManager?.registerDefaultNetworkCallback(it)
        }
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

        engine.webViewClient = TingwuWebViewClient(this) { isLoading, url ->
            binding.pageProgressBar.visibility = if (isLoading) View.VISIBLE else View.GONE

            if (isLoading) {
                // 加载中，只更新状态为 loading，绝不提前虚假判定为 ready
                binding.uiWebView.evaluateJavascript(
                    "window.onNativeEngineState && window.onNativeEngineState('loading', '听悟连接中…');",
                    null
                )
            } else {
                // 页面加载完成，触发注入脚本执行精准 DOM 状态检测 (由 Bridge 统一上报真实 need_login 或 ready)
                binding.engineWebView.evaluateJavascript(
                    "window.checkEngineState && window.checkEngineState();",
                    null
                )
            }

            // 登录弹窗/独立登录页深度自适应接管
            if (url.contains("login") || url.contains("passport")) {
                if (currentTabIndex == 0) {
                    binding.uiWebView.visibility = View.INVISIBLE
                    binding.engineWebView.visibility = View.VISIBLE
                }
            } else if (!isLoading && url.contains("tingwu.aliyun.com")) {
                // 登录成功跳回后，若在实时卡片(1)，确保前台卡片覆盖恢复
                if (currentTabIndex == 1) {
                    binding.engineWebView.visibility = View.VISIBLE
                    binding.uiWebView.visibility = View.VISIBLE
                }
            }
        }

        engine.webChromeClient = TingwuWebChromeClient { progress ->
            binding.pageProgressBar.progress = progress
            if (progress >= 100) {
                binding.pageProgressBar.visibility = View.GONE
            }
        }

        // 后台加载真实通义听悟
        engine.loadUrl(TINGWU_HOME_URL)
    }

    private fun setupTopBar() {
        binding.btnRefreshPage.setOnClickListener {
            if (isRecording) {
                AlertDialog.Builder(this)
                    .setTitle("提示")
                    .setMessage("当前正在录音中，刷新将重置连接并终止录音，是否确认？")
                    .setPositiveButton("确定刷新") { _, _ ->
                        handleStopRecording()
                        reloadEngine()
                        binding.uiWebView.reload()
                    }
                    .setNegativeButton("取消", null)
                    .show()
                return@setOnClickListener
            }

            reloadEngine()
            binding.uiWebView.reload()
            Toast.makeText(this, "正在重新连接听悟引擎…", Toast.LENGTH_SHORT).show()
        }

        binding.btnOpenSettings.setOnClickListener {
            showSettingsDialog()
        }
    }

    private fun setupBottomNav() {
        // Tab 0: 主页 (展示官方主页，用于登录账号、解决短信验证码、管理个人空间)
        binding.tabHome.setOnClickListener {
            if (isRecording) {
                Toast.makeText(this, "正在实时录音中，请先结束录音再切换页面", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            switchTab(0)
            binding.uiWebView.visibility = View.INVISIBLE
            binding.engineWebView.visibility = View.VISIBLE
            val currUrl = binding.engineWebView.url ?: ""
            if (!currUrl.contains("tingwu.aliyun.com/home") && !currUrl.contains("passport")) {
                binding.engineWebView.loadUrl(TINGWU_HOME_URL)
            }
            binding.tvUrlSubtitle.text = "主页 · 账号登录与工作台"
        }

        // Tab 1: 实时 (专属移动端极简卡片，实时录音、双语字幕与双语翻译)
        binding.tabLive.setOnClickListener {
            switchTab(1)
            binding.engineWebView.visibility = View.VISIBLE
            binding.uiWebView.visibility = View.VISIBLE
            binding.uiWebView.evaluateJavascript(
                "window.onNativeSwitchView && window.onNativeSwitchView('live');",
                null
            )
            binding.tvUrlSubtitle.text = "极简卡片 · 实时录音与翻译"
        }

        // Tab 2: 历史 (纯正移动端历史会议卡片列表，坚决杜绝直接裸露原版 PC 网页)
        binding.tabHistory.setOnClickListener {
            if (isRecording) {
                Toast.makeText(this, "正在实时录音中，请先结束录音再切换页面", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            switchTab(2)
            // 关键修复：保持 uiWebView 前台显示移动端卡片，绝不让 PC 原版网页裸露！
            binding.engineWebView.visibility = View.VISIBLE
            binding.uiWebView.visibility = View.VISIBLE
            binding.uiWebView.evaluateJavascript(
                "window.onNativeSwitchView && window.onNativeSwitchView('history');",
                null
            )
            // 通知后台引擎抓取最新历史记录并回传
            fetchHistoryListFromEngine()
            binding.tvUrlSubtitle.text = "历史 · 云端会议纪要卡片"
        }

        // Tab 3: 设置
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
    // 真实录音与 WebRTC 硬件生命周期联动 (双向 ACK 协议，杜绝假录音)
    // =========================================================

    fun handleStartRecording() {
        if (isRecording) return

        // 若当前听悟引擎明确处于未登录状态，直接阻断并引导用户去主页登录
        if (currentEngineState == "need_login") {
            Toast.makeText(this, "未检测到阿里云账号登录，请先在“主页”完成登录", Toast.LENGTH_LONG).show()
            // 自动帮用户切换到主页，便于输入短信或扫码
            binding.tabHome.performClick()
            return
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            requestAppPermissions()
            Toast.makeText(this, "请先授予麦克风权限", Toast.LENGTH_SHORT).show()
            return
        }

        // 先向前台卡片抛出“正在连接听悟引擎”的缓冲态，严禁未响应就直接走表
        binding.uiWebView.evaluateJavascript(
            "window.onNativeRecordingPending && window.onNativeRecordingPending(true);",
            null
        )

        // 1. 启动前台保活服务 (持 WakeLock)
        RecordingService.startService(this)

        // 2. 启动 8 秒看门狗，防止未响应导致界面一直死锁在“正在连接引擎…”
        timerHandler.removeCallbacks(ackWatchdogRunnable)
        timerHandler.postDelayed(ackWatchdogRunnable, 8000)

        // 3. 指挥后台真实的通义听悟 PC 网页开启录音
        binding.engineWebView.evaluateJavascript(
            "window.__tingwuController && window.__tingwuController.startRecording();",
            null
        )
    }

    /**
     * 收到后台听悟网页的真实 ACK 确认后，才正式翻转状态并开始计时
     */
    fun handleRecordingAck(started: Boolean) {
        timerHandler.removeCallbacks(ackWatchdogRunnable)

        if (started) {
            isRecording = true
            recordSeconds = 0

            timerHandler.post(timerRunnable)
            binding.uiWebView.evaluateJavascript(
                "window.onNativeRecordingStatus && window.onNativeRecordingStatus(true);",
                null
            )
            binding.uiWebView.evaluateJavascript(
                "window.onNativeTimerTick && window.onNativeTimerTick('00:00:00');",
                null
            )
        } else {
            isRecording = false
            RecordingService.stopService(this)
            binding.uiWebView.evaluateJavascript(
                "window.onNativeRecordingPending && window.onNativeRecordingPending(false);",
                null
            )
            Toast.makeText(this, "启动录音失败，请确认已在主页登录阿里云账号", Toast.LENGTH_LONG).show()
        }
    }

    fun handleStopRecording() {
        if (!isRecording) return

        isRecording = false

        // 1. 停止前台保活服务
        RecordingService.stopService(this)

        // 2. 指挥后台通义听悟网页停止录音
        binding.engineWebView.evaluateJavascript(
            "window.__tingwuController && window.__tingwuController.stopRecording();",
            null
        )

        // 3. 停止计时器并通知前台 UI
        timerHandler.removeCallbacks(timerRunnable)
        binding.uiWebView.evaluateJavascript(
            "window.onNativeRecordingStatus && window.onNativeRecordingStatus(false);",
            null
        )
    }

    // =========================================================
    // 数据穿透：Base64 编码传输，安全可靠
    // =========================================================

    fun relayTranscriptionToUi(json: String) {
        try {
            val base64Str = Base64.encodeToString(json.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
            binding.uiWebView.evaluateJavascript(
                "window.__receiveTranscriptionBase64 && window.__receiveTranscriptionBase64('$base64Str');",
                null
            )
        } catch (e: Exception) {
            val escaped = json.replace("\\", "\\\\").replace("'", "\\'")
            binding.uiWebView.evaluateJavascript(
                "window.onNativeTranscriptionReceived && window.onNativeTranscriptionReceived('$escaped');",
                null
            )
        }
    }

    fun updateEngineState(state: String, desc: String) {
        currentEngineState = state
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

    // =========================================================
    // 历史记录卡片双向通道
    // =========================================================

    fun fetchHistoryListFromEngine() {
        binding.engineWebView.evaluateJavascript(
            "window.fetchHistoryList && window.fetchHistoryList();",
            null
        )
    }

    fun relayHistoryListToUi(json: String) {
        val escaped = json.replace("\\", "\\\\").replace("'", "\\'")
        binding.uiWebView.evaluateJavascript(
            "window.onNativeHistoryReceived && window.onNativeHistoryReceived('$escaped');",
            null
        )
    }

    fun handleOpenHistoryDetail(docId: String) {
        Toast.makeText(this, "正在打开会议转写详情…", Toast.LENGTH_SHORT).show()
        // 点击单项可在后台直接加载该详情页，并暂时切到全屏浏览
        binding.uiWebView.visibility = View.INVISIBLE
        binding.engineWebView.visibility = View.VISIBLE
        if (docId.isNotEmpty() && !docId.startsWith("history_")) {
            binding.engineWebView.loadUrl("https://tingwu.aliyun.com/doc/record/$docId")
        }
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
                            .setMessage("mytyty v1.0.0\n\n- 专属极简移动卡片 UI\n- 深度伪装 Windows 11 Chrome\n- 适配阿里云短信验证码展示\n- 真实 WebRTC 物理麦克风穿透")
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
                // SPEC 8.7 规范：若当前处于主页(0)或历史(2)展示网页，优先允许在 WebView 内部后退 (修复 P1-3)
                if (currentTabIndex != 1 && binding.engineWebView.visibility == View.VISIBLE && binding.engineWebView.canGoBack()) {
                    binding.engineWebView.goBack()
                    return
                }

                if (currentTabIndex != 1) {
                    switchTab(1)
                    binding.engineWebView.visibility = View.GONE
                    binding.uiWebView.visibility = View.VISIBLE
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
        try {
            unregisterReceiver(stopRecordingReceiver)
        } catch (e: Exception) {}

        try {
            networkCallback?.let { connectivityManager?.unregisterNetworkCallback(it) }
        } catch (e: Exception) {}

        timerHandler.removeCallbacks(timerRunnable)
        if (isRecording) {
            handleStopRecording()
        }
        binding.uiWebView.destroy()
        binding.engineWebView.destroy()
        super.onDestroy()
    }
}
