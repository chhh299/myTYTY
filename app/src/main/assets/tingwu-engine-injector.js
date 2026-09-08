/**
 * 通义听悟后台引擎数据穿透与控制脚本 (tingwu-engine-injector.js)
 * 注入至真实的 https://tingwu.aliyun.com 页面上下文中
 * 负责：统一句子流规整（消灭双胞胎气泡）、录音双向 ACK 握手、登录状态感知与多模态按钮控制
 */

(() => {
  console.log('[mytyty-engine] 听悟后台数据穿透引擎已启动');

  // 全局句子索引与文本去重映射 (解决 P0-2 孪生双胞胎气泡)
  let currentSentenceIndex = 0;
  let lastReportedOriginal = '';
  let lastReportedTrans = '';
  let lastStreamActiveTime = Date.now();

  // =========================================================
  // 1. 拦截 WebSocket 实时音频转写与翻译数据帧 (主通道)
  // =========================================================
  const OrigWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);

    ws.addEventListener('message', function(event) {
      try {
        if (typeof event.data === 'string') {
          handleWsStringMessage(event.data);
        }
      } catch (e) {
        // 忽略非 JSON 数据包
      }
    });

    return ws;
  };
  window.WebSocket.prototype = OrigWebSocket.prototype;

  // 拷贝 WebSocket 静态常量，避免第三方库或业务检测 readyState 抛错 (修复 P1-2)
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(key => {
    if (OrigWebSocket[key] !== undefined) {
      window.WebSocket[key] = OrigWebSocket[key];
    }
  });

  function handleWsStringMessage(msg) {
    if (!msg || msg.length < 5) return;
    try {
      const parsed = JSON.parse(msg);

      let originalText = '';
      let translationText = '';

      if (parsed.header && parsed.payload) {
        const hName = parsed.header.name || '';
        const payload = parsed.payload;

        if (hName.includes('Result') || hName.includes('Sentence') || hName.includes('Transcription')) {
          originalText = payload.result || payload.text || '';
          translationText = payload.translation || payload.trans || '';
        }
      } else if (parsed.text || parsed.result) {
        originalText = parsed.text || parsed.result || '';
        translationText = parsed.translation || parsed.trans || '';
      }

      if (originalText || translationText) {
        normalizeAndDispatchSentence(originalText, translationText);
      }
    } catch (e) {}
  }

  // =========================================================
  // 2. DOM MutationObserver 实时转写穿透 (强力兜底通道)
  // =========================================================
  const domObserver = new MutationObserver(() => {
    extractTextFromDom();
    checkEngineState();
  });

  function startObserver() {
    if (document.body) {
      domObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
      checkEngineState();
    } else {
      setTimeout(startObserver, 100);
    }
  }
  startObserver();

  function extractTextFromDom() {
    const sentenceElements = document.querySelectorAll(
      '[class*="sentence-item"], [class*="transcript-item"], [class*="realtime-sentence"], .sentence-item'
    );

    if (sentenceElements.length > 0) {
      const lastSentence = sentenceElements[sentenceElements.length - 1];
      const textEl = lastSentence.querySelector('[class*="text"], [class*="content"], p, span') || lastSentence;
      const transEl = lastSentence.querySelector('[class*="translation"], [class*="trans"], [class*="target"]');

      const originalText = (textEl.innerText || '').trim();
      const translationText = transEl ? (transEl.innerText || '').trim() : '';

      if (originalText || translationText) {
        normalizeAndDispatchSentence(originalText, translationText);
      }
    }
  }

  /**
   * 统一句子流规整器 (彻底根治 P0-2 孪生双胞胎气泡缺陷 & P1-1 长新句换句覆盖缺陷)
   * 无论来自 WS 还是来自 DOM，统一基于单唯一的活动句索引递增与内容更新
   */
  function normalizeAndDispatchSentence(original, translation) {
    if (!original && !translation) return;

    // 内容无变化直接忽略
    if (original === lastReportedOriginal && translation === lastReportedTrans) {
      return;
    }

    lastStreamActiveTime = Date.now();

    // 严密换句启发式逻辑 (修复 P1-1)：
    // 1. 若旧文本为空，则属于首句，不自增；
    // 2. 若新文本为旧文本的前缀延展 (startsWith)，说明是流式增量追加，更新同一句；
    // 3. 若旧文本以句号/问号/叹号等标点结尾，且新文本不以旧文本开头，判定为换句；
    // 4. 若新文本既不以旧文本开头，也不是旧文本的流式修正 (长度明显回缩或完全非前缀)，判定为换句。
    if (lastReportedOriginal) {
      const isPrefixExtension = original.startsWith(lastReportedOriginal);
      const isPunctuationClosed = /[。？！\n\r?!]$/.test(lastReportedOriginal.trim());

      if (!isPrefixExtension) {
        // 既不是流式前缀追加，且旧句已标点完结，或者新句内容与旧句无包含重叠，判定换句
        if (isPunctuationClosed || !original.includes(lastReportedOriginal)) {
          currentSentenceIndex++;
        }
      }
    }

    lastReportedOriginal = original;
    lastReportedTrans = translation;

    relayDataToNative({
      id: 'active_sentence_' + currentSentenceIndex,
      text: original,
      translation: translation,
      time: new Date().toTimeString().split(' ')[0]
    });
  }

  function relayDataToNative(data) {
    if (window.TingwuBridge && window.TingwuBridge.onTranscriptionReceived) {
      window.TingwuBridge.onTranscriptionReceived(JSON.stringify(data));
    }
  }

  // =========================================================
  // 3. 状态感知与无流看门狗
  // =========================================================
  function checkEngineState() {
    const url = window.location.href;
    const isLoginUrl = url.includes('login') || url.includes('passport');
    const hasLoginModal = document.querySelector('.aliyun-login-component-wrapper, .login-intercepts-modal-body, #alibaba-login-box');

    if (isLoginUrl || hasLoginModal) {
      if (window.TingwuBridge && window.TingwuBridge.notifyEngineState) {
        window.TingwuBridge.notifyEngineState('need_login', '请在主页登录');
      }
    } else {
      if (window.TingwuBridge && window.TingwuBridge.notifyEngineState) {
        window.TingwuBridge.notifyEngineState('ready', '听悟引擎就绪');
      }
    }
  }

  // 20秒静默看门狗
  setInterval(() => {
    if (window.__isRecordingActive) {
      const silentSecs = (Date.now() - lastStreamActiveTime) / 1000;
      if (silentSecs > 20) {
        if (window.TingwuBridge && window.TingwuBridge.notifyEngineState) {
          window.TingwuBridge.notifyEngineState('stream_idle', '暂无实时语音流');
        }
      }
    }
  }, 10000);

  // =========================================================
  // 4. 多模态录音控制选择器与双向 ACK 协议 (解决 P1-1 虚假录音缺陷)
  // =========================================================
  window.__isRecordingActive = false;

  window.__tingwuController = {
    startRecording: function() {
      console.log('[mytyty-engine] 执行开始录音指令');
      lastStreamActiveTime = Date.now();

      // 辅助函数：判断元素是否在页面中可见且未被隐藏 (优化 P2-1)
      function isElementVisible(el) {
        if (!el) return false;
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      }

      // 策略 1: 文本精确/前缀匹配优先 (避免宽通配命中无关小按钮)
      const allButtons = document.querySelectorAll('button, div[role="button"], a');
      for (let btn of allButtons) {
        if (!isElementVisible(btn)) continue;
        const txt = (btn.innerText || '').trim();
        if (txt === '开启实时记录' || txt === '开始实时记录' || txt === '开始记录' || txt === '实时记录' || txt.includes('开始录音')) {
          btn.click();
          console.log('[mytyty-engine] 优先命中文字按钮:', txt);
          confirmPreRecordingModals();
          sendAck(true);
          return true;
        }
      }

      // 策略 2: 类名与无障碍属性定位 (针对工作台专用录音按钮)
      const specificButtons = document.querySelectorAll(
        'button[class*="record"], button[aria-label*="录音"], .realtime-record-btn, [class*="start-record"]'
      );
      for (let btn of specificButtons) {
        if (!isElementVisible(btn)) continue;
        btn.click();
        console.log('[mytyty-engine] 命中专用录音按钮选择器');
        confirmPreRecordingModals();
        sendAck(true);
        return true;
      }

      // 策略 3: 若不在工作台，自动路由至听悟官方录音工作台
      if (!window.location.href.includes('/doc/record')) {
        console.log('[mytyty-engine] 未在当前页面找到录音按钮，自动跳转至工作台');
        window.location.href = 'https://tingwu.aliyun.com/doc/record';
        return true;
      }

      sendAck(false);
      return false;
    },

    stopRecording: function() {
      console.log('[mytyty-engine] 执行结束录音指令');
      window.__isRecordingActive = false;

      // 策略 1: 类名定位
      const stopButtons = document.querySelectorAll(
        'button[class*="stop"], button[class*="finish"], [class*="stop-record"], [class*="finish-record"]'
      );
      for (let btn of stopButtons) {
        btn.click();
        return true;
      }

      // 策略 2: 文本定位
      const allButtons = document.querySelectorAll('button, div[role="button"], a');
      for (let btn of allButtons) {
        const txt = (btn.innerText || '').trim();
        if (txt === '结束记录' || txt === '结束' || txt === '停止' || txt.includes('完成') || txt.includes('结束录音')) {
          btn.click();
          console.log('[mytyty-engine] 成功点击结束录音按钮:', txt);
          return true;
        }
      }
      return false;
    }
  };

  function sendAck(started) {
    window.__isRecordingActive = started;
    if (window.TingwuBridge && window.TingwuBridge.notifyRecordingAck) {
      window.TingwuBridge.notifyRecordingAck(started);
    }
  }

  // 自动点击听悟工作台“录音前置配置”确认弹窗（领域/语言选择）
  function confirmPreRecordingModals() {
    setTimeout(() => {
      const confirmBtns = document.querySelectorAll('.ant-modal-footer button.ant-btn-primary, button[class*="confirm"]');
      confirmBtns.forEach(btn => {
        try { btn.click(); } catch (e) {}
      });
    }, 300);
  }

  // 自动消杀营销及新手引导弹窗
  const closeBtns = document.querySelectorAll('.ant-modal-close, [class*="guide-close"], [class*="survey-close"]');
  closeBtns.forEach(btn => {
    const modal = btn.closest('.ant-modal, [class*="dialog"]');
    if (modal && (modal.innerText.includes('新手引导') || modal.innerText.includes('问卷调研'))) {
      btn.click();
    }
  });

})();
