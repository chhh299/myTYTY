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
  // 3. 状态感知与无流看门狗 (精准三位一体检测：登录按钮、工作台特征、用户身份)
  // =========================================================
  function checkEngineState() {
    const url = window.location.href;
    const isLoginUrl = url.includes('login') || url.includes('passport') || url.includes('signin');
    const hasLoginModal = document.querySelector(
      '.aliyun-login-component-wrapper, .login-intercepts-modal-body, #alibaba-login-box, [class*="login-modal"], iframe[src*="login"], iframe[src*="passport"]'
    );

    // 1. 检测页面上的登录/注册按钮或链接
    let hasLoginBtn = false;
    const potentialLoginEls = document.querySelectorAll('button, a, span, div[role="button"], [class*="login"]');
    for (let el of potentialLoginEls) {
      const txt = (el.innerText || '').trim();
      if (
        txt === '登录' ||
        txt === '登录/注册' ||
        txt === '立即登录' ||
        txt === '去登录' ||
        txt.includes('登录/注册') ||
        txt === 'Sign In'
      ) {
        hasLoginBtn = true;
        break;
      }
    }

    // 2. 检测页面上的已登录/工作台特征 (解决 AntD 动态类名无法命中导致死锁在 loading 的严重缺陷)
    const hasUserAvatar = document.querySelector(
      '[class*="avatar"], [class*="user-avatar"], [class*="user-profile"], [class*="header-user"], [class*="userInfo"], img[class*="avatar"], .user-avatar-wrapper, [class*="user-name"], .ant-avatar'
    );

    // 3. 检测通义听悟 PC 工作台的核心功能模块 (已登录的决定性特征)
    let hasWorkbenchFeature = false;
    const bodyText = (document.body ? document.body.innerText || '' : '');
    if (
      bodyText.includes('实时记录') ||
      bodyText.includes('开启实时记录') ||
      bodyText.includes('新建记录') ||
      bodyText.includes('音视频转写') ||
      bodyText.includes('全部文档') ||
      bodyText.includes('历史记录') ||
      document.querySelector('[class*="record"], [class*="workbench"], .ant-card, .ant-layout-content')
    ) {
      hasWorkbenchFeature = true;
    }

    // 4. 检查 Cookie 登录特征 (阿里云统一身份 Token)
    let hasAuthCookie = false;
    try {
      const cookie = document.cookie || '';
      if (cookie.includes('login_aliyunid') || cookie.includes('munb') || cookie.includes('cna') || cookie.includes('aliyun_choice')) {
        hasAuthCookie = true;
      }
    } catch (e) {}

    let state = 'ready';
    let desc = '听悟已登录就绪';

    if (isLoginUrl || hasLoginModal) {
      state = 'need_login';
      desc = '请在主页登录阿里云账号';
    } else if (hasLoginBtn && !hasUserAvatar && !hasAuthCookie) {
      // 明确有登录按钮，且没有头像或身份 Cookie，属于未登录状态
      state = 'need_login';
      desc = '未登录，请在主页完成登录';
    } else if (hasUserAvatar || hasWorkbenchFeature || hasAuthCookie || (!hasLoginBtn && bodyText.length > 50)) {
      // 只要具备用户身份、或工作台特征、或无登录按钮且页面已渲染，100% 为已登录就绪！
      state = 'ready';
      desc = '听悟已登录就绪';
    } else {
      // 仅在完全空白无内容时才为 loading
      state = 'loading';
      desc = '听悟加载中…';
    }

    console.log('[mytyty-engine] 状态检测结果 ->', state, desc, { hasLoginBtn, hasUserAvatar, hasWorkbenchFeature, hasAuthCookie });

    if (window.TingwuBridge && window.TingwuBridge.notifyEngineState) {
      window.TingwuBridge.notifyEngineState(state, desc);
    }
  }

  // 暴露给原生层主动调用
  window.checkEngineState = checkEngineState;

  // React SPA 异步渲染看门狗：页面初次加载后分别在 500ms、1500ms、3000ms 持续自旋刷新状态
  [500, 1500, 3000].forEach(delay => {
    setTimeout(checkEngineState, delay);
  });

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
  // 4. 多模态录音控制选择器与双向 ACK 协议 (解决真实录音触发与页面跳转无缝衔接)
  // =========================================================
  window.__isRecordingActive = false;

  // 页面加载完成后，检查是否有由主页跳转工作台发起的“自启动录音任务”
  function checkPendingAutoRecordTask() {
    try {
      const pendingTask = sessionStorage.getItem('__mytyty_pending_auto_record');
      if (pendingTask === '1') {
        sessionStorage.removeItem('__mytyty_pending_auto_record');
        console.log('[mytyty-engine] 感知到工作台重定向自启动录音任务，开始尝试点击');
        let retryCount = 0;
        const autoInterval = setInterval(() => {
          retryCount++;
          const success = tryClickStartRecordButton();
          if (success || retryCount > 15) {
            clearInterval(autoInterval);
            if (!success) {
              console.warn('[mytyty-engine] 工作台自启动录音重试超时');
              sendAck(false);
            }
          }
        }, 500);
      }
    } catch (e) {}
  }

  // 辅助函数：深度派发 React 兼容的鼠标点击事件 (解决 React 18 合成事件不触发问题)
  function dispatchReactClick(element) {
    try {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.click();
    } catch (e) {
      element.click();
    }
  }

  // 尝试在当前 DOM 中搜寻并点击“开始录音”按钮
  function tryClickStartRecordButton() {
    // 策略 1: 文本模糊加权匹配 (涵盖通义听悟桌面端所有入口，包括多行大卡片)
    const allElements = document.querySelectorAll(
      'button, div[role="button"], a, span[role="button"], .ant-btn, [class*="btn"], [class*="card"], div'
    );

    for (let el of allElements) {
      // 避免选中顶层包含所有文字的容器（body 或 container）
      if (el.children && el.children.length > 5) continue;

      const txt = (el.innerText || '').trim();
      if (!txt) continue;

      // 匹配首页大卡片或按钮文本
      if (
        txt === '开启实时记录' ||
        txt === '开始实时记录' ||
        txt === '开始记录' ||
        txt === '实时记录' ||
        txt === '开始录音' ||
        txt.includes('开启实时记录') ||
        txt.includes('开始实时记录') ||
        (txt.includes('实时记录') && txt.includes('转写')) ||
        (txt.includes('开始') && txt.includes('记录'))
      ) {
        dispatchReactClick(el);
        console.log('[mytyty-engine] 成功命中并点击入口元素:', txt);
        confirmPreRecordingModals();
        sendAck(true);
        return true;
      }
    }

    // 策略 2: 类名与无障碍属性定位 (针对工作台中央核心大麦克风录音按钮)
    const specificButtons = document.querySelectorAll(
      'button[class*="record"], button[aria-label*="录音"], .realtime-record-btn, [class*="start-record"], [class*="RecordBtn"], [class*="record-btn"], [class*="mic-btn"]'
    );
    for (let btn of specificButtons) {
      dispatchReactClick(btn);
      console.log('[mytyty-engine] 命中专用录音按钮选择器');
      confirmPreRecordingModals();
      sendAck(true);
      return true;
    }

    return false;
  }

  window.__tingwuController = {
    startRecording: function() {
      console.log('[mytyty-engine] 执行开始录音指令');
      lastStreamActiveTime = Date.now();

      // 先在当前页面尝试搜寻并点击录音按钮
      if (tryClickStartRecordButton()) {
        return true;
      }

      // 若当前在首页(/home)或非录音工作台，标记任务并跳转到听悟官方录音工作台
      if (!window.location.href.includes('/doc/record')) {
        console.log('[mytyty-engine] 当前页面无录音按钮，设置自启动标记并跳转至工作台');
        try {
          sessionStorage.setItem('__mytyty_pending_auto_record', '1');
        } catch (e) {}
        window.location.href = 'https://tingwu.aliyun.com/doc/record';
        return true;
      }

      // 如果已经在 /doc/record 仍未找到按钮，延时重试 3 次后再判失败
      let retries = 0;
      const retryTimer = setInterval(() => {
        retries++;
        if (tryClickStartRecordButton()) {
          clearInterval(retryTimer);
        } else if (retries >= 3) {
          clearInterval(retryTimer);
          console.warn('[mytyty-engine] 未在页面上找到录音按钮');
          sendAck(false);
        }
      }, 600);

      return false;
    },

    stopRecording: function() {
      console.log('[mytyty-engine] 执行结束录音指令');
      window.__isRecordingActive = false;
      try {
        sessionStorage.removeItem('__mytyty_pending_auto_record');
      } catch (e) {}

      // 策略 1: 文本定位
      const allButtons = document.querySelectorAll('button, div[role="button"], a, span[role="button"]');
      for (let btn of allButtons) {
        const txt = (btn.innerText || '').trim();
        if (txt === '结束记录' || txt === '结束' || txt === '停止' || txt.includes('完成') || txt.includes('结束录音') || txt.includes('停止录音')) {
          btn.click();
          console.log('[mytyty-engine] 成功点击结束录音按钮:', txt);
          return true;
        }
      }

      // 策略 2: 类名定位
      const stopButtons = document.querySelectorAll(
        'button[class*="stop"], button[class*="finish"], [class*="stop-record"], [class*="finish-record"]'
      );
      for (let btn of stopButtons) {
        btn.click();
        return true;
      }

      return false;
    }
  };

  checkPendingAutoRecordTask();

  function sendAck(started) {
    window.__isRecordingActive = started;
    if (window.TingwuBridge && window.TingwuBridge.notifyRecordingAck) {
      window.TingwuBridge.notifyRecordingAck(started);
    }
  }

  // 自动点击听悟工作台“录音前置配置”确认弹窗（领域/语言选择）
  function confirmPreRecordingModals() {
    let checkCount = 0;
    const confirmInterval = setInterval(() => {
      checkCount++;
      const confirmBtns = document.querySelectorAll(
        '.ant-modal-footer button.ant-btn-primary, button[class*="confirm"], .ant-modal-footer button, [class*="start-confirm"]'
      );
      for (let btn of confirmBtns) {
        const txt = (btn.innerText || '').trim();
        if (txt === '开始记录' || txt === '确定' || txt === '确认' || txt.includes('开始') || txt.includes('确认')) {
          try {
            btn.click();
            console.log('[mytyty-engine] 成功确认录音配置弹窗:', txt);
          } catch (e) {}
        }
      }
      if (checkCount >= 6) {
        clearInterval(confirmInterval);
      }
    }, 400);
  }

  // 自动消杀营销及新手引导弹窗
  const closeBtns = document.querySelectorAll('.ant-modal-close, [class*="guide-close"], [class*="survey-close"]');
  closeBtns.forEach(btn => {
    const modal = btn.closest('.ant-modal, [class*="dialog"]');
    if (modal && (modal.innerText.includes('新手引导') || modal.innerText.includes('问卷调研'))) {
      btn.click();
    }
  });

  // =========================================================
  // 5. 历史记录数据提取与回传桥梁 (为移动端专属卡片提供真实数据)
  // =========================================================
  function extractHistoryListFromPage() {
    const list = [];
    try {
      // 策略 1: 解析通义听悟工作台历史表格 / 列表项
      const items = document.querySelectorAll(
        '.ant-table-row, [class*="doc-item"], [class*="record-item"], [class*="history-item"], tr[data-row-key]'
      );

      items.forEach((row, idx) => {
        const titleEl = row.querySelector('[class*="title"], [class*="name"], a, td:first-child');
        const timeEl = row.querySelector('[class*="time"], [class*="date"], td:nth-child(2)');
        const durationEl = row.querySelector('[class*="duration"], [class*="length"], td:nth-child(3)');

        const title = titleEl ? (titleEl.innerText || '').trim() : '';
        if (title && title.length > 0 && !title.includes('标题') && !title.includes('文档名称')) {
          list.push({
            id: row.getAttribute('data-row-key') || ('history_' + idx),
            title: title,
            time: timeEl ? (timeEl.innerText || '').trim() : '近期记录',
            duration: durationEl ? (durationEl.innerText || '').trim() : '已转写'
          });
        }
      });
    } catch (e) {
      console.warn('[mytyty-engine] 提取历史记录异常:', e);
    }

    if (window.TingwuBridge && window.TingwuBridge.onHistoryListReceived) {
      window.TingwuBridge.onHistoryListReceived(JSON.stringify(list));
    }
  }

  window.fetchHistoryList = function() {
    console.log('[mytyty-engine] 收到拉取历史记录指令');
    // 如果当前不在工作台或文档列表页，先在当前页提取，如为空且不在首页则视情况拉取
    extractHistoryListFromPage();
  };

})();
