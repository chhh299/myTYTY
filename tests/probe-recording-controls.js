/**
 * 探查正在录音页面 /doc/record 的控制按钮（暂停、结束、保存）和转写容器 (probe-recording-controls.js)
 */

const http = require('http');

async function evalInBrowser(expr) {
  const list = await getJson('http://127.0.0.1:9222/json/list');
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
              if (msg.result && msg.result.result) {
                resolve(msg.result.result.value);
              } else if (msg.result) {
                resolve(msg.result.value);
              } else {
                resolve(msg);
              }
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
  console.log('探查录音中的所有控制元素和转写结构...');
  const res = await evalInBrowser(`
    (function() {
      const all = Array.from(document.querySelectorAll('*'));
      const clickableIcons = [];
      const texts = [];

      for (const el of all) {
        const txt = (el.innerText || '').trim();
        const aria = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const cls = el.className || '';

        // 收集可能是结束/暂停按钮的元素
        if (txt === '结束' || txt === '暂停' || txt === '停止' || txt === '完成' ||
            aria.includes('结束') || aria.includes('暂停') || aria.includes('停止') ||
            title.includes('结束') || title.includes('暂停') || title.includes('停止') ||
            cls.includes('record') || cls.includes('stop') || cls.includes('pause')) {
          clickableIcons.push({
            tag: el.tagName,
            cls: cls,
            txt: txt,
            aria: aria,
            title: title,
            cursor: window.getComputedStyle(el).cursor
          });
        }
      }

      // 寻找底部录音条容器
      const bottomBar = Array.from(document.querySelectorAll('div')).find(e => {
        const t = e.innerText || '';
        return t.includes('录音中') && t.includes('06:00:00');
      });

      let bottomBarHtml = '';
      if (bottomBar) {
        bottomBarHtml = bottomBar.outerHTML.slice(0, 1000);
      }

      return {
        url: location.href,
        clickableIcons: clickableIcons.slice(0, 15),
        bottomBarFound: !!bottomBar,
        bottomBarTag: bottomBar ? bottomBar.tagName : '',
        bottomBarClass: bottomBar ? bottomBar.className : '',
        bottomBarChildren: bottomBar ? Array.from(bottomBar.querySelectorAll('*')).map(c => ({ tag: c.tagName, cls: c.className, txt: c.innerText || '', title: c.getAttribute('title') || '' })).filter(c => c.tag === 'BUTTON' || c.cls.includes('btn') || c.cls.includes('icon') || c.title || (c.txt && c.txt.length < 10)) : []
      };
    })()
  `);

  console.log('探查结果:', JSON.stringify(res, null, 2));
}

run().catch(console.error);
