/**
 * mytyty 极简移动端原生卡片交互控制器 (app.js)
 * 100% 真实事件驱动，严禁任何写死虚假数据与自跑模拟流
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

  // 录音状态改变
  window.onNativeRecordingStatus = function(active) {
    isRecording = active;
    if (active) {
      btnToggleRecord.classList.add('is-recording');
      recordBtnLabel.textContent = '结束实时记录';
      mainRecordTimer.classList.add('recording');
      micStatusText.textContent = '实时麦克风录音中 · 云端转写中';
      liveIndicator.style.display = 'flex';
      floatingRecordBar.style.display = 'block';
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

  // 核心：接收并渲染来自通义听悟的真实转写与翻译数据包
  window.onNativeTranscriptionReceived = function(jsonStr) {
    try {
      const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
      if (!data) return;

      // 隐藏空状态提示
      if (transcriptEmptyState) {
        transcriptEmptyState.style.display = 'none';
      }

      // 数据协议规范化 (无论是 WebSocket 拦截还是 DOM 穿透)
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
        if (originalText) sentenceObj.origEl.textContent = originalText;
        if (translationText) sentenceObj.transEl.textContent = translationText;
      }

      updateDisplayMode();

      // 自动平滑滚动到底部跟随最新流
      transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    } catch (e) {
      console.error('[mytyty] 解析转写数据异常:', e, jsonStr);
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 初始化设置
  updateFontScale(1.2);
})();
