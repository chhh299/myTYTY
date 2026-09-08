const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json/list', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const list = JSON.parse(d);
    const target = list.find(p => p.url && p.url.includes('tingwu.aliyun.com'));
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (function() {
              const cards = Array.from(document.querySelectorAll('[class*="groupCards"], [class*="groupCard"]'));
              const results = [];
              cards.forEach((card, idx) => {
                const text = card.innerText || '';
                const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
                // 例如:
                // lines: ["2026-09-08 21:50 记录", "03:14", "今天 21:50"]
                // 或者: ["2026-09-08 17:36 记录", "喂喂喂，可以吗？...", "00:45", "今天 17:36"]
                let title = lines[0] || ('记录 ' + (idx + 1));
                let duration = '00:00';
                let time = '';
                let snippet = '';

                for (let i = 1; i < lines.length; i++) {
                  const l = lines[i];
                  if (/^\\d{2}:\\d{2}(:\\d{2})?$/.test(l)) {
                    duration = l;
                  } else if (l.includes('今天') || l.includes('昨天') || /^\\d{4}-\\d{2}-\\d{2}/.test(l)) {
                    time = l;
                  } else {
                    snippet = l;
                  }
                }

                results.push({
                  id: 'record_' + idx,
                  title: title,
                  duration: duration,
                  time: time || '近期',
                  snippet: snippet
                });
              });
              return results;
            })()
          `,
          returnByValue: true
        }
      }));
    });
    ws.on('message', m => {
      const res = JSON.parse(m.toString());
      console.log('真实抓取到的历史记录列表:');
      console.log(JSON.stringify(res.result.result.value, null, 2));
      ws.close();
    });
  });
});
