const WebSocket = require('ws');
const http = require('http');

async function testWindowOpen() {
  const res = await new Promise(r => http.get('http://127.0.0.1:9222/json/list', res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
  }));
  const target = res.find(p => p.url && p.url.includes('tingwu.aliyun.com'));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let msgId = 1;
  const send = (expr) => new Promise(r => {
    const id = msgId++;
    const handler = (m) => {
      try {
        const j = JSON.parse(m.toString());
        if (j.id === id) {
          ws.off('message', handler);
          r(j.result && j.result.result ? j.result.result.value : j.result);
        }
      } catch (e) {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
  });

  console.log('检查主页点击【开启实时记录】是否调用了 window.open...');
  await send('location.href = "https://tingwu.aliyun.com/home"');
  await new Promise(r => setTimeout(r, 2500));

  await send(`
    window.__openCalls = [];
    const origOpen = window.open;
    window.open = function(url, target, features) {
      window.__openCalls.push({ url, target, features });
      console.log('WINDOW.OPEN 被调用:', url, target);
      return origOpen.apply(this, arguments);
    };
  `);

  await send(`
    const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开启实时记录');
    if (btn) {
      ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(t => {
        btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      });
    }
  `);

  await new Promise(r => setTimeout(r, 1500));
  const openCalls = await send('window.__openCalls');
  console.log('window.open 捕获结果:', openCalls);

  ws.close();
}

testWindowOpen().catch(console.error);
