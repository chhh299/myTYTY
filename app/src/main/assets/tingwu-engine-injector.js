/**
 * 通义听悟后台引擎数据穿透与控制脚本 (tingwu-engine-injector.js)
 * 注入至真实的 https://tingwu.aliyun.com 页面上下文中
 * 基于真实 DOM 反向工程校验：
 * 1. 登录与工作台状态精准判定 (Cookie + 页面特征)
 * 2. 真实录音两级触发与 ACK (首页入口 -> /doc/record -> 开始录音 -> 真正录音中检测)
 * 3. 真实录音停止与确认 (点击 .stop-btn -> 自动点击 "确认结束" 弹窗 -> 保存完成)
 * 4. 真实历史会议卡片列表精确抓取 (解析 .groupCards 与表格)
 */

(() => {
  console.log('[mytyty-engine] 听悟后台数据穿透引擎启动');

  let currentSentenceIndex = 0;
  let lastReportedOriginal = '';
  let lastReportedTrans = '';
  let lastStreamActiveTime = Date.now();

  // =========================================================
  // 1. 拦截 WebSocket 实时音频转写与翻译数据帧
  // =========================================================
  const OrigWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);

    ws.addEventListener('message', function(event) {
      try {
        if (typeof event.data === 'string') {
          handleWsStringMessage(event.data);
        }
      } catch (e) {}
    });

    return ws;
  };
  window.WebSocket.prototype = OrigWebSocket.prototype;

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
  // 2. DOM MutationObserver 实时转写穿透与状态监听
  // =========================================================
  const domObserver = new MutationObserver(() => {
    extractTextFromDom();
    checkEngineState();
    checkRecordingTimerInDom();
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

  function normalizeAndDispatchSentence(original, translation) {
    if (!original && !translation) return;
    if (original === lastReportedOriginal && translation === lastReportedTrans) {
      return;
    }

    lastStreamActiveTime = Date.now();

    if (lastReportedOriginal) {
      const isPrefixExtension = original.startsWith(lastReportedOriginal);
      const isPunctuationClosed = /[。？！\n\r?!]$/.test(lastReportedOriginal.trim());

      if (!isPrefixExtension) {
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
  // 3. 真实状态检测 (登录态与工作台判定)
  // =========================================================
  function checkEngineState() {
    const url = window.location.href;
    const isLoginUrl = url.includes('login') || url.includes('passport') || url.includes('signin');
    const hasLoginModal = document.querySelector(
      '.aliyun-login-component-wrapper, .login-intercepts-modal-body, #alibaba-login-box, [class*="login-modal"], iframe[src*="login"], iframe[src*="passport"]'
    );

    let hasLoginBtn = false;
    const potentialLoginEls = document.querySelectorAll('button, a, span, div[role="button"]');
    for (let el of potentialLoginEls) {
      const txt = (el.innerText || '').trim();
      if (txt === '登录' || txt === '登录/注册' || txt === '立即登录' || txt === '去登录') {
        hasLoginBtn = true;
        break;
      }
    }

    // 检查是否有登录鉴权 Cookie
    let hasAuthCookie = false;
    try {
      const cookie = document.cookie || '';
      if (cookie.includes('login_aliyunid') || cookie.includes('munb') || cookie.includes('cna') || cookie.includes('login_current_pk')) {
        hasAuthCookie = true;
      }
    } catch (e) {}

    // 检查页面主体内容
    const bodyText = (document.body ? document.body.innerText || '' : '');
    const hasWorkbenchFeature = (
      url.includes('/doc/record') ||
      url.includes('/doc/transcripts') ||
      bodyText.includes('开启实时记录') ||
      bodyText.includes('我的记录') ||
      bodyText.includes('全部文档') ||
      bodyText.includes('上传音视频') ||
      document.querySelector('[class*="groupCards"], [class*="groupCard"], .stop-btn') !== null
    );

    let state = 'ready';
    let desc = '听悟已就绪';

    if (isLoginUrl || hasLoginModal) {
      state = 'need_login';
      desc = '请在主页登录阿里云账号';
    } else if (hasLoginBtn && !hasAuthCookie) {
      state = 'need_login';
      desc = '未登录，请在主页完成登录';
    } else if (hasAuthCookie || hasWorkbenchFeature || (!hasLoginBtn && bodyText.length > 50)) {
      state = 'ready';
      desc = '听悟已登录就绪';
    } else {
      state = 'loading';
      desc = '听悟加载中…';
    }

    if (window.TingwuBridge && window.TingwuBridge.notifyEngineState) {
      window.TingwuBridge.notifyEngineState(state, desc);
    }
  }

  window.checkEngineState = checkEngineState;
  [300, 1000, 2500].forEach(delay => setTimeout(checkEngineState, delay));

  // =========================================================
  // 4. 真实录音状态看门狗与真实计时器捕获
  // =========================================================
  window.__isRecordingActive = false;

  function checkRecordingTimerInDom() {
    const text = document.body ? document.body.innerText : '';
    const isActuallyRecording = (
      (text.includes('录音中…') || text.includes('/06:00:00')) &&
      document.querySelector('.stop-btn, [class*="stop-btn"]') !== null
    );

    if (isActuallyRecording && !window.__isRecordingActive) {
      console.log('[mytyty-engine] 检测到真实页面已进入录音状态！');
      sendAck(true);
    }
  }

  function sendAck(started) {
    window.__isRecordingActive = started;
    if (window.TingwuBridge && window.TingwuBridge.notifyRecordingAck) {
      window.TingwuBridge.notifyRecordingAck(started);
    }
  }

  // =========================================================
  // 5. 真实录音控制器 (开始/停止/确认保存)
  // =========================================================
  function dispatchClick(el) {
    if (!el) return;
    try {
      const events = ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'];
      events.forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
    } catch (e) {
      el.click();
    }
  }

  // 页面自启动任务检查 (跨页面跳转时继承)
  function checkPendingAutoRecord() {
    try {
      const task = sessionStorage.getItem('__mytyty_pending_record');
      if (task === '1') {
        console.log('[mytyty-engine] 发现待执行自启动录音任务，当前 URL:', window.location.href);
        sessionStorage.removeItem('__mytyty_pending_record');

        let attempts = 0;
        const autoInterval = setInterval(() => {
          attempts++;
          const startBtn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开始录音');
          if (startBtn) {
            clearInterval(autoInterval);
            console.log('[mytyty-engine] 自启动任务命中【开始录音】按钮，触发点击');
            dispatchClick(startBtn);
          } else if (attempts > 20) {
            clearInterval(autoInterval);
            console.warn('[mytyty-engine] 自启动录音寻找开始按钮超时');
          }
        }, 400);
      }
    } catch (e) {}
  }

  checkPendingAutoRecord();

  window.__tingwuController = {
    startRecording: function() {
      console.log('[mytyty-engine] 收到启动录音指令，当前 URL:', window.location.href);
      lastStreamActiveTime = Date.now();

      // 场景 A: 当前已经在 /doc/record 录音工作台
      if (window.location.href.includes('/doc/record')) {
        const startBtn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开始录音');
        if (startBtn) {
          console.log('[mytyty-engine] 在录音工作台直接点击【开始录音】');
          dispatchClick(startBtn);
          return true;
        }
      }

      // 场景 B: 当前在主页 (/home)，点击【开启实时记录】跳转到工作台
      const homeRecordBtn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开启实时记录');
      if (homeRecordBtn) {
        console.log('[mytyty-engine] 在主页点击【开启实时记录】，设置自启动任务并跳转');
        try {
          sessionStorage.setItem('__mytyty_pending_record', '1');
        } catch (e) {}
        dispatchClick(homeRecordBtn);
        return true;
      }

      // 场景 C: 直接导航到工作台
      console.log('[mytyty-engine] 直接导航至 /doc/record 工作台');
      try {
        sessionStorage.setItem('__mytyty_pending_record', '1');
      } catch (e) {}
      window.location.href = 'https://tingwu.aliyun.com/doc/record';
      return true;
    },

    stopRecording: function() {
      console.log('[mytyty-engine] 收到结束录音指令');
      window.__isRecordingActive = false;
      try {
        sessionStorage.removeItem('__mytyty_pending_record');
      } catch (e) {}

      // 1. 点击停止录音按钮 (.stop-btn)
      const stopBtn = document.querySelector('.stop-btn, [class*="stop-btn"], [class*="stopBtn"]');
      if (stopBtn) {
        console.log('[mytyty-engine] 成功点击 .stop-btn 停止按钮');
        dispatchClick(stopBtn);
      } else {
        // 兜底寻找
        const allBtns = Array.from(document.querySelectorAll('button, div, span'));
        for (const b of allBtns) {
          const t = (b.innerText || '').trim();
          if (t === '结束' || t === '停止' || t === '结束录音') {
            dispatchClick(b);
            break;
          }
        }
      }

      // 2. 自动确认结束录音弹窗 (寻找 "确认结束" 按钮)
      let confirmAttempts = 0;
      const confirmInterval = setInterval(() => {
        confirmAttempts++;
        const allModalBtns = Array.from(document.querySelectorAll('.ant-modal button, [class*="modal"] button, button, div'));
        for (const b of allModalBtns) {
          const t = (b.innerText || '').trim();
          if (t === '确认结束' || t === '结束并保存') {
            clearInterval(confirmInterval);
            console.log('[mytyty-engine] 成功自动点击弹窗中的【确认结束】');
            dispatchClick(b);

            // 核心修复：录音保存成功后，平滑返回主页 https://tingwu.aliyun.com/home
            // 确保主页工作台重置待命，且历史记录列表实时刷新
            setTimeout(() => {
              console.log('[mytyty-engine] 保存请求已完成，自动导航回通义听悟 home 主页');
              window.location.href = 'https://tingwu.aliyun.com/home';
            }, 1800);
            return;
          }
        }
        if (confirmAttempts >= 10) {
          clearInterval(confirmInterval);
          // 兜底：若未弹出确认弹窗但页面停在 record 或 transcripts，也自动返回 home
          setTimeout(() => {
            if (window.location.href.includes('/doc/record') || window.location.href.includes('/doc/transcripts')) {
              console.log('[mytyty-engine] 兜底自动返回 home 主页');
              window.location.href = 'https://tingwu.aliyun.com/home';
            }
          }, 2000);
        }
      }, 300);

      return true;
    }
  };

  // 监听页面 URL 变化，若录音结束后跳转至转写详情页 /doc/transcripts/，自动返回 home 主页
  if (window.location.href.includes('/doc/transcripts/')) {
    console.log('[mytyty-engine] 检测到处于录音详情页，2 秒后自动返回 home 主页');
    setTimeout(() => {
      window.location.href = 'https://tingwu.aliyun.com/home';
    }, 2000);
  }

  // =========================================================
  // 6. 真实历史会议卡片列表抓取器 (经过实机 DOM 验证)
  // =========================================================
  function extractHistoryListFromPage() {
    const list = [];
    try {
      // 真实听悟主页卡片: .groupCards
      const cards = document.querySelectorAll('[class*="groupCards"], [class*="groupCard"]');
      if (cards.length > 0) {
        cards.forEach((card, idx) => {
          const text = card.innerText || '';
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

          let title = lines[0] || ('会议记录 ' + (idx + 1));
          let duration = '00:00';
          let time = '';
          let snippet = '';

          for (let i = 1; i < lines.length; i++) {
            const l = lines[i];
            if (/^\d{2}:\d{2}(:\d{2})?$/.test(l)) {
              duration = l;
            } else if (l.includes('今天') || l.includes('昨天') || /^\d{4}-\d{2}-\d{2}/.test(l)) {
              time = l;
            } else if (!snippet) {
              snippet = l;
            }
          }

          list.push({
            id: 'history_record_' + idx,
            title: title,
            time: time || '近期',
            duration: duration,
            snippet: snippet
          });
        });
      } else {
        // 兜底表格形式
        const rows = document.querySelectorAll('.ant-table-row, tr[data-row-key]');
        rows.forEach((row, idx) => {
          const titleEl = row.querySelector('[class*="title"], [class*="name"], a, td:first-child');
          const timeEl = row.querySelector('[class*="time"], [class*="date"], td:nth-child(2)');
          const durationEl = row.querySelector('[class*="duration"], [class*="length"], td:nth-child(3)');
          const title = titleEl ? (titleEl.innerText || '').trim() : '';
          if (title && !title.includes('标题')) {
            list.push({
              id: row.getAttribute('data-row-key') || ('history_row_' + idx),
              title: title,
              time: timeEl ? (timeEl.innerText || '').trim() : '近期记录',
              duration: durationEl ? (durationEl.innerText || '').trim() : '已转写',
              snippet: ''
            });
          }
        });
      }
    } catch (e) {
      console.warn('[mytyty-engine] 抓取历史记录异常:', e);
    }

    console.log('[mytyty-engine] 提取到历史记录条数:', list.length);
    if (window.TingwuBridge && window.TingwuBridge.onHistoryListReceived) {
      window.TingwuBridge.onHistoryListReceived(JSON.stringify(list));
    }
  }

  window.fetchHistoryList = function() {
    console.log('[mytyty-engine] 收到拉取历史记录指令');
    // 如果当前在录音或详情页且主页不在，可直接提取当前或按需抓取
    extractHistoryListFromPage();
  };

})();
