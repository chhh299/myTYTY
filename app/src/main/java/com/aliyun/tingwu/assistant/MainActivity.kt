package com.aliyun.tingwu.assistant

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.aliyun.tingwu.assistant.databinding.ActivityMainBinding
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
        private const val KEY_ZOOM_LARGE = "zoom_large"
    }

    private lateinit var binding: ActivityMainBinding
    private var backPressedTime = 0L
    private var currentTabIndex = 0
    private var isZoomLarge = false
    private var isKeepScreenOn = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        loadSettings()
        applyKeepScreenOn(isKeepScreenOn)

        initCookieManager()
        setupMainWebView()
        setupTopBar()
        setupBottomNav()
        setupBackNavigation()
        requestAppPermissions()

        // 默认加载通义听悟官方主页
        binding.mainWebView.loadUrl(TINGWU_HOME_URL)
    }

    private fun initCookieManager() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(binding.mainWebView, true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupMainWebView() {
        val webView = binding.mainWebView
        DesktopSpoofHelper.setupDesktopSettings(webView)

        if (isZoomLarge) {
            webView.settings.textZoom = 125
        } else {
            webView.settings.textZoom = 100
        }

        webView.webViewClient = TingwuWebViewClient(this) { isLoading, url ->
            binding.pageProgressBar.visibility = if (isLoading) View.VISIBLE else View.GONE
            updateUrlSubtitle(url)
        }

        webView.webChromeClient = TingwuWebChromeClient { progress ->
            binding.pageProgressBar.progress = progress
            if (progress >= 100) {
                binding.pageProgressBar.visibility = View.GONE
            }
        }
    }

    private fun setupTopBar() {
        // 刷新按钮
        binding.btnRefreshPage.setOnClickListener {
            binding.mainWebView.reload()
            Toast.makeText(this, "正在刷新听悟页面…", Toast.LENGTH_SHORT).show()
        }

        // 视口文字放大切换
        binding.btnToggleZoom.setOnClickListener {
            isZoomLarge = !isZoomLarge
            binding.mainWebView.settings.textZoom = if (isZoomLarge) 125 else 100
            saveBooleanSetting(KEY_ZOOM_LARGE, isZoomLarge)
            val tip = if (isZoomLarge) "已切换至大字号排版 (125%)" else "已恢复标准字号 (100%)"
            Toast.makeText(this, tip, Toast.LENGTH_SHORT).show()
        }

        // 设置入口
        binding.btnOpenSettings.setOnClickListener {
            showSettingsDialog()
        }
    }

    private fun setupBottomNav() {
        // Tab 1: 主页 (用于查看主页、登录账号、查看工作台)
        binding.tabHome.setOnClickListener {
            setActiveTab(0)
            val currentUrl = binding.mainWebView.url ?: ""
            if (!currentUrl.contains("tingwu.aliyun.com/home")) {
                binding.mainWebView.loadUrl(TINGWU_HOME_URL)
            } else {
                binding.mainWebView.evaluateJavascript("window.scrollTo({top: 0, behavior: 'smooth'});", null)
            }
        }

        // Tab 2: 实时 (进入实时语音识别与中英翻译工作台)
        binding.tabLive.setOnClickListener {
            setActiveTab(1)
            // 优先通过脚本触发当前页面的“实时记录”卡片，若不在主页则直接路由至录音页
            val triggerJs = """
                (function() {
                    if (window.__mytytyGotoLiveRecord && window.__mytytyGotoLiveRecord()) {
                        return 'clicked';
                    } else {
                        window.location.href = '$TINGWU_RECORD_URL';
                        return 'routed';
                    }
                })();
            """.trimIndent()
            binding.mainWebView.evaluateJavascript(triggerJs) {
                Toast.makeText(this, "正在进入实时录音与翻译工作台…", Toast.LENGTH_SHORT).show()
            }
        }

        // Tab 3: 历史 (查看云端保存的历史会议与转写文档列表)
        binding.tabHistory.setOnClickListener {
            setActiveTab(2)
            val currentUrl = binding.mainWebView.url ?: ""
            if (currentUrl.contains("tingwu.aliyun.com/home")) {
                binding.mainWebView.evaluateJavascript("window.__mytytyScrollToHistory && window.__mytytyScrollToHistory();", null)
            } else {
                binding.mainWebView.loadUrl(TINGWU_HOME_URL)
            }
        }

        // Tab 4: 设置 (屏幕常亮、字体、缓存清理等)
        binding.tabSettings.setOnClickListener {
            setActiveTab(3)
            showSettingsDialog()
        }
    }

    private fun setActiveTab(index: Int) {
        currentTabIndex = index
        val activeColor = ContextCompat.getColor(this, R.color.primary_dark)
        val inactiveColor = ContextCompat.getColor(this, android.R.color.darker_gray)

        val tabTexts = listOf(binding.tvTabHome, binding.tvTabLive, binding.tvTabHistory, binding.tvTabSettings)
        val tabDots = listOf(binding.dotHome, binding.dotLive, binding.dotHistory, binding.dotSettings)

        for (i in tabTexts.indices) {
            if (i == index) {
                tabTexts[i].setTextColor(activeColor)
                tabTexts[i].paint.isFakeBoldText = true
                tabDots[i].visibility = View.VISIBLE
            } else {
                tabTexts[i].setTextColor(inactiveColor)
                tabTexts[i].paint.isFakeBoldText = false
                tabDots[i].visibility = View.INVISIBLE
            }
        }
    }

    private fun updateUrlSubtitle(url: String) {
        val cleanSub = when {
            url.contains("/doc/record") || url.contains("/doc/live") -> "实时录音工作台"
            url.contains("/home") -> "tingwu.aliyun.com/home"
            url.contains("login") || url.contains("passport") -> "阿里云安全登录"
            else -> "tingwu.aliyun.com"
        }
        binding.tvUrlSubtitle.text = cleanSub
    }

    private fun showSettingsDialog() {
        val options = arrayOf(
            "会议屏幕常亮: ${if (isKeepScreenOn) "已开启" else "已关闭"}",
            "页面排版字号: ${if (isZoomLarge) "大字号 (125%)" else "标准 (100%)"}",
            "重新加载通义听悟",
            "清除登录缓存并重新登录",
            "关于 mytyty"
        )

        AlertDialog.Builder(this)
            .setTitle("mytyty 设置与辅助")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> {
                        isKeepScreenOn = !isKeepScreenOn
                        applyKeepScreenOn(isKeepScreenOn)
                        saveBooleanSetting(KEY_KEEP_SCREEN_ON, isKeepScreenOn)
                        Toast.makeText(this, "屏幕常亮已${if (isKeepScreenOn) "开启" else "关闭"}", Toast.LENGTH_SHORT).show()
                    }
                    1 -> {
                        isZoomLarge = !isZoomLarge
                        binding.mainWebView.settings.textZoom = if (isZoomLarge) 125 else 100
                        saveBooleanSetting(KEY_ZOOM_LARGE, isZoomLarge)
                        Toast.makeText(this, if (isZoomLarge) "已切换至大字号" else "已恢复标准字号", Toast.LENGTH_SHORT).show()
                    }
                    2 -> {
                        binding.mainWebView.reload()
                        Toast.makeText(this, "正在刷新页面…", Toast.LENGTH_SHORT).show()
                    }
                    3 -> {
                        CookieManager.getInstance().removeAllCookies(null)
                        CookieManager.getInstance().flush()
                        binding.mainWebView.clearCache(true)
                        binding.mainWebView.loadUrl(TINGWU_HOME_URL)
                        Toast.makeText(this, "已清除缓存，正在进入登录页面…", Toast.LENGTH_SHORT).show()
                    }
                    4 -> {
                        AlertDialog.Builder(this)
                            .setTitle("关于 mytyty")
                            .setMessage("mytyty v1.0.0\n\n- 深度伪装 Windows 11 Chrome 桌面环境\n- 适配阿里云短信验证码登录\n- 原生 WebRTC 麦克风音频直通\n- 会议长程屏幕防息屏常亮")
                            .setPositiveButton("确定", null)
                            .show()
                    }
                }
            }
            .setNegativeButton("关闭", null)
            .show()
    }

    private fun applyKeepScreenOn(keep: Boolean) {
        if (keep) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    private fun loadSettings() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        isKeepScreenOn = prefs.getBoolean(KEY_KEEP_SCREEN_ON, true)
        isZoomLarge = prefs.getBoolean(KEY_ZOOM_LARGE, false)
    }

    private fun saveBooleanSetting(key: String, value: Boolean) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(key, value)
            .apply()
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.mainWebView.canGoBack()) {
                    binding.mainWebView.goBack()
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
        binding.mainWebView.destroy()
        super.onDestroy()
    }
}
