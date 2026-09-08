/**
 * 通义听悟后台引擎数据穿透与控制脚本 (tingwu-engine-injector.js)
 * 注入至真实的 https://tingwu.aliyun.com 页面上下文中
 * 负责：WebSocket/DOM 实时语音识别与双语翻译截获、远程开始/结束录音控制、登录状态探测与短信窗口修复
 */

(() => {
  console.log('[mytyty-engine] 听悟后台数据穿透引擎已启动');

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

  function handleWsStringMessage(msg) {
    if (!msg || msg.length < 5) return;
    try {
      const parsed = JSON.parse(msg);

      // 通义听悟常见消息协议字段
      // 常见结构: { header: { name: 'TranscriptionResultChanged' }, payload: { result: '...', words: [...] } }
      // 或者: { type: 'sentence', data: { text: '...', trans: '...' } }
      let originalText = '';
      let translationText = '';
      let sentenceId = '';

      if (parsed.header && parsed.payload) {
        const hName = parsed.header.name || '';
        const payload = parsed.payload;

        if (hName.includes('Result') || hName.includes('Sentence') || hName.includes('Transcription')) {
          sentenceId = payload.index || payload.sentence_id || payload.id || 'live_0';
          originalText = payload.result || payload.text || '';
          translationText = payload.translation || payload.trans || '';
        }
      } else if (parsed.text || parsed.result) {
        originalText = parsed.text || parsed.result || '';
        translationText = parsed.translation || parsed.trans || '';
        sentenceId = parsed.id || 'live_0';
      }

      if (originalText || translationText) {
        relayDataToNative({
          id: sentenceId,
          text: originalText,
          translation: translationText,
          time: new Date().toTimeString().split(' ')[0]
        });
      }
    } catch (e) {}
  }

  // =========================================================
  // 2. DOM MutationObserver 实时转写穿透 (强力兜底通道)
  // =========================================================
  let lastObservedOriginal = '';
  let lastObservedTrans = '';

  const domObserver = new MutationObserver(() => {
    extractTextFromDom();
    checkEngineState();
    fixLoginModal();
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
    // 监听听悟实时录音工作台中的文本容器
    const sentenceElements = document.querySelectorAll(
      '[class*="sentence-item"], [class*="transcript-item"], [class*="realtime-sentence"], .sentence-item'
    );

    if (sentenceElements.length > 0) {
      const lastSentence = sentenceElements[sentenceElements.length - 1];
      const textEl = lastSentence.querySelector('[class*="text"], [class*="content"], p, span') || lastSentence;
      const transEl = lastSentence.querySelector('[class*="translation"], [class*="trans"], [class*="target"]');

      const originalText = (textEl.innerText || '').trim();
      const translationText = transEl ? (transEl.innerText || '').trim() : '';

      if (originalText && (originalText !== lastObservedOriginal || translationText !== lastObservedTrans)) {
        lastObservedOriginal = originalText;
        lastObservedTrans = translationText;

        relayDataToNative({
          id: 'sentence_' + sentenceElements.length,
          text: originalText,
          translation: translationText,
          time: new Date().toTimeString().split(' ')[0]
        });
      }
    }
  }

  function relayDataToNative(data) {
    if (window.TingwuBridge && window.TingwuBridge.onTranscriptionReceived) {
      window.TingwuBridge.onTranscriptionReceived(JSON.stringify(data));
    }
  }

  // =========================================================
  // 3. 状态感知：自动探测登录状态并上报
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

  // =========================================================
  // 4. 远程录音生命周期调度控制器 (供 Native 层调用)
  // =========================================================
  window.__tingwuController = {
    startRecording: function() {
      console.log('[mytyty-engine] 执行开始录音指令');
      // 寻找听悟页面上的“开启实时记录” / “开始”按钮
      const buttons = document.querySelectorAll('button, div[role="button"], a');
      for (let btn of buttons) {
        const txt = (btn.innerText || '').trim();
        if (txt === '开启实时记录' || txt === '开始记录' || txt === '开始' || txt.includes('开始录音')) {
          btn.click();
          console.log('[mytyty-engine] 成功点击听悟开始录音按钮:', txt);
          return true;
        }
      }
      return false;
    },

    stopRecording: function() {
      console.log('[mytyty-engine] 执行结束录音指令');
      const buttons = document.querySelectorAll('button, div[role="button"], a');
      for (let btn of buttons) {
        const txt = (btn.innerText || '').trim();
        if (txt === '结束记录' || txt === '结束' || txt === '停止' || txt.includes('完成')) {
          btn.click();
          console.log('[mytyty-engine] 成功点击听悟结束录音按钮:', txt);
          return true;
        }
      }
      return false;
    }
  };

  // =========================================================
  // 5. 登录弹窗右侧短信验证码展示修复 (自动居中到右侧表单)
  // =========================================================
  function fixLoginModal() {
    const loginModals = document.querySelectorAll(
      '.aliyun-login-component-wrapper, .login-intercepts-modal-body, .ant-modal, [class*="login-container"], [class*="login-box"]'
    );

    loginModals.forEach(modal => {
      modal.style.overflowX = 'auto';
      modal.style.webkitOverflowScrolling = 'touch';

      // 切换短信登录
      const tabs = modal.querySelectorAll('.ant-tabs-tab, [class*="tab"], a, button');
      tabs.forEach(tab => {
        const txt = (tab.innerText || '').trim();
        if (txt === '短信登录' || txt === '验证码登录' || txt.includes('验证码') || txt.includes('短信')) {
          if (!tab.classList.contains('ant-tabs-tab-active')) {
            tab.click();
          }
        }
      });

      // 将右侧短信验证码表单滚入视野
      if (modal.scrollWidth > modal.clientWidth + 50) {
        modal.scrollLeft = modal.scrollWidth - modal.clientWidth;
      }
    });
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
