const WebSocket = require('ws');
const http = require('http');

async function testRecordFlow() {
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

  console.log('1. 导航回 home 并等待 3 秒...');
  await send('location.href = "https://tingwu.aliyun.com/home"');
  await new Promise(r => setTimeout(r, 3000));

  console.log('2. 注入 tingwu-engine-injector.js 并挂载 Bridge 监听...');
  const fs = require('fs');
  const path = require('path');
  const injectorCode = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/tingwu-engine-injector.js'), 'utf-8');

  ws.send(JSON.stringify({
    id: msgId++,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        window.__events = [];
        window.TingwuBridge = {
          notifyEngineState: (s, d) => window.__events.push({ type: 'state', s, d }),
          notifyRecordingAck: (started) => window.__events.push({ type: 'ack', started }),
          onTranscriptionReceived: (t) => window.__events.push({ type: 'trans', t }),
          onHistoryListReceived: (h) => window.__events.push({ type: 'history' })
        };
      `
    }
  }));
  await new Promise(r => setTimeout(r, 200));

  await send(injectorCode);

  console.log('3. 执行 window.__tingwuController.startRecording()...');
  const startResult = await send('window.__tingwuController.startRecording()');
  console.log('   startRecording 返回值:', startResult);

  console.log('4. 连续监听 15 秒页面状态变化与控制台/Bridge 事件...');
  for (let s = 1; s <= 15; s++) {
    await new Promise(r => setTimeout(r, 1000));

    // 如果跳转了页面，需要再次注入并检查
    const pageInfo = await send(`
      ({
        url: location.href,
        hasStartBtn: !!Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开始录音'),
        hasStopBtn: !!document.querySelector('.stop-btn, [class*="stop-btn"]'),
        events: window.__events || [],
        sessionTask: sessionStorage.getItem('__mytyty_pending_record'),
        isRecordingActive: window.__isRecordingActive,
        bodySnippet: (document.body ? document.body.innerText.replace(/\\n/g, ' ') : '').slice(0, 120)
      })
    `);

    // 如果是新页面，补注入以抓取数据
    if (pageInfo.url.includes('/doc/record') && (!pageInfo.events || pageInfo.events.length === 0)) {
      await send(`
        if (!window.TingwuBridge) {
          window.__events = [];
          window.TingwuBridge = {
            notifyEngineState: (s, d) => window.__events.push({ type: 'state', s, d }),
            notifyRecordingAck: (started) => window.__events.push({ type: 'ack', started }),
            onTranscriptionReceived: (t) => window.__events.push({ type: 'trans', t }),
            onHistoryListReceived: (h) => window.__events.push({ type: 'history' })
          };
        }
      `);
      await send(injectorCode);
    }

    console.log(`[第 ${s} 秒] URL: ${pageInfo.url}`);
    console.log(`   录音按钮: ${pageInfo.hasStartBtn} | 停止按钮: ${pageInfo.hasStopBtn} | isRecordingActive: ${pageInfo.isRecordingActive} | 待执行任务: ${pageInfo.sessionTask}`);
    console.log(`   页面摘要: ${pageInfo.bodySnippet}`);
    if (pageInfo.events && pageInfo.events.length > 0) {
      console.log(`   捕获事件:`, pageInfo.events);
    }
  }

  ws.close();
}

testRecordFlow().catch(console.error);
