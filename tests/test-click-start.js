const WebSocket = require('ws');
const http = require('http');

async function testClickStartRecording() {
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

  console.log('当前页面 URL:', await send('location.href'));

  // 监听 console
  ws.send(JSON.stringify({ id: msgId++, method: 'Runtime.enable', params: {} }));
  ws.on('message', m => {
    try {
      const j = JSON.parse(m.toString());
      if (j.method === 'Runtime.consoleAPICalled') {
        const text = j.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
        console.log('   [Browser Console]', text);
      }
    } catch(e) {}
  });

  console.log('查找【开始录音】按钮并点击...');
  const clickRes = await send(`
    (function() {
      const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开始录音');
      if (btn) {
        ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(t => {
          btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        });
        return 'clicked startBtn: ' + btn.className;
      }
      return 'not found startBtn';
    })()
  `);
  console.log('点击结果:', clickRes);

  console.log('监听后续 10 秒页面变化...');
  for (let i = 1; i <= 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const state = await send(`
      ({
        url: location.href,
        text: (document.body ? document.body.innerText : '').slice(0, 200).replace(/\\n/g, ' '),
        hasStopBtn: !!document.querySelector('.stop-btn, [class*="stop-btn"]'),
        hasModal: !!document.querySelector('.ant-modal')
      })
    `);
    console.log(`[第 ${i} 秒] hasStop: ${state.hasStopBtn} | hasModal: ${state.hasModal}`);
    console.log(`         摘要: ${state.text}`);
  }

  ws.close();
}

testClickStartRecording().catch(console.error);
