const WebSocket = require('ws');
const http = require('http');

async function testEdgeExactRecord() {
  const res = await new Promise(r => http.get('http://127.0.0.1:9222/json/list', res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
  }));
  const target = res.find(p => p.url && p.url.includes('tingwu.aliyun.com'));
  if (!target) return console.log('未找到页面');

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

  // 开启 Console 与 Network 监听
  ws.send(JSON.stringify({ id: msgId++, method: 'Runtime.enable', params: {} }));
  ws.send(JSON.stringify({ id: msgId++, method: 'Page.enable', params: {} }));
  ws.on('message', m => {
    try {
      const j = JSON.parse(m.toString());
      if (j.method === 'Runtime.consoleAPICalled') {
        const text = j.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
        console.log('[Console]', text);
      } else if (j.method === 'Page.javascriptDialogOpening') {
        console.log('[Dialog 弹窗]', j.params.message);
      }
    } catch (e) {}
  });

  console.log('1. 回到 home...');
  await send('location.href = "https://tingwu.aliyun.com/home"');
  await new Promise(r => setTimeout(r, 3000));

  console.log('2. 注入 injector 并触发 startRecording...');
  const fs = require('fs');
  const path = require('path');
  const injectorCode = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/tingwu-engine-injector.js'), 'utf-8');
  await send(`
    window.TingwuBridge = {
      notifyEngineState: (s, d) => console.log('BRIDGE_STATE:', s, d),
      notifyRecordingAck: (started) => console.log('BRIDGE_ACK:', started),
      onTranscriptionReceived: (t) => {},
      onHistoryListReceived: (h) => {}
    };
  `);
  await send(injectorCode);

  console.log('3. 点击开始录音...');
  await send('window.__tingwuController.startRecording()');

  console.log('4. 密切监测后续 15 秒...');
  for (let i = 1; i <= 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const info = await send(`
      ({
        url: location.href,
        text: document.body ? document.body.innerText.slice(0, 150).replace(/\\n/g, ' ') : '',
        hasStartBtn: !!Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开始录音'),
        hasStopBtn: !!document.querySelector('.stop-btn, [class*="stop-btn"]'),
        isRecordingActive: window.__isRecordingActive
      })
    `);
    console.log(`[${i}s] URL: ${info.url}`);
    console.log(`    hasStart: ${info.hasStartBtn} | hasStop: ${info.hasStopBtn} | isRecordingActive: ${info.isRecordingActive}`);
    console.log(`    text: ${info.text}`);
  }

  ws.close();
}

testEdgeExactRecord().catch(console.error);
