/**
 * 基于 Chrome DevTools Protocol (CDP) 的真实通义听悟端到端测试器
 * 零第三方依赖，直接使用 Node.js 原生 http/websocket 与系统 Edge 联动
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const browserPath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const userDataDir = path.join(__dirname, '../.tmp_browser_profile');
const DEBUG_PORT = 9222;

const injectorCode = fs.readFileSync(
  path.join(__dirname, '../app/src/main/assets/tingwu-engine-injector.js'),
  'utf-8'
);

async function start() {
  console.log('====================================================');
  console.log('       启动真实通义听悟端到端联调环境 (CDP 模式)');
  console.log('====================================================\n');

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // 1. 启动带调试端口的 Edge
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    '--no-first-run',
    '--no-default-browser-check',
    'https://tingwu.aliyun.com/home'
  ];

  console.log('[1/4] 正在拉起 Edge 浏览器访问通义听悟官网...');
  const browserProc = spawn(browserPath, args);

  browserProc.on('error', (err) => {
    console.error('启动浏览器失败:', err);
  });

  // 等待调试端口就绪
  console.log('[2/4] 等待浏览器调试接口就绪...');
  let targetPage = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const list = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      targetPage = list.find(p => p.url && p.url.includes('tingwu.aliyun.com'));
      if (targetPage && targetPage.webSocketDebuggerUrl) {
        break;
      }
    } catch (e) {}
  }

  if (!targetPage) {
    console.error('未能连接到通义听悟页面，请确认浏览器已正常启动。');
    return;
  }

  console.log('[3/4] 成功连接通义听悟页面 CDP 接口:', targetPage.url);
  console.log('\n====================================================');
  console.log('>>> 请在弹出的 Edge 浏览器窗口中完成登录 (扫码或短信)');
  console.log('>>> 脚本将全程自动监听真实登录态与 DOM 结构变化...');
  console.log('====================================================\n');

  // 连接 WebSocket
  const wsUrl = targetPage.webSocketDebuggerUrl;
  const cdp = new SimpleCdpClient(wsUrl);
  await cdp.connect();

  // 开启页面事件
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // 注入 Mock Android TingwuBridge
  const setupBridgeScript = `
    window.TingwuBridge = {
      notifyEngineState: function(state, desc) {
        console.log('__BRIDGE_STATE__:' + JSON.stringify({ state, desc }));
      },
      notifyRecordingAck: function(started) {
        console.log('__BRIDGE_ACK__:' + JSON.stringify({ started }));
      },
      onTranscriptionReceived: function(jsonStr) {
        console.log('__BRIDGE_TRANS__:' + jsonStr);
      },
      onHistoryListReceived: function(jsonStr) {
        console.log('__BRIDGE_HISTORY__:' + jsonStr);
      }
    };
  `;
  await cdp.send('Runtime.evaluate', { expression: setupBridgeScript });

  // 注入我们正在使用的 injector 代码
  await cdp.send('Runtime.evaluate', { expression: injectorCode });

  // 监听真实控制台输出
  cdp.on('Runtime.consoleAPICalled', (params) => {
    const text = params.args.map(a => a.value || JSON.stringify(a)).join(' ');
    if (text.includes('__BRIDGE_STATE__:')) {
      const data = JSON.parse(text.split('__BRIDGE_STATE__:')[1]);
      console.log(`\n【真实状态变更】-> [${data.state}] ${data.desc}`);
      if (data.state === 'ready') {
        console.log('🎉 恭喜！真实听悟已识别为已登录就绪状态！');
        console.log('>>> 正在尝试真实调用 window.__tingwuController.startRecording()...');
        cdp.send('Runtime.evaluate', { expression: 'window.__tingwuController && window.__tingwuController.startRecording();' });
      }
    } else if (text.includes('__BRIDGE_ACK__:')) {
      const data = JSON.parse(text.split('__BRIDGE_ACK__:')[1]);
      console.log(`\n【真实录音 ACK 握手】-> started = ${data.started}`);
    } else if (text.includes('__BRIDGE_HISTORY__:')) {
      const list = JSON.parse(text.split('__BRIDGE_HISTORY__:')[1]);
      console.log(`\n【真实历史记录提取】-> 共抓取到 ${list.length} 条真实记录:`, list.slice(0, 3));
    } else {
      console.log('  [网页控制台]', text.slice(0, 150));
    }
  });

  // 循环轮询状态与检查真实 DOM
  setInterval(async () => {
    try {
      const res = await cdp.send('Runtime.evaluate', {
        expression: `({
          url: location.href,
          cookie: document.cookie ? document.cookie.slice(0, 50) : '',
          hasAvatar: !!document.querySelector('[class*="avatar"], .user-avatar, img[class*="avatar"]'),
          loginBtn: Array.from(document.querySelectorAll('button, a')).map(e => (e.innerText||'').trim()).filter(t => t === '登录' || t === '登录/注册'),
          bodyLen: document.body ? document.body.innerText.length : 0
        })`,
        returnByValue: true
      });
      // 触发一次 checkEngineState
      await cdp.send('Runtime.evaluate', { expression: 'window.checkEngineState && window.checkEngineState();' });
    } catch (e) {}
  }, 3000);
}

// 简易 WebSocket 客户端 (基于 Node.js 原生 http upgrade)
class SimpleCdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
    this.listeners = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = new URL(this.wsUrl);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': Buffer.from('mytyty-cdp-' + Date.now()).toString('base64')
        }
      });

      req.on('upgrade', (res, socket) => {
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        socket.on('data', chunk => this.handleData(chunk));
        resolve();
      });

      req.on('error', reject);
      req.end();
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      const payload = JSON.stringify({ id, method, params });
      this.writeFrame(payload);
    });
  }

  on(event, fn) {
    this.listeners.set(event, fn);
  }

  writeFrame(text) {
    const payload = Buffer.from(text, 'utf-8');
    const len = payload.length;
    let header;

    if (len < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x81;
      header[1] = 0x80 | len;
      header.writeUInt32BE(0x12345678, 2);
    } else if (len < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
      header.writeUInt32BE(0x12345678, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
      header.writeUInt32BE(0x12345678, 10);
    }

    const mask = header.slice(header.length - 4);
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      masked[i] = payload[i] ^ mask[i % 4];
    }

    this.socket.write(Buffer.concat([header, masked]));
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const secondByte = this.buffer[1];
      const isMasked = (secondByte & 0x80) !== 0;
      let len = secondByte & 0x7F;
      let offset = 2;

      if (len === 126) {
        if (this.buffer.length < 4) break;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) break;
        len = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      if (isMasked) offset += 4;
      if (this.buffer.length < offset + len) break;

      const payload = this.buffer.slice(offset, offset + len);
      this.buffer = this.buffer.slice(offset + len);

      try {
        const msg = JSON.parse(payload.toString('utf-8'));
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        } else if (msg.method && this.listeners.has(msg.method)) {
          this.listeners.get(msg.method)(msg.params);
        }
      } catch (e) {}
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

start().catch(console.error);
