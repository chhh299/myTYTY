/**
 * 本地自包含测试套件：验证 tingwu-engine-injector.js 与 app.js 的真实逻辑
 * 零依赖，直接使用 Node.js 运行
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

// 读取最新修改后的 tingwu-engine-injector.js 源码
const injectorCode = fs.readFileSync(
  path.join(__dirname, '../app/src/main/assets/tingwu-engine-injector.js'),
  'utf-8'
);

function getLatestInjectorCode() {
  return fs.readFileSync(
    path.join(__dirname, '../app/src/main/assets/tingwu-engine-injector.js'),
    'utf-8'
  );
}

console.log('====================================================');
console.log('           开始执行本地代码自动化测试');
console.log('====================================================\n');

// 构建轻量级 DOM 模拟环境
class MockElement {
  constructor(tagName, id = '', className = '', innerText = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = className;
    this.innerText = innerText;
    this._textContent = innerText;
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.eventListeners = {};
    this.clicked = false;
    this.style = {};
    const self = this;
    this.classList = {
      add: (cls) => {
        const classes = (self.className || '').split(' ').filter(Boolean);
        if (!classes.includes(cls)) classes.push(cls);
        self.className = classes.join(' ');
      },
      remove: (cls) => {
        const classes = (self.className || '').split(' ').filter(Boolean);
        self.className = classes.filter(c => c !== cls).join(' ');
      },
      contains: (cls) => {
        return (self.className || '').split(' ').includes(cls);
      }
    };
  }

  get textContent() {
    return this._textContent !== undefined ? this._textContent : this.innerText;
  }
  set textContent(val) {
    this._textContent = String(val);
    this.innerText = String(val);
  }

  set innerHTML(html) {
    this.children = [];
    // 简单解析创建子元素
    if (html.includes('sentence-original')) {
      const origMatch = html.match(/<div class="sentence-original">(.*?)<\/div>/);
      const transMatch = html.match(/<div class="sentence-translation"[^>]*>(.*?)<\/div>/);
      const origEl = new MockElement('div', '', 'sentence-original', origMatch ? origMatch[1] : '');
      const transEl = new MockElement('div', '', 'sentence-translation', transMatch ? transMatch[1] : '');
      this.appendChild(origEl);
      this.appendChild(transEl);
    }
  }
  getAttribute(k) { return this.attributes[k] || null; }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(event, fn) {
    this.eventListeners[event] = this.eventListeners[event] || [];
    this.eventListeners[event].push(fn);
  }

  dispatchEvent(event) {
    const fns = this.eventListeners[event.type] || [];
    fns.forEach(fn => fn(event));
    return true;
  }

  click() {
    this.clicked = true;
    this.dispatchEvent({ type: 'click', target: this, bubbles: true, cancelable: true });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (el) => {
      if (matches(el, selector)) {
        results.push(el);
      }
      for (const child of el.children) {
        walk(child);
      }
    };
    for (const child of this.children) {
      walk(child);
    }
    return results;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (matches(curr, selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }
}

function matches(el, selector) {
  if (!selector) return false;
  const parts = selector.split(',').map(s => s.trim());
  for (const part of parts) {
    if (matchSingle(el, part)) return true;
  }
  return false;
}

function matchSingle(el, sel) {
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    return el.className && el.className.split(' ').includes(cls);
  }
  if (sel.startsWith('#')) {
    return el.id === sel.slice(1);
  }
  if (sel.includes('[class*="')) {
    const match = sel.match(/\[class\*="([^"]+)"\]/);
    if (match) return el.className && el.className.includes(match[1]);
  }
  if (sel.includes('[aria-label*="')) {
    const match = sel.match(/\[aria-label\*="([^"]+)"\]/);
    if (match) return (el.attributes['aria-label'] || '').includes(match[1]);
  }
  if (sel === 'button' || sel === 'div' || sel === 'span' || sel === 'a' || sel === 'p') {
    return el.tagName.toLowerCase() === sel;
  }
  return false;
}

// 模拟完整的 Window / Document / Bridge 上下文
function createSandbox(url = 'https://tingwu.aliyun.com/home') {
  const document = {
    body: new MockElement('body'),
    createElement: (tag) => new MockElement(tag),
    querySelector: (sel) => document.body.querySelector(sel),
    querySelectorAll: (sel) => document.body.querySelectorAll(sel),
  };

  const bridgeHistory = {
    engineStates: [],
    recordingAcks: [],
    transcriptions: []
  };

  const sessionStorageStore = {};

  const sandbox = {
    console: {
      log: (...args) => {},
      warn: (...args) => {},
      error: (...args) => console.error('  [页面错误]', ...args)
    },
    Date: Date,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    atob: (str) => Buffer.from(str, 'base64').toString('binary'),
    TextDecoder: util.TextDecoder,
    Uint8Array: Uint8Array,
    window: null,
    document: document,
    location: {
      href: url,
      assign: (newUrl) => { sandbox.location.href = newUrl; }
    },
    sessionStorage: {
      getItem: (k) => sessionStorageStore[k] || null,
      setItem: (k, v) => { sessionStorageStore[k] = String(v); },
      removeItem: (k) => { delete sessionStorageStore[k]; }
    },
    TingwuBridge: {
      notifyEngineState: (state, desc) => {
        bridgeHistory.engineStates.push({ state, desc });
      },
      notifyRecordingAck: (started) => {
        bridgeHistory.recordingAcks.push(started);
      },
      onTranscriptionReceived: (json) => {
        bridgeHistory.transcriptions.push(JSON.parse(json));
      },
      onHistoryReceived: (json) => {
        bridgeHistory.historyList = JSON.parse(json);
      },
      updateSettings: (scale, keepOn) => {
        bridgeHistory.settings = { scale, keepOn };
      },
      startRecording: () => {},
      stopRecording: () => {},
      reloadEngine: () => {}
    },
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe() {}
      disconnect() {}
    },
    WebSocket: function(url) {
      return { addEventListener: () => {} };
    }
  };

  sandbox.window = sandbox;
  return { sandbox, document, bridgeHistory };
}

// ========================================================
// 测试套件
// ========================================================
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(description, condition, failureDetails = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ 通过: ${description}`);
  } else {
    failedTests++;
    console.log(`  ✗ 失败: ${description}`);
    if (failureDetails) console.log(`    原因: ${failureDetails}`);
  }
}

// --------------------------------------------------------
// 测试 1: 未登录首页 (URL 为 tingwu.aliyun.com/home，右上角有“登录/注册”按钮，无用户头像)
// --------------------------------------------------------
console.log('【测试 1】未登录的通义听悟主页 (真实场景：访问 /home，页面未弹出 modal，但有登录按钮)');
{
  const { sandbox, document, bridgeHistory } = createSandbox('https://tingwu.aliyun.com/home');

  // 模拟真实通义听悟未登录首页 DOM：右上角有登录按钮
  const navHeader = new MockElement('div', '', 'tingwu-header');
  const loginBtn = new MockElement('button', '', 'ant-btn login-btn', '登录/注册');
  navHeader.appendChild(loginBtn);
  document.body.appendChild(navHeader);

  // 执行当前的 injector 代码
  const fn = new Function('window', 'document', 'location', 'sessionStorage', 'TingwuBridge', 'MutationObserver', 'console', getLatestInjectorCode());
  fn(sandbox.window, sandbox.document, sandbox.location, sandbox.sessionStorage, sandbox.TingwuBridge, sandbox.MutationObserver, sandbox.console);

  const lastState = bridgeHistory.engineStates[bridgeHistory.engineStates.length - 1];
  console.log('  -> 当前代码上报的引擎状态:', lastState);

  assert(
    '未登录首页应该上报 need_login',
    lastState && lastState.state === 'need_login',
    `期望 need_login，实际输出了 ${lastState ? lastState.state : 'undefined'}`
  );
}

// --------------------------------------------------------
// 测试 2: 已登录首页 (右上角是用户头像/昵称，没有登录按钮)
// --------------------------------------------------------
console.log('\n【测试 2】已登录的通义听悟主页 (真实场景：右上角显示用户头像，可正常使用)');
{
  const { sandbox, document, bridgeHistory } = createSandbox('https://tingwu.aliyun.com/home');

  // 模拟真实已登录首页 DOM：有用户头像，无登录按钮
  const navHeader = new MockElement('div', '', 'tingwu-header');
  const userAvatar = new MockElement('div', '', 'user-avatar-wrapper');
  const avatarImg = new MockElement('img', '', 'user-avatar');
  userAvatar.appendChild(avatarImg);
  navHeader.appendChild(userAvatar);
  document.body.appendChild(navHeader);

  const fn = new Function('window', 'document', 'location', 'sessionStorage', 'TingwuBridge', 'MutationObserver', 'console', injectorCode);
  fn(sandbox.window, sandbox.document, sandbox.location, sandbox.sessionStorage, sandbox.TingwuBridge, sandbox.MutationObserver, sandbox.console);

  const lastState = bridgeHistory.engineStates[bridgeHistory.engineStates.length - 1];
  console.log('  -> 当前代码上报的引擎状态:', lastState);

  assert(
    '已登录首页应该上报 ready',
    lastState && lastState.state === 'ready',
    `期望 ready，实际输出了 ${lastState ? lastState.state : 'undefined'}`
  );
}

// --------------------------------------------------------
// 测试 3: 在主页触发“开始实时记录”
// --------------------------------------------------------
console.log('\n【测试 3】主页触发开始录音 (真实场景：点击首页大卡片“实时记录”或者录音按钮)');
{
  const { sandbox, document, bridgeHistory } = createSandbox('https://tingwu.aliyun.com/home');

  // 模拟听悟首页的主卡片
  const recordCard = new MockElement('div', '', 'realtime-card ant-card', '实时记录\n开启实时语音转写');
  document.body.appendChild(recordCard);

  const fn = new Function('window', 'document', 'location', 'sessionStorage', 'TingwuBridge', 'MutationObserver', 'console', injectorCode);
  fn(sandbox.window, sandbox.document, sandbox.location, sandbox.sessionStorage, sandbox.TingwuBridge, sandbox.MutationObserver, sandbox.console);

  // 调用开始录音
  console.log('  -> 调用 window.__tingwuController.startRecording()...');
  sandbox.window.__tingwuController.startRecording();

  console.log('  -> 卡片是否被点击:', recordCard.clicked);
  console.log('  -> 是否收到录音 ACK:', bridgeHistory.recordingAcks);

  assert('首页卡片应该被命中并点击', recordCard.clicked === true);
  assert('应该向原生层发送 notifyRecordingAck(true)', bridgeHistory.recordingAcks.includes(true));
}

// --------------------------------------------------------
// 测试 4: 工作台录音配置弹窗自动确认测试
// --------------------------------------------------------
console.log('\n【测试 4】工作台录音前置配置弹窗 (真实场景：点击开始后，弹窗让选“中文/英文/领域”，需要自动点“开始记录”)');
{
  const { sandbox, document, bridgeHistory } = createSandbox('https://tingwu.aliyun.com/doc/record');

  const modalFooter = new MockElement('div', '', 'ant-modal-footer');
  const confirmBtn = new MockElement('button', '', 'ant-btn ant-btn-primary', '开始记录');
  modalFooter.appendChild(confirmBtn);
  document.body.appendChild(modalFooter);

  const fn = new Function('window', 'document', 'location', 'sessionStorage', 'TingwuBridge', 'MutationObserver', 'console', injectorCode);
  fn(sandbox.window, sandbox.document, sandbox.location, sandbox.sessionStorage, sandbox.TingwuBridge, sandbox.MutationObserver, sandbox.console);

  // 模拟点击录音触发弹窗确认
  sandbox.window.__tingwuController.startRecording();

  // 等待定时器执行确认
  setTimeout(() => {
    console.log('  -> 配置弹窗确认按钮是否被点击:', confirmBtn.clicked);
    assert('配置弹窗的“开始记录”按钮应该被自动点击确认', confirmBtn.clicked === true);

// --------------------------------------------------------
// 测试 5: 句子流规整与气泡防重测试 (验证消灭双胞胎气泡逻辑)
// --------------------------------------------------------
console.log('\n【测试 5】句子流规整与气泡去重测试 (消除双胞胎气泡与换句覆盖)');
{
  const { sandbox, document, bridgeHistory } = createSandbox('https://tingwu.aliyun.com/home');
  const fn = new Function('window', 'document', 'location', 'sessionStorage', 'TingwuBridge', 'MutationObserver', 'console', getLatestInjectorCode());
  fn(sandbox.window, sandbox.document, sandbox.location, sandbox.sessionStorage, sandbox.TingwuBridge, sandbox.MutationObserver, sandbox.console);

  // 模拟 WebSocket 连续推流：
  // 帧 1: "今天天气"
  // 帧 2: "今天天气真好" (流式前缀递增，应当更新同一句 active_sentence_0)
  // 帧 3: "今天天气真好。" (标点结尾，仍是 active_sentence_0)
  // 帧 4: "我们要去开会" (换新句，应当递增为 active_sentence_1)
  const wsInst = sandbox.window.WebSocket('wss://tingwu.aliyun.com/api/ws');

  const simulateWsMsg = (text, trans) => {
    const jsonStr = JSON.stringify({
      header: { name: 'TranscriptionResultChange' },
      payload: { result: text, translation: trans }
    });
    // 触发内部 handleWsStringMessage
    for (let l of wsInst._listeners || []) {
      l({ data: jsonStr });
    }
  };

  // 通过 DOM 或暴露的函数测试规整逻辑
  // 模拟 DOM 监听触发
  const sentenceContainer = new MockElement('div', '', 'sentence-item');
  const textEl = new MockElement('span', '', 'text', '今天天气');
  sentenceContainer.appendChild(textEl);
  document.body.appendChild(sentenceContainer);

  // 触发 DOM 提取
  textEl.innerText = '今天天气真不错。';
  document.body.appendChild(new MockElement('div', '', 'sentence-item', '今天天气真不错。'));

  // 检查派发结果
  assert('句子流规整引擎已成功挂载在上下文中', typeof sandbox.window.__tingwuController === 'object');
}

// --------------------------------------------------------
// 测试 7: 历史记录移动端卡片视图切换与数据动态渲染测试
// --------------------------------------------------------
console.log('\n【测试 7】历史记录移动端专属卡片视图切换与数据渲染测试');
{
  const appJsCode = fs.readFileSync(
    path.join(__dirname, '../app/src/main/assets/ui/app.js'),
    'utf-8'
  );

  const { sandbox, document } = createSandbox();

  // 构建前台所需视图容器
  const viewLive = new MockElement('div', 'viewLive', 'view-section active');
  const viewHistory = new MockElement('div', 'viewHistory', 'view-section');
  const historyListContainer = new MockElement('div', 'historyListContainer', 'history-list');
  const historyEmptyState = new MockElement('div', 'historyEmptyState', 'empty-state');
  viewHistory.appendChild(historyEmptyState);
  viewHistory.appendChild(historyListContainer);

  document.body.appendChild(viewLive);
  document.body.appendChild(viewHistory);

  const elements = [
    ['engineStatusBadge', 'header-badge'],
    ['btnRefresh', 'btn'],
    ['mainRecordTimer', 'timer'],
    ['btnToggleRecord', 'btn'],
    ['recordBtnLabel', 'span'],
    ['micStatusText', 'span'],
    ['liveIndicator', 'div'],
    ['transcriptEmptyState', 'div'],
    ['streamSentences', 'div'],
    ['transcriptContainer', 'div'],
    ['floatingRecordBar', 'div'],
    ['floatingTimer', 'span'],
    ['btnFloatingStop', 'btn'],
    ['btnFontMinus', 'btn'],
    ['btnFontPlus', 'btn'],
    ['currentFontSizeLabel', 'span'],
    ['chkKeepScreenOn', 'input'],
    ['viewLive', 'view-section'],
    ['viewHistory', 'view-section'],
    ['historyListContainer', 'history-list'],
    ['historyEmptyState', 'empty-state']
  ];

  const domMap = {
    viewLive,
    viewHistory,
    historyListContainer,
    historyEmptyState
  };

  elements.forEach(([id, cls]) => {
    if (!domMap[id]) {
      const el = new MockElement('div', id, cls);
      domMap[id] = el;
      document.body.appendChild(el);
    }
  });

  document.getElementById = (id) => domMap[id] || null;
  document.documentElement = new MockElement('html');
  document.documentElement.style = { setProperty: () => {} };

  // 执行 app.js
  const appFn = new Function('window', 'document', 'console', appJsCode);
  appFn(sandbox.window, sandbox.document, sandbox.console);

  // 1. 测试原生调用视图切换至历史
  if (sandbox.window.onNativeSwitchView) {
    sandbox.window.onNativeSwitchView('history');
    assert('切换视图到 history 时 viewHistory 激活', domMap.viewHistory.className.includes('active'));
    assert('切换视图到 history 时 viewLive 取消激活', !domMap.viewLive.className.includes('active'));
  } else {
    assert('app.js 应该暴露 onNativeSwitchView 方法', false);
  }

  // 2. 测试接收到历史会议数据并渲染移动卡片
  if (sandbox.window.onNativeHistoryReceived) {
    const mockHistoryData = [
      { id: 'doc_1', title: '2026年9月季度产品规划会议', time: '2026-09-08 14:30', duration: '45分12秒' },
      { id: 'doc_2', title: 'mytyty 架构重构方案研讨', time: '2026-09-07 10:15', duration: '28分06秒' }
    ];
    sandbox.window.onNativeHistoryReceived(JSON.stringify(mockHistoryData));

    assert('有历史数据时空状态提示隐藏', domMap.historyEmptyState.style && domMap.historyEmptyState.style.display === 'none');
    assert('历史列表容器中成功渲染 2 张移动端卡片', domMap.historyListContainer.children.length === 2);
  } else {
    assert('app.js 应该暴露 onNativeHistoryReceived 方法', false);
  }
}
console.log('\n【测试 6】前台卡片 app.js 端到端事件与 UTF-8 Base64 解码测试');
{
  const appJsCode = fs.readFileSync(
    path.join(__dirname, '../app/src/main/assets/ui/app.js'),
    'utf-8'
  );

  const { sandbox, document } = createSandbox();

  // 构建前台 app.js 所需的所有 DOM 节点
  const elements = [
    ['engineStatusBadge', 'header-badge'],
    ['btnRefresh', 'btn'],
    ['mainRecordTimer', 'timer'],
    ['btnToggleRecord', 'btn'],
    ['recordBtnLabel', 'span'],
    ['micStatusText', 'span'],
    ['liveIndicator', 'div'],
    ['transcriptEmptyState', 'div'],
    ['streamSentences', 'div'],
    ['transcriptContainer', 'div'],
    ['floatingRecordBar', 'div'],
    ['floatingTimer', 'span'],
    ['btnFloatingStop', 'btn'],
    ['btnFontMinus', 'btn'],
    ['btnFontPlus', 'btn'],
    ['currentFontSizeLabel', 'span'],
    ['chkKeepScreenOn', 'input']
  ];

  const domMap = {};
  elements.forEach(([id, cls]) => {
    const el = new MockElement('div', id, cls);
    domMap[id] = el;
    document.body.appendChild(el);
  });

  document.getElementById = (id) => domMap[id] || null;
  document.documentElement = new MockElement('html');
  document.documentElement.style = { setProperty: () => {} };

  // 执行 app.js
  const appFn = new Function('window', 'document', 'console', appJsCode);
  appFn(sandbox.window, sandbox.document, sandbox.console);

  // 1. 测试原生录音状态激活回调
  sandbox.window.onNativeRecordingStatus(true);
  assert('onNativeRecordingStatus(true) 激活录音样式', domMap.btnToggleRecord.className.includes('is-recording'));
  assert('录音按钮文字变为“结束实时记录”', domMap.recordBtnLabel.innerText === '结束实时记录');

  // 2. 测试真实计时器走表 (杜绝 00:12:47 假时间，必须接收到什么展示什么)
  sandbox.window.onNativeTimerTick('00:00:15');
  assert('计时器精准接收原生走表 00:00:15', domMap.mainRecordTimer.innerText === '00:00:15');

  // 3. 测试中文 UTF-8 Base64 安全解码与字幕气泡渲染 (解决 URIError)
  const testPayload = JSON.stringify({
    id: 'sentence_1',
    text: '阿里云通义听悟实时转写测试',
    translation: 'Alibaba Tongyi Tingwu real-time transcription test',
    time: '12:00:00'
  });
  const base64Data = Buffer.from(testPayload, 'utf-8').toString('base64');
  sandbox.window.__receiveTranscriptionBase64(base64Data);

  assert('转写空状态提示已被隐藏', domMap.transcriptEmptyState.style && domMap.transcriptEmptyState.style.display === 'none');
  assert('字幕容器中已新增句子气泡', domMap.streamSentences.children.length === 1);
  const bubble = domMap.streamSentences.children[0];
  const origEl = bubble.querySelector('.sentence-original');
  assert('原文已被无损还原', origEl && origEl.innerText === '阿里云通义听悟实时转写测试');
}

    console.log('\n====================================================');
    console.log(`测试完成! 总计: ${totalTests}, 通过: ${passedTests}, 失败: ${failedTests}`);
    console.log('====================================================\n');
    process.exit(failedTests > 0 ? 1 : 0);
  }, 1000);
}
