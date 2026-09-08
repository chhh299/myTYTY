/**
 * mytyty 极简移动端原生卡片交互控制器 (app.js)
 * 100% 真实事件驱动，严禁任何写死虚假数据与自跑模拟流
 * 彻底修复 P0-2 双胞胎气泡与 P1-1 虚假录音缺陷
 */

(() => {
  // 状态管理
  let isRecording = false;
  let displayMode = 'bilingual'; // bilingual | original | translation
  let fontScale = 1.2;
  const sentenceMap = new Map(); // id -> { original, translation, el }

  // DOM 元素引用
  const engineStatusBadge = document.getElementById('engineStatusBadge');
  const btnRefresh = document.getElementById('btnRefresh');
  const mainRecordTimer = document.getElementById('mainRecordTimer');
  const btnToggleRecord = document.getElementById('btnToggleRecord');
  const recordBtnLabel = document.getElementById('recordBtnLabel');
  const micStatusText = document.getElementById('micStatusText');
  const liveIndicator = document.getElementById('liveIndicator');
  const transcriptEmptyState = document.getElementById('transcriptEmptyState');
  const streamSentences = document.getElementById('streamSentences');
  const transcriptContainer = document.getElementById('transcriptContainer');
  const floatingRecordBar = document.getElementById('floatingRecordBar');
  const floatingTimer = document.getElementById('floatingTimer');
  const btnFloatingStop = document.getElementById('btnFloatingStop');
  const btnFontMinus = document.getElementById('btnFontMinus');
  const btnFontPlus = document.getElementById('btnFontPlus');
  const currentFontSizeLabel = document.getElementById('currentFontSizeLabel');
  const chkKeepScreenOn = document.getElementById('chkKeepScreenOn');

  // 1. 录音按钮点击交互 (通知 Android 原生层调度听悟引擎)
  function toggleRecording() {
    if (!window.TingwuBridge) {
      console.warn('[mytyty] TingwuBridge 未挂载');
      return;
    }
    if (!isRecording) {
      window.TingwuBridge.startRecording();
    } else {
      window.TingwuBridge.stopRecording();
    }
  }

  btnToggleRecord.addEventListener('click', toggleRecording);
  btnFloatingStop.addEventListener('click', () => {
    if (window.TingwuBridge && isRecording) {
      window.TingwuBridge.stopRecording();
    }
  });

  // 刷新引擎
  btnRefresh.addEventListener('click', () => {
    if (window.TingwuBridge) {
      window.TingwuBridge.reloadEngine();
    }
  });

  // 2. 双语对照 / 原文 / 翻译 Tab 切换
  document.querySelectorAll('.pill-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pill-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      displayMode = tab.dataset.mode;
      updateDisplayMode();
    });
  });

  function updateDisplayMode() {
    document.querySelectorAll('.sentence-bubble').forEach(bubble => {
      const origEl = bubble.querySelector('.sentence-original');
      const transEl = bubble.querySelector('.sentence-translation');
      if (origEl) origEl.style.display = (displayMode === 'translation') ? 'none' : 'block';
      if (transEl) transEl.style.display = (displayMode === 'original') ? 'none' : 'block';
    });
  }

  // 3. 字号缩放与屏幕常亮
  function updateFontScale(newScale) {
    fontScale = Math.max(1.0, Math.min(1.6, parseFloat(newScale.toFixed(1))));
    document.documentElement.style.setProperty('--font-scale', fontScale.toString());
    const pct = Math.round(fontScale * 100);
    currentFontSizeLabel.textContent = `${pct}% (${pct > 120 ? '超大' : pct === 120 ? '标准偏大' : '标准'})`;
    notifySettingsChanged();
  }

  btnFontMinus.addEventListener('click', () => updateFontScale(fontScale - 0.1));
  btnFontPlus.addEventListener('click', () => updateFontScale(fontScale + 0.1));
  chkKeepScreenOn.addEventListener('change', notifySettingsChanged);

  function notifySettingsChanged() {
    if (window.TingwuBridge) {
      window.TingwuBridge.updateSettings(Math.round(fontScale * 100), chkKeepScreenOn.checked);
    }
  }

  // =========================================================
  // 原生 Android 层回调注入入口 (完全由真实事件驱动)
  // =========================================================

  // 启动中缓冲态 (解决 P1-1 虚假走表问题)
  window.onNativeRecordingPending = function(isPending) {
    if (isPending) {
      recordBtnLabel.textContent = '正在连接引擎…';
      micStatusText.textContent = '听悟工作台正在就绪…';
      btnToggleRecord.disabled = false; // 严禁完全禁用按钮，保证用户随时可重试
      btnToggleRecord.style.opacity = '0.75';
    } else {
      btnToggleRecord.disabled = false;
      btnToggleRecord.style.opacity = '1.0';
      recordBtnLabel.textContent = '开始实时记录';
      micStatusText.textContent = '电脑模式 · 麦克风待命';
    }
  };

  // 真实录音状态改变 (收到 ACK 后才翻转)
  window.onNativeRecordingStatus = function(active) {
    isRecording = active;
    btnToggleRecord.disabled = false;
    const contentScroll = document.querySelector('.content-scroll');
    if (active) {
      btnToggleRecord.classList.add('is-recording');
      recordBtnLabel.textContent = '结束实时记录';
      mainRecordTimer.classList.add('recording');
      micStatusText.textContent = '实时麦克风录音中 · 云端转写中';
      liveIndicator.style.display = 'flex';
      floatingRecordBar.style.display = 'block';
      if (contentScroll) contentScroll.classList.add('with-floating-bar');
      if (engineStatusBadge) {
        engineStatusBadge.textContent = '● 实时转写中';
        engineStatusBadge.className = 'header-badge';
      }
    } else {
      btnToggleRecord.classList.remove('is-recording');
      recordBtnLabel.textContent = '开始实时记录';
      mainRecordTimer.classList.remove('recording');
      micStatusText.textContent = '电脑模式 · 麦克风待命';
      liveIndicator.style.display = 'none';
      floatingRecordBar.style.display = 'none';
      if (contentScroll) contentScroll.classList.remove('with-floating-bar');
      if (engineStatusBadge) {
        engineStatusBadge.textContent = '● 听悟已就绪';
        engineStatusBadge.className = 'header-badge';
      }
    }
  };

  // 真实计时器心跳 (格式 00:00:00)
  window.onNativeTimerTick = function(timeStr) {
    mainRecordTimer.textContent = timeStr;
    floatingTimer.textContent = timeStr;
  };

  // 引擎状态通知 (例如: 就绪、登录拦截、断线)
  window.onNativeEngineState = function(state, desc) {
    if (!engineStatusBadge) return;
    if (state === 'ready') {
      engineStatusBadge.textContent = '● ' + (desc || '听悟就绪');
      engineStatusBadge.className = 'header-badge';
    } else if (state === 'need_login') {
      engineStatusBadge.textContent = '● 需登录阿里云';
      engineStatusBadge.className = 'header-badge warning';
      micStatusText.textContent = '请先在“主页”完成阿里云登录';
    } else if (state === 'loading') {
      engineStatusBadge.textContent = '● 连接中…';
      engineStatusBadge.className = 'header-badge warning';
    }
  };

  // 核心：UTF-8 安全 Base64 解码，解决 URIError 问题
  window.__receiveTranscriptionBase64 = function(base64Str) {
    try {
      const binaryString = window.atob(base64Str);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const decoded = new TextDecoder('utf-8').decode(bytes);
      window.onNativeTranscriptionReceived(decoded);
    } catch (e) {
      console.error('[mytyty] TextDecoder Base64 解码异常:', e);
    }
  };

  window.onNativeTranscriptionReceived = function(jsonStr) {
    try {
      const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
      if (!data) return;

      if (transcriptEmptyState) {
        transcriptEmptyState.style.display = 'none';
      }

      const sentenceId = data.id || 'curr_sentence';
      const originalText = data.text || data.original || '';
      const translationText = data.translation || data.trans || '';
      const timeTag = data.time || '';

      if (!originalText && !translationText) return;

      let sentenceObj = sentenceMap.get(sentenceId);
      if (!sentenceObj) {
        const bubble = document.createElement('div');
        bubble.className = 'sentence-bubble';
        bubble.innerHTML = `
          <div class="sentence-header">
            <span>实时字幕</span>
            <span>${timeTag || ''}</span>
          </div>
          <div class="sentence-original">${escapeHtml(originalText)}</div>
          <div class="sentence-translation" style="${displayMode === 'original' ? 'display:none;' : ''}">${escapeHtml(translationText)}</div>
        `;
        streamSentences.appendChild(bubble);
        sentenceObj = {
          el: bubble,
          origEl: bubble.querySelector('.sentence-original'),
          transEl: bubble.querySelector('.sentence-translation')
        };
        sentenceMap.set(sentenceId, sentenceObj);
      } else {
        // 单唯一的句子更新，彻底杜绝双胞胎气泡
        if (originalText) sentenceObj.origEl.textContent = originalText;
        if (translationText) sentenceObj.transEl.textContent = translationText;
      }

      updateDisplayMode();

      // 平滑滚动到底部
      transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    } catch (e) {
      console.error('[mytyty] 解析转写数据异常:', e, jsonStr);
    }
  };

  // =========================================================
  // 5. 视图切换与历史会议移动端卡片渲染 (彻底告别裸露 PC 网页)
  // =========================================================
  const viewLive = document.getElementById('viewLive');
  const viewHistory = document.getElementById('viewHistory');
  const historyListContainer = document.getElementById('historyListContainer');
  const historyEmptyState = document.getElementById('historyEmptyState');
  const historyCountBadge = document.getElementById('historyCountBadge');
  const btnRefreshHistory = document.getElementById('btnRefreshHistory');

  if (btnRefreshHistory) {
    btnRefreshHistory.addEventListener('click', () => {
      if (window.TingwuBridge && window.TingwuBridge.fetchHistoryList) {
        window.TingwuBridge.fetchHistoryList();
      }
    });
  }

  // 原生触发视图切换 ('live' | 'history')
  window.onNativeSwitchView = function(viewName) {
    console.log('[mytyty] 切换前台卡片视图:', viewName);
    if (viewName === 'history') {
      if (viewLive) {
        viewLive.classList.remove('active');
        viewLive.style.display = 'none';
      }
      if (viewHistory) {
        viewHistory.classList.add('active');
        viewHistory.style.display = 'block';
      }
      // 触发向后台拉取历史
      if (window.TingwuBridge && window.TingwuBridge.fetchHistoryList) {
        window.TingwuBridge.fetchHistoryList();
      }
    } else {
      if (viewHistory) {
        viewHistory.classList.remove('active');
        viewHistory.style.display = 'none';
      }
      if (viewLive) {
        viewLive.classList.add('active');
        viewLive.style.display = 'block';
      }
    }
  };

  // 接收原生层传回的历史会议记录列表并渲染为精致移动卡片
  window.onNativeHistoryReceived = function(jsonStr) {
    try {
      const list = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
      if (!Array.isArray(list) || list.length === 0) {
        if (historyEmptyState) historyEmptyState.style.display = 'flex';
        if (historyCountBadge) historyCountBadge.textContent = '0 条记录';
        return;
      }

      if (historyEmptyState) historyEmptyState.style.display = 'none';
      if (historyCountBadge) historyCountBadge.textContent = `${list.length} 条记录`;

      if (historyListContainer) {
        // 保留空状态节点，移除旧卡片
        const cards = historyListContainer.querySelectorAll('.history-item-card');
        cards.forEach(c => c.remove());

        list.forEach(item => {
          const card = document.createElement('div');
          card.className = 'history-item-card';
          card.innerHTML = `
            <div class="history-item-header">
              <span class="history-item-title">${escapeHtml(item.title || '无标题会议')}</span>
              <span class="history-item-badge">已完成</span>
            </div>
            <div class="history-item-meta">
              <span>📅 ${escapeHtml(item.time || '刚刚')}</span>
              <span>⏱ ${escapeHtml(item.duration || '00:00')}</span>
            </div>
            <div class="history-item-footer">
              <button class="btn-view-detail" data-id="${escapeHtml(item.id || '')}">查看转写详情 ›</button>
            </div>
          `;
          card.addEventListener('click', () => {
            if (window.TingwuBridge && window.TingwuBridge.openHistoryDetail) {
              window.TingwuBridge.openHistoryDetail(item.id || '');
            }
          });
          historyListContainer.appendChild(card);
        });
      }
    } catch (e) {
      console.error('[mytyty] 解析历史记录异常:', e, jsonStr);
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 初始化设置
  updateFontScale(1.2);
})();
