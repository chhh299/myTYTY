/**
 * 探查在 /doc/record 录音工作台页面上的“开始录音”按钮与录音状态流转 (probe-record-page.js)
 */

const http = require('http');

async function evalInBrowser(expr) {
  const list = await getJson('http://127.0.0.1:9222/json/list');
  // 查找当前的页面，可能是 /doc/record
  const target = list.find(p => p.url && (p.url.includes('tingwu.aliyun.com/doc/record') || p.url.includes('tingwu.aliyun.com')));
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
  console.log('探查 /doc/record 页面中的“开始录音”和语言设置按钮...');
  const res = await evalInBrowser(`
    (function() {
      const all = Array.from(document.querySelectorAll('*'));
      const startBtns = [];
      const langOptions = [];

      for (const el of all) {
        const txt = (el.innerText || '').trim();
        if (txt === '开始录音') {
          startBtns.push({
            tag: el.tagName,
            cls: el.className,
            cursor: window.getComputedStyle(el).cursor,
            parentTag: el.parentElement ? el.parentElement.tagName : '',
            parentCls: el.parentElement ? el.parentElement.className : ''
          });
        }
        if (txt === '中文' || txt === '英语' || txt === '不翻译') {
          if (el.children.length === 0) {
            langOptions.push({
              txt: txt,
              tag: el.tagName,
              cls: el.className
            });
          }
        }
      }

      return {
        url: location.href,
        startBtns: startBtns,
        langOptions: langOptions
      };
    })()
  `);
  console.log('结果:', JSON.stringify(res, null, 2));

  console.log('\n2. 尝试点击 /doc/record 页面上的“开始录音”按钮...');
  const startRes = await evalInBrowser(`
    (function() {
      const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开始录音');
      if (!btn) return '没找到开始录音';

      // 派发点击
      const events = ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'];
      events.forEach(type => {
        btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });

      return { clicked: true, tag: btn.tagName, cls: btn.className };
    })()
  `);
  console.log('点击开始录音:', startRes);

  await new Promise(r => setTimeout(r, 2000));

  const afterStart = await evalInBrowser(`
    ({
      url: location.href,
      bodySnippet: document.body.innerText.slice(0, 300),
      hasPauseBtn: !!Array.from(document.querySelectorAll('*')).find(e => (e.innerText||'').trim() === '暂停' || (e.innerText||'').trim() === '结束' || (e.innerText||'').trim() === '完成'),
      buttons: Array.from(document.querySelectorAll('button, div[role="button"], [class*="btn"]')).map(e => (e.innerText||'').trim()).filter(t => t.length > 0 && t.length < 20).slice(0, 10)
    })
  `);
  console.log('开始录音 2 秒后的状态:', afterStart);
}

run().catch(console.error);
