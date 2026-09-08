/**
 * 听悟移动助手 - 前端 UI 控制逻辑
 * 负责设计图卡片组件的状态驱动、双语 Tab 切换、手势与弹窗交互。
 */

document.addEventListener('DOMContentLoaded', () => {
  const btnMainRecord = document.getElementById('btnMainRecord');
  const btnStopRecord = document.getElementById('btnStopRecord');
  const floatingRecordBar = document.getElementById('floatingRecordBar');
  const floatingTime = document.getElementById('floatingTime');
  const floatingSubtitle = document.getElementById('floatingSubtitle');
  const recognitionStatus = document.getElementById('recognitionStatus');
  const statusLabel = document.getElementById('statusLabel');
  const transcriptText = document.getElementById('transcriptText');
  const translationText = document.getElementById('translationText');
  const statusTime = document.getElementById('statusTime');

  // 弹窗与设置元素
  const btnOpenDisplaySettings = document.getElementById('btnOpenDisplaySettings');
  const settingsModalOverlay = document.getElementById('settingsModalOverlay');
  const btnCloseSheet = document.getElementById('btnCloseSheet');
  const fontSizeSlider = document.getElementById('fontSizeSlider');
  const fontSizeVal = document.getElementById('fontSizeVal');
  const displaySettingsSummary = document.getElementById('displaySettingsSummary');
  const keepScreenOnToggle = document.getElementById('keepScreenOnToggle');

  // 更多选项
  const btnMore = document.getElementById('btnMore');
  const moreModalOverlay = document.getElementById('moreModalOverlay');
  const btnCloseMore = document.getElementById('btnCloseMore');
  const btnToggleDesktopRaw = document.getElementById('btnToggleDesktopRaw');
  const btnCopyTranscript = document.getElementById('btnCopyTranscript');
  const btnClearTranscript = document.getElementById('btnClearTranscript');
  const btnRefresh = document.getElementById('btnRefresh');

  // Tab 与导航
  const tabPills = document.querySelectorAll('.tab-pill');
  const navItems = document.querySelectorAll('.nav-item');

  // 状态变量
  let isRecording = true;
  let activeSubTab = 'original'; // 'original' | 'translation'
  let currentFontSize = 120;
  let keepScreenOn = true;
  let fullTranscripts = [
    "今天我们主要讨论一下这个方案，手机端只需要保持网页在桌面模式，其余逻辑都交给听悟处理。"
  ];
  let fullTranslations = [
    "Today we mainly discussed this approach. The mobile app only needs to keep the web page in desktop mode."
  ];

  // 1. 同步时间
  const updateCurrentClock = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    if (statusTime) statusTime.textContent = `${h}:${m}`;
  };
  updateCurrentClock();
  setInterval(updateCurrentClock, 30000);

  // 2. 录音状态更新 UI
  const setRecordingState = (recording) => {
    isRecording = recording;
    if (recording) {
      btnMainRecord.textContent = '录音中';
      btnMainRecord.classList.add('recording');
      floatingRecordBar.style.display = 'flex';
      floatingSubtitle.textContent = '实时录音中';
      statusLabel.textContent = '正在识别…';
      recognitionStatus.style.opacity = '1';
    } else {
      btnMainRecord.textContent = '开始录音';
      btnMainRecord.classList.remove('recording');
      floatingSubtitle.textContent = '已暂停/就绪';
      statusLabel.textContent = '就绪';
      recognitionStatus.style.opacity = '0.5';
    }
  };

  // 3. 字幕 Tab 切换（原文 / 翻译）
  tabPills.forEach(pill => {
    pill.addEventListener('click', () => {
      tabPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeSubTab = pill.dataset.tab;

      if (activeSubTab === 'original') {
        transcriptText.textContent = fullTranscripts.slice(-3).join('\n');
      } else {
        transcriptText.textContent = fullTranslations.slice(-3).join('\n');
      }
    });
  });

  // 4. 底部主导航切换
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const target = item.dataset.nav;

      if (target === 'history') {
        if (window.TingwuBridge && window.TingwuBridge.showHistory) {
          window.TingwuBridge.showHistory();
        } else {
          alert('【历史记录】在 Android App 中将自动加载通义听悟历史会议记录。');
        }
      } else if (target === 'settings') {
        settingsModalOverlay.classList.add('active');
      } else if (target === 'home') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });

  // 5. 显示设置与字号滑块
  const applyDisplaySettings = (size, keepOn) => {
    currentFontSize = size;
    keepScreenOn = keepOn;
    document.documentElement.style.setProperty('--font-scale', (size / 100).toString());
    fontSizeVal.textContent = `${size}%`;
    displaySettingsSummary.textContent = `字号 ${size}% · 屏幕常亮 ${keepOn ? '开' : '关'}`;

    if (window.TingwuBridge && window.TingwuBridge.updateSettings) {
      window.TingwuBridge.updateSettings(size, keepOn);
    }
  };

  btnOpenDisplaySettings.addEventListener('click', () => {
    settingsModalOverlay.classList.add('active');
  });

  btnCloseSheet.addEventListener('click', () => {
    settingsModalOverlay.classList.remove('active');
  });

  settingsModalOverlay.addEventListener('click', (e) => {
    if (e.target === settingsModalOverlay) {
      settingsModalOverlay.classList.remove('active');
    }
  });

  fontSizeSlider.addEventListener('input', (e) => {
    applyDisplaySettings(parseInt(e.target.value, 10), keepScreenOnToggle.checked);
  });

  keepScreenOnToggle.addEventListener('change', (e) => {
    applyDisplaySettings(parseInt(fontSizeSlider.value, 10), e.target.checked);
  });

  // 6. 更多操作菜单
  btnMore.addEventListener('click', () => {
    moreModalOverlay.classList.add('active');
  });

  btnCloseMore.addEventListener('click', () => {
    moreModalOverlay.classList.remove('active');
  });

  moreModalOverlay.addEventListener('click', (e) => {
    if (e.target === moreModalOverlay) {
      moreModalOverlay.classList.remove('active');
    }
  });

  btnToggleDesktopRaw.addEventListener('click', () => {
    moreModalOverlay.classList.remove('active');
    if (window.TingwuBridge && window.TingwuBridge.toggleDesktopView) {
      window.TingwuBridge.toggleDesktopView();
    }
  });

  btnCopyTranscript.addEventListener('click', () => {
    moreModalOverlay.classList.remove('active');
    const textToCopy = fullTranscripts.join('\n');
    if (window.TingwuBridge && window.TingwuBridge.copyToClipboard) {
      window.TingwuBridge.copyToClipboard(textToCopy);
    } else {
      navigator.clipboard.writeText(textToCopy).then(() => {
        alert('全部字幕已复制到剪贴板！');
      });
    }
  });

  btnClearTranscript.addEventListener('click', () => {
    moreModalOverlay.classList.remove('active');
    fullTranscripts = [];
    fullTranslations = [];
    transcriptText.textContent = '等待说话中…';
    translationText.textContent = 'Waiting for speech input...';
  });

  btnRefresh.addEventListener('click', () => {
    if (window.TingwuBridge && window.TingwuBridge.reloadEngine) {
      window.TingwuBridge.reloadEngine();
    } else {
      location.reload();
    }
  });

  // 7. 录音按钮事件绑定
  btnMainRecord.addEventListener('click', () => {
    if (isRecording) {
      if (window.TingwuBridge && window.TingwuBridge.stopRecording) {
        window.TingwuBridge.stopRecording();
      }
    } else {
      if (window.TingwuBridge && window.TingwuBridge.startRecording) {
        window.TingwuBridge.startRecording();
      }
    }
  });

  btnStopRecord.addEventListener('click', () => {
    if (window.TingwuBridge && window.TingwuBridge.stopRecording) {
      window.TingwuBridge.stopRecording();
    }
  });

  // 8. 监听来自 TingwuBridge 的数据回传
  if (window.TingwuBridge && typeof window.TingwuBridge.on === 'function') {
    window.TingwuBridge.on('transcription', (data) => {
      if (data.textZh) {
        if (data.isFinal) {
          fullTranscripts.push(data.textZh);
        }
        if (activeSubTab === 'original') {
          transcriptText.textContent = data.textZh;
        }
      }
      if (data.textEn) {
        if (data.isFinal) {
          fullTranslations.push(data.textEn);
        }
        translationText.textContent = data.textEn;
        if (activeSubTab === 'translation') {
          transcriptText.textContent = data.textEn;
        }
      }
    });

    window.TingwuBridge.on('statusChange', (data) => {
      setRecordingState(data.isRecording);
    });

    window.TingwuBridge.on('timerTick', (timeStr) => {
      if (floatingTime) {
        floatingTime.textContent = timeStr;
      }
    });
  }

  // 供 Android 原生注入调用的全局接收函数
  window.onNativeTranscriptionReceived = (jsonStr) => {
    try {
      const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
      if (data.textZh) {
        if (activeSubTab === 'original') {
          transcriptText.textContent = data.textZh;
        }
        if (data.isFinal) fullTranscripts.push(data.textZh);
      }
      if (data.textEn) {
        translationText.textContent = data.textEn;
        if (activeSubTab === 'translation') {
          transcriptText.textContent = data.textEn;
        }
        if (data.isFinal) fullTranslations.push(data.textEn);
      }
    } catch (e) {
      console.error('[WebUI] 解析原生数据异常:', e);
    }
  };

  window.onNativeTimerTick = (timeStr) => {
    if (floatingTime) floatingTime.textContent = timeStr;
  };

  window.onNativeRecordingStatus = (isRec) => {
    setRecordingState(isRec);
  };
});
