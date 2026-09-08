/**
 * 测试触发真实的“开启实时记录”点击并观察页面变化 (test-trigger-record.js)
 */

const http = require('http');

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
  console.log('1. 探查真实按钮的点击绑定与父链...');
  const probe = await evalInBrowser(`
    (function() {
      const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开启实时记录');
      if (!btn) return '没找到开启实时记录';

      const chain = [];
      let cur = btn;
      while (cur && cur !== document.body) {
        chain.push({
          tag: cur.tagName,
          cls: cur.className,
          cursor: window.getComputedStyle(cur).cursor
        });
        cur = cur.parentElement;
      }
      return { found: true, chain: chain };
    })()
  `);
  console.log('按钮层级链:', probe);

  console.log('\n2. 尝试模拟点击并观察 URL 或页面变化...');
  const clickRes = await evalInBrowser(`
    (function() {
      const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开启实时记录');
      if (!btn) return '未找到';

      // 寻找可点击的父节点（通常是具有 pointer cursor 或 ButtonList 容器）
      let target = btn;
      let p = btn;
      while (p && p !== document.body) {
        if (p.className && (p.className.includes('ButtonList') || p.className.includes('Button') || window.getComputedStyle(p).cursor === 'pointer')) {
          target = p;
          break;
        }
        p = p.parentElement;
      }

      // 派发全套 React 鼠标事件
      const events = ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'];
      events.forEach(type => {
        const evt = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        });
        target.dispatchEvent(evt);
      });

      return {
        clickedTag: target.tagName,
        clickedClass: target.className
      };
    })()
  `);
  console.log('点击派发结果:', clickRes);

  // 等待 2 秒检查页面变化
  await new Promise(r => setTimeout(r, 2000));

  const afterClick = await evalInBrowser(`
    ({
      currentUrl: location.href,
      bodyTextSnippet: document.body.innerText.slice(0, 300),
      hasModal: !!document.querySelector('.ant-modal, [class*="modal"], [class*="dialog"]'),
      modalText: (function() {
        const m = document.querySelector('.ant-modal, [class*="modal"], [class*="dialog"]');
        return m ? m.innerText : '';
      })()
    })
  `);
  console.log('点击 2 秒后的页面状态:', afterClick);
}

run().catch(console.error);
