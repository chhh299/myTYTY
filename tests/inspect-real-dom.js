/**
 * 深度探查真实通义听悟页面元素与交互 (inspect-real-dom.js)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

async function evalInBrowser(expr) {
  const list = await getJson('http://127.0.0.1:9222/json/list');
  const target = list.find(p => p.url && p.url.includes('tingwu.aliyun.com'));
  if (!target) return console.log('未找到听悟页面');

  const wsUrl = new URL(target.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: wsUrl.hostname,
      port: wsUrl.port,
      path: wsUrl.pathname,
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': Buffer.from('cdp-' + Date.now()).toString('base64')
      }
    });

    req.on('upgrade', (res, socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const secondByte = buffer[1];
          const isMasked = (secondByte & 0x80) !== 0;
          let len = secondByte & 0x7F;
          let offset = 2;
          if (len === 126) {
            if (buffer.length < 4) break;
            len = buffer.readUInt16BE(2);
            offset = 4;
          } else if (len === 127) {
            if (buffer.length < 10) break;
            len = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }
          if (isMasked) offset += 4;
          if (buffer.length < offset + len) break;
          const payload = buffer.slice(offset, offset + len);
          buffer = buffer.slice(offset + len);
          try {
            const msg = JSON.parse(payload.toString('utf-8'));
            if (msg.id === 101) {
              socket.destroy();
              resolve(msg.result && msg.result.result ? msg.result.result.value : (msg.result ? msg.result.value : null));
            }
          } catch (e) {}
        }
      });

      const sendObj = {
        id: 101,
        method: 'Runtime.evaluate',
        params: {
          expression: expr,
          returnByValue: true
        }
      };
      const text = JSON.stringify(sendObj);
      const payload = Buffer.from(text, 'utf-8');
      const len = payload.length;
      let header = Buffer.alloc(len < 126 ? 6 : 8);
      header[0] = 0x81;
      if (len < 126) {
        header[1] = 0x80 | len;
        header.writeUInt32BE(0x12345678, 2);
      } else {
        header[1] = 0x80 | 126;
        header.writeUInt16BE(len, 2);
        header.writeUInt32BE(0x12345678, 4);
      }
      const mask = header.slice(header.length - 4);
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
      socket.write(Buffer.concat([header, masked]));
    });

    req.on('error', reject);
    req.end();
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function run() {
  console.log('正在深度分析真实页面 DOM 节点...');

  // 1. 查找“开启实时记录”具体元素
  const probeRecordBtn = await evalInBrowser(`
    (function() {
      const allEls = Array.from(document.querySelectorAll('*'));
      const matches = [];
      for (const el of allEls) {
        const text = (el.innerText || '').trim();
        // 寻找包含“开启实时记录”或“实时记录”的叶子节点或近似节点
        if (text === '开启实时记录' || text === '实时记录') {
          matches.push({
            tagName: el.tagName,
            className: el.className,
            id: el.id,
            innerText: text,
            parentTag: el.parentElement ? el.parentElement.tagName : '',
            parentClass: el.parentElement ? el.parentElement.className : '',
            hasClick: typeof el.onclick === 'function'
          });
        }
      }
      return matches;
    })()
  `);
  console.log('【开启实时记录 节点分析】:', probeRecordBtn);

  // 2. 查找历史记录具体的列表节点
  const probeHistoryItems = await evalInBrowser(`
    (function() {
      // 遍历包含 "记录" 的卡片或列表项
      const allEls = Array.from(document.querySelectorAll('*'));
      const items = [];
      for (const el of allEls) {
        const text = (el.innerText || '').trim();
        if (text.includes('记录') && (text.includes('2026-') || text.includes('今天') || text.includes('00:'))) {
          // 只找较紧凑的容器
          if (text.length < 150 && el.children.length > 0) {
            items.push({
              tagName: el.tagName,
              className: el.className,
              text: text.replace(/\\n/g, ' | '),
              childrenCount: el.children.length
            });
          }
        }
      }
      return items.slice(0, 10);
    })()
  `);
  console.log('【历史记录 节点分析】:', probeHistoryItems);

  // 3. 运行我们的 injector 检查在当前真实 DOM 下的表现
  const injectorCode = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/tingwu-engine-injector.js'), 'utf-8');
  const testInjector = await evalInBrowser(`
    (function() {
      ${injectorCode}

      // 测试 checkEngineState 判定
      var detectedState = null;
      var detectedDesc = null;
      window.TingwuBridge = {
        notifyEngineState: function(s, d) {
          detectedState = s;
          detectedDesc = d;
        },
        notifyRecordingAck: function(started) {},
        onTranscriptionReceived: function() {},
        onHistoryListReceived: function() {}
      };

      checkEngineState();

      // 测试 extractHistoryListFromPage
      var historyResult = null;
      window.TingwuBridge.onHistoryListReceived = function(str) {
        historyResult = JSON.parse(str);
      };
      extractHistoryListFromPage();

      return {
        detectedState: detectedState,
        detectedDesc: detectedDesc,
        historyExtractedCount: historyResult ? historyResult.length : 0,
        historyExtracted: historyResult
      };
    })()
  `);
  console.log('【当前 injector 在真实页面运行结果】:', testInjector);
}

run().catch(console.error);
