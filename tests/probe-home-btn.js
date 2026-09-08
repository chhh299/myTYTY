const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json/list', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const list = JSON.parse(d);
    const target = list.find(p => p.url && p.url.includes('tingwu.aliyun.com/home'));
    if (!target) return console.log('not found');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (function() {
              const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开启实时记录');
              if (!btn) return 'not found';
              let cur = btn;
              while (cur && cur !== document.body) {
                if (cur.tagName === 'A') return { tag: 'A', href: cur.href, target: cur.target };
                cur = cur.parentElement;
              }
              return { tag: btn.tagName, cls: btn.className, onclick: btn.onclick ? btn.onclick.toString() : null };
            })()
          `,
          returnByValue: true
        }
      }));
    });
    ws.on('message', m => {
      console.log('Button element:', JSON.parse(m.toString()).result.result.value);
      ws.close();
    });
  });
});
