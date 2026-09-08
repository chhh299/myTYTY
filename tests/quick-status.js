const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json/list', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const list = JSON.parse(d);
    const target = list.find(p => p.url && p.url.includes('tingwu.aliyun.com'));
    if (!target) return console.log('not found');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: '({ url: location.href, body: document.body ? document.body.innerText.slice(0, 300) : "" })',
          returnByValue: true
        }
      }));
    });
    ws.on('message', m => {
      const res = JSON.parse(m.toString());
      console.log('当前页面状态:', res.result.result.value);
      ws.close();
    });
  });
});
