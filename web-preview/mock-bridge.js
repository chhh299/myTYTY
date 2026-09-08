/**
 * 听悟移动助手 - 桥接驱动与模拟引擎 (Mock Bridge Simulator)
 * 在浏览器独立运行模式下，模拟真实的通义听悟语音转写与双向通信流。
 * 在 Android App 环境中，自动退让给原生的 window.TingwuBridge。
 */

(() => {
  // 如果当前在原生 Android WebView 中，且已注入 TingwuBridge，则不加载 Mock
  if (window.TingwuBridge && !window.__MOCK_MODE_FORCE__) {
    console.log('[TingwuBridge] 已检测到原生 Android 桥接实例');
    return;
  }

  console.log('[TingwuBridge] 运行在 Web 独立测试/预览模式，启动仿真引擎');

  // 模拟真实会议演讲对话语料库
  const MOCK_SPEECH_STREAM = [
    {
      zh: "今天我们主要讨论一下这个方案，手机端只需要保持网页在桌面模式，其余逻辑都交给听悟处理。",
      en: "Today we mainly discussed this approach. The mobile app only needs to keep the web page in desktop mode.",
      duration: 3500
    },
    {
      zh: "通过在 Android 底层伪装 Windows 11 Chrome 的 User-Agent 和 Client Hints，我们可以无缝绕过移动端限制。",
      en: "By spoofing Windows 11 Chrome User-Agent and Client Hints at the Android layer, we can seamlessly bypass mobile restrictions.",
      duration: 4000
    },
    {
      zh: "同时，前台采用双层解耦架构，保证了界面的流畅度和绝对的稳定性，完全不受网页改版的影响。",
      en: "Meanwhile, the dual-layer decoupled architecture ensures UI smoothness and absolute stability, immune to web updates.",
      duration: 3800
    },
    {
      zh: "后台前台服务和蓝牙耳机 SCO 麦克风通道已经就绪，可以支持数小时连续会议录音。",
      en: "The background foreground service and Bluetooth SCO microphone routing are ready for continuous multi-hour recording.",
      duration: 3600
    },
    {
      zh: "大家对这个设计和落地节奏有什么补充意见吗？",
      en: "Does anyone have any additional thoughts on this design and implementation roadmap?",
      duration: 3000
    }
  ];

  class MockTingwuBridge {
    constructor() {
      this.isRecording = true; // 默认匹配 Mockup 中的正在录音状态
      this.currentSentenceIndex = 0;
      this.timerSeconds = 12 * 60 + 47; // 对应 Mockup 的 00:12:47
      this.timerInterval = null;
      this.streamTimeout = null;

      this.listeners = {
        transcription: [],
        statusChange: [],
        timerTick: []
      };

      this.startTimer();
      this.startSimulatedSpeechStream();
    }

    // 订阅事件
    on(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event].push(callback);
      }
    }

    emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(fn => fn(data));
      }
    }

    // 前台点击“开始录音”
    startRecording() {
      if (this.isRecording) return;
      this.isRecording = true;
      this.startTimer();
      this.startSimulatedSpeechStream();
      this.emit('statusChange', { isRecording: true });
      console.log('[MockBridge] 触发开始录音');
    }

    // 前台点击“结束录音”
    stopRecording() {
      if (!this.isRecording) return;
      this.isRecording = false;
      if (this.timerInterval) clearInterval(this.timerInterval);
      if (this.streamTimeout) clearTimeout(this.streamTimeout);
      this.emit('statusChange', { isRecording: false });
      console.log('[MockBridge] 触发结束录音');
    }

    // 计时器驱动
    startTimer() {
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = setInterval(() => {
        this.timerSeconds++;
        const formatted = this.formatTime(this.timerSeconds);
        this.emit('timerTick', formatted);
      }, 1000);
    }

    formatTime(sec) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const pad = n => String(n).padStart(2, '0');
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }

    // 模拟实时语音转写流下发
    startSimulatedSpeechStream() {
      if (!this.isRecording) return;

      const item = MOCK_SPEECH_STREAM[this.currentSentenceIndex];
      const chars = item.zh.split('');
      let charIdx = 0;

      // 模拟逐字/逐词实时蹦出
      const typeNextChar = () => {
        if (!this.isRecording) return;

        charIdx += Math.floor(Math.random() * 2) + 1;
        if (charIdx < chars.length) {
          const partialZh = chars.slice(0, charIdx).join('') + '…';
          this.emit('transcription', {
            isFinal: false,
            textZh: partialZh,
            textEn: item.en.slice(0, Math.floor(item.en.length * (charIdx / chars.length)))
          });
          this.streamTimeout = setTimeout(typeNextChar, 120 + Math.random() * 80);
        } else {
          // 当前句完结确认
          this.emit('transcription', {
            isFinal: true,
            textZh: item.zh,
            textEn: item.en
          });

          this.currentSentenceIndex = (this.currentSentenceIndex + 1) % MOCK_SPEECH_STREAM.length;
          this.streamTimeout = setTimeout(() => {
            this.startSimulatedSpeechStream();
          }, 1800);
        }
      };

      this.streamTimeout = setTimeout(typeNextChar, 800);
    }

    // 设置项联动
    updateSettings(fontSize, keepScreenOn) {
      console.log(`[MockBridge] 更新设置: 字号=${fontSize}%, 屏幕常亮=${keepScreenOn}`);
    }

    // 切换电脑完整视图
    toggleDesktopView() {
      alert('【模拟提示】已切换到通义听悟 PC 桌面网页视图。在 Android 原生端将直接展开全屏后台 WebView。');
    }

    // 复制剪贴板
    copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(() => {
        alert('已复制到系统剪贴板！');
      }).catch(() => {
        alert('复制失败，请手动选择复制');
      });
    }
  }

  // 挂载到全局
  window.TingwuBridge = new MockTingwuBridge();
})();
