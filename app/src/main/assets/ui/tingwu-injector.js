/**
 * 通义听悟桌面端页面深度注入引擎 (tingwu-injector.js)
 * 在 tingwu.aliyun.com/home 页面上下文中执行：
 * 1. WebSocket 原型链劫持（毫秒级抓取实时转写与翻译数据包）
 * 2. DOM MutationObserver 兜底文本提取
 * 3. 官方新手引导、调查问卷、遮罩弹窗自动消杀
 * 4. 录音启停事件模拟触发器
 * 5. 登录页自动切换至短信/密码 Tab
 */

(() => {
  console.log('[TingwuInjector] 听悟桌面端注入引擎已激活');

  // ========================================================
  // 1. WebSocket 嗅探引擎 (方案 B: 结构化数据直接截获)
  // ========================================================
  const OriginalWebSocket = window.WebSocket;

  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);

    try {
      // 监听接收到的数据帧
      ws.addEventListener('message', (event) => {
        try {
          if (typeof event.data === 'string') {
            const data = JSON.parse(event.data);
            handleIncomingWebSocketMessage(data);
          }
        } catch (err) {
          // 非 JSON 数据或协议二进制，静默处理
        }
      });

      // 监听发送出去的数据包（捕获连接建立或鉴权信息）
      const origSend = ws.send;
      ws.send = function (data) {
        origSend.apply(this, arguments);
      };
    } catch (e) {
      console.warn('[TingwuInjector] WebSocket 代理异常:', e);
    }

    return ws;
  };

  // 继承静态属性
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

  // 解析阿里云听悟下发的消息体结构
  function handleIncomingWebSocketMessage(payload) {
    if (!payload) return;

    let textZh = '';
    let textEn = '';
    let isFinal = false;

    // 通义听悟常见的 ASR 数据包结构适配
    // 典型结构包含: header, payload, result, sentence, text, translation
    if (payload.header && payload.payload) {
      const p = payload.payload;
      if (p.result) {
        textZh = p.result.text || p.result.transcription || '';
        textEn = p.result.translation || '';
        isFinal = !!p.result.is_final || payload.header.name === 'SentenceEnd';
      }
    } else if (payload.data) {
      const d = payload.data;
      textZh = d.text || d.sentence || '';
      textEn = d.translation || '';
      isFinal = !!d.is_final;
    } else if (payload.text || payload.content) {
      textZh = payload.text || payload.content;
      textEn = payload.translation || '';
      isFinal = !!payload.is_final;
    }

    if (textZh || textEn) {
      const messagePacket = JSON.stringify({
        source: 'websocket',
        textZh: textZh.trim(),
        textEn: textEn.trim(),
        isFinal: isFinal,
        timestamp: Date.now()
      });

      // 回传给 Android 原生桥接层
      if (window.TingwuBridge && window.TingwuBridge.onTranscriptionReceived) {
        window.TingwuBridge.onTranscriptionReceived(messagePacket);
      }

      // 派发自定义全局 DOM 事件
      window.dispatchEvent(new CustomEvent('tingwu:speech', { detail: messagePacket }));
    }
  }

  // ========================================================
  // 2. DOM MutationObserver 文本提取引擎 (方案 A: 兜底降级)
  // ========================================================
  let lastExtractedZh = '';
  let lastExtractedEn = '';

  const domObserver = new MutationObserver((mutations) => {
    // 寻找转写展示容器
    const transcriptContainers = document.querySelectorAll(
      '[class*="transcript"], [class*="subtitle"], [class*="sentence"], [class*="realtime-content"]'
    );

    if (transcriptContainers.length > 0) {
      const latestContainer = transcriptContainers[transcriptContainers.length - 1];
      const text = latestContainer.innerText || '';

      if (text && text !== lastExtractedZh && text.length > 3) {
        lastExtractedZh = text;

        const packet = JSON.stringify({
          source: 'dom_observer',
          textZh: text.trim(),
          textEn: lastExtractedEn,
          isFinal: false,
          timestamp: Date.now()
        });

        if (window.TingwuBridge && window.TingwuBridge.onTranscriptionReceived) {
          window.TingwuBridge.onTranscriptionReceived(packet);
        }
      }
    }

    // 顺便执行弹窗自动消杀
    dismissOfficialModals();
  });

  // 在 DOM 树加载后启动监听
  window.addEventListener('DOMContentLoaded', () => {
    domObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    autoSwitchLoginTabs();
  });

  // ========================================================
  // 3. 官方弹窗、遮罩层与新手引导自动消杀
  // ========================================================
  function dismissOfficialModals() {
    // 寻找问卷、新手引导、宣传横幅关闭按钮
    const closeButtons = document.querySelectorAll(
      '.ant-modal-close, button[aria-label="Close"], .guide-dialog-close, .aliyun-survey-close, [class*="close-icon"], [class*="guide-close"]'
    );

    closeButtons.forEach(btn => {
      // 避免关闭用户核心操作对话框，只关闭引导类弹窗
      const modal = btn.closest('.ant-modal, .aliyun-modal, [class*="dialog"]');
      if (modal) {
        const modalText = modal.innerText || '';
        if (modalText.includes('新手引导') || modalText.includes('问卷调研') || modalText.includes('体验新版') || modalText.includes('知道啦')) {
          btn.click();
          console.log('[TingwuInjector] 已自动消杀官方引导弹窗');
        }
      }
    });
  }

  // ========================================================
  // 4. 登录页优化（自动切换到短信/密码 Tab，破解扫码困局）
  // ========================================================
  function autoSwitchLoginTabs() {
    if (location.host.includes('login') || location.host.includes('passport') || document.querySelector('.login-form')) {
      setTimeout(() => {
        const tabs = document.querySelectorAll('.ant-tabs-tab, [class*="tab-item"], .login-tab');
        tabs.forEach(tab => {
          const text = tab.innerText || '';
          if (text.includes('验证码') || text.includes('短信') || text.includes('密码')) {
            tab.click();
            console.log('[TingwuInjector] 登录页已自动切换至短信/密码 Tab');
          }
        });
      }, 500);
    }
  }

  // ========================================================
  // 5. 供 Android 原生调用的远程操作控制器
  // ========================================================
  window.__tingwuController = {
    // 模拟点击“开始录音”
    startRecording: () => {
      console.log('[TingwuInjector] 正在寻找桌面端开始录音按钮...');
      // 遍历查找包含“开始录音”、“实时记录”关键词的按钮
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"], [class*="record-btn"]'));
      const recordBtn = buttons.find(b => {
        const txt = (b.innerText || '').trim();
        return txt === '开始录音' || txt === '开始记录' || txt.includes('开始录音');
      });

      if (recordBtn) {
        simulateMouseClick(recordBtn);
        console.log('[TingwuInjector] 已触发开始录音');
        return true;
      } else {
        console.warn('[TingwuInjector] 未定位到开始录音按钮，尝试点击悬浮主入口');
        const mainEntry = document.querySelector('[class*="realtime-entry"], [class*="start-btn"]');
        if (mainEntry) {
          simulateMouseClick(mainEntry);
          return true;
        }
      }
      return false;
    },

    // 模拟点击“结束录音”
    stopRecording: () => {
      console.log('[TingwuInjector] 正在寻找结束录音按钮...');
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
      const stopBtn = buttons.find(b => {
        const txt = (b.innerText || '').trim();
        return txt === '结束' || txt === '停止录音' || txt === '完成记录';
      });

      if (stopBtn) {
        simulateMouseClick(stopBtn);
        console.log('[TingwuInjector] 已触发结束录音');
        return true;
      }
      return false;
    }
  };

  // 模拟真实的鼠标点击事件（规避部分前端框架只响应 MouseEvent 的问题）
  function simulateMouseClick(element) {
    const mouseEvents = ['mousedown', 'mouseup', 'click'];
    mouseEvents.forEach(type => {
      const evt = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window
      });
      element.dispatchEvent(evt);
    });
  }

})();
