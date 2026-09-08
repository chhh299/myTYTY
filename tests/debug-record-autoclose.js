const WebSocket = require('ws');
const http = require('http');

async function check() {
  const res = await new Promise(r => http.get('http://127.0.0.1:9222/json/list', res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
  }));
  const target = res.find(p => p.url && p.url.includes('tingwu.aliyun.com'));
  if (!target) return console.log('未找到目标页面');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let msgId = 1;
  const send = (expr) => new Promise(r => {
    const id = msgId++;
    const handler = (m) => {
      try {
        const json = JSON.parse(m.toString());
        if (json.id === id) {
          ws.off('message', handler);
          r(json.result && json.result.result ? json.result.result.value : json.result);
        }
      } catch (e) {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({
      id: id,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true }
    }));
  });

  console.log('1. 当前页面 URL:', await send('location.href'));

  const btnInfo = await send(`
    (function() {
      const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开启实时记录');
      return btn ? { tag: btn.tagName, cls: btn.className, text: btn.innerText } : null;
    })()
  `);
  console.log('2. 【开启实时记录】按钮:', btnInfo);

  console.log('3. 模拟点击【开启实时记录】...');
  const clickRes = await send(`
    (function() {
      const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开启实时记录');
      if (btn) {
        ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(t => {
          btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        });
        return 'clicked';
      }
      return 'not found';
    })()
  `);
  console.log('   点击结果:', clickRes);

  console.log('4. 监测后续 8 秒页面状态与 URL...');
  for (let i = 1; i <= 8; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const info = await send(`
      ({
        url: location.href,
        hasStartBtn: !!Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开始录音'),
        hasStopBtn: !!document.querySelector('.stop-btn, [class*="stop-btn"]'),
        bodyTextSnippet: (document.body ? document.body.innerText : '').slice(0, 150).replace(/\\n/g, ' ')
      })
    `);
    console.log(`   [第 ${i} 秒] URL: ${info.url} | 录音按钮: ${info.hasStartBtn} | 停止按钮: ${info.hasStopBtn}`);
    console.log(`               摘要: ${info.bodyTextSnippet}`);
  }

  ws.close();
}

check().catch(console.error);
