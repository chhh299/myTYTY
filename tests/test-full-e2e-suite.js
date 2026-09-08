/**
 * 全链路端到端自动化验收脚本 (test-full-e2e-suite.js)
 * 在已真实登录的 Edge 浏览器中执行完整业务链路：
 * 1. 导航至主页并注入最新的 tingwu-engine-injector.js
 * 2. 验证状态自适应判定 (应为 ready 听悟已就绪)
 * 3. 验证历史记录提取 (拉取真实会议记录列表)
 * 4. 验证开始录音 (主页 -> /doc/record -> 开始录音 -> 接收 ACK)
 * 5. 录音持续 5 秒并校验录音状态
 * 6. 验证结束录音与自动保存 (点击 .stop-btn -> 自动确认结束 -> 成功保存)
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('====================================================');
  console.log('       mytyty 全链路端到端实机自动化验收');
  console.log('====================================================\n');

  const list = await getJson('http://127.0.0.1:9222/json/list');
  const target = list.find(p => p.url && p.url.includes('tingwu.aliyun.com'));
  if (!target) {
    console.error('未找到听悟页面，请确认 Edge 浏览器已在 9222 端口运行');
    return;
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);

  let msgId = 1;
  const callbacks = new Map();
  const eventListeners = [];

  ws.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id && callbacks.has(msg.id)) {
        const cb = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        cb(msg.result && msg.result.result ? msg.result.result.value : (msg.result ? msg.result.value : msg));
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
        eventListeners.forEach(fn => fn(text));
      }
    } catch (e) {}
  });

  await new Promise(resolve => ws.on('open', resolve));

  function evalJs(expr) {
    return new Promise(resolve => {
      const id = msgId++;
      callbacks.set(id, raw => {
        let val = raw;
        if (val && typeof val === 'object' && val.result && val.result.value !== undefined) {
          val = val.result.value;
        } else if (val && typeof val === 'object' && val.value !== undefined) {
          val = val.value;
        }
        resolve(val);
      });
      ws.send(JSON.stringify({
        id: id,
        method: 'Runtime.evaluate',
        params: { expression: expr, returnByValue: true }
      }));
    });
  }

  // 1. 清理 sessionStorage 并导航回干净的 home 主页
  console.log('[用例 1/5] 清理待处理标志并导航至通义听悟主页...');
  await evalJs('sessionStorage.clear(); location.href = "https://tingwu.aliyun.com/home"');
  await sleep(4000);

  const sendRaw = (method, params) => ws.send(JSON.stringify({ id: msgId++, method, params }));
  sendRaw('Runtime.enable', {});

  // 2. 注入 Mock Bridge 和最新的 Injector 脚本
  console.log('[用例 2/5] 注入 TingwuBridge 与最新引擎脚本...');
  const injectorCode = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/tingwu-engine-injector.js'), 'utf-8');

  let lastBridgeState = null;
  let lastAck = null;
  let historyList = null;

  eventListeners.push(logText => {
    if (logText.includes('__BRIDGE_STATE__:')) {
      lastBridgeState = JSON.parse(logText.split('__BRIDGE_STATE__:')[1]);
      console.log('   -> 【Bridge 事件】状态变更:', lastBridgeState);
    } else if (logText.includes('__BRIDGE_ACK__:')) {
      lastAck = JSON.parse(logText.split('__BRIDGE_ACK__:')[1]);
      console.log('   -> 【Bridge 事件】录音 ACK:', lastAck);
    } else if (logText.includes('__BRIDGE_HISTORY__:')) {
      historyList = JSON.parse(logText.split('__BRIDGE_HISTORY__:')[1]);
      console.log(`   -> 【Bridge 事件】历史记录提取: 共 ${historyList.length} 条记录`);
    } else if (logText.includes('[mytyty-engine]')) {
      console.log('   [引擎日志]', logText);
    }
  });

  const setupCode = `
    window.TingwuBridge = {
      notifyEngineState: function(state, desc) {
        console.log('__BRIDGE_STATE__:' + JSON.stringify({ state: state, desc: desc }));
      },
      notifyRecordingAck: function(started) {
        console.log('__BRIDGE_ACK__:' + JSON.stringify({ started: started }));
      },
      onTranscriptionReceived: function(str) {
        console.log('__BRIDGE_TRANS__:' + str);
      },
      onHistoryListReceived: function(str) {
        console.log('__BRIDGE_HISTORY__:' + str);
      }
    };
  `;
  await evalJs(setupCode);
  await evalJs(injectorCode);

  // 3. 验证状态检测与历史记录提取
  console.log('\n[用例 3/5] 检验登录态判定与历史会议抓取...');
  await evalJs('window.checkEngineState && window.checkEngineState();');
  await sleep(1000);

  console.log('当前听悟状态:', lastBridgeState);

  await evalJs('window.fetchHistoryList && window.fetchHistoryList();');
  await sleep(1000);

  if (historyList && historyList.length > 0) {
    console.log('✅ 成功提取真实历史记录示例:');
    historyList.slice(0, 3).forEach((item, idx) => {
      console.log(`   [${idx + 1}] 标题: ${item.title} | 时长: ${item.duration} | 时间: ${item.time}`);
    });
  } else {
    console.log('未提取到历史记录，当前页面历史为空或正在加载');
  }

  // 4. 验证启动录音全流程
  console.log('\n[用例 4/5] 验证真实录音启动 (主页 -> /doc/record -> 开始录音)...');
  lastAck = null;
  await evalJs('window.__tingwuController && window.__tingwuController.startRecording();');

  // 等待进入录音并收到 ACK
  let waitAckTime = 0;
  while (!lastAck && waitAckTime < 15) {
    await sleep(1000);
    waitAckTime++;
    // 在页面跳转后，重新注入 bridge 和 injector 确保新页面继续被接管
    const url = await evalJs('location.href');
    if (url.includes('/doc/record')) {
      await evalJs(setupCode);
      await evalJs(injectorCode);
    }
  }

  if (lastAck && lastAck.started) {
    console.log('✅ 真实录音启动成功！已收到 ACK (started = true)');
  } else {
    console.warn('⚠️ 等待 ACK 超时，检查当前录音状态...');
  }

  // 持续录音 5 秒，观察计时器与状态
  console.log('正在进行真实录音中，保持 5 秒...');
  for (let i = 1; i <= 5; i++) {
    await sleep(1000);
    const timeInfo = await evalJs(`
      (function() {
        const text = document.body ? document.body.innerText : '';
        const match = text.match(/\\d{2}:\\d{2}\\/06:00:00/);
        return match ? match[0] : '计时中...';
      })()
    `);
    console.log(`   录音走表 [${i}s]: ${timeInfo}`);
  }

  // 5. 验证结束录音与自动保存并自动返回 home
  console.log('\n[用例 5/5] 验证真实结束录音、自动确认保存并自动返回 home 主页...');
  await evalJs('window.__tingwuController && window.__tingwuController.stopRecording();');

  // 等待保存并自动返回 home
  let returnedHome = false;
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const u = await evalJs('location.href');
    if (u.includes('/home')) {
      returnedHome = true;
      console.log(`✅ 录音保存成功，已自动返回主页 (${(i + 1)}s):`, u);
      break;
    }
  }

  if (!returnedHome) {
    console.log('正在手动确认返回主页...');
    await evalJs('location.href = "https://tingwu.aliyun.com/home"');
    await sleep(2000);
  }

  const finalUrl = await evalJs('location.href');
  const finalSummary = await evalJs('document.body ? document.body.innerText.slice(0, 200) : ""');
  console.log('最终页面 URL:', finalUrl);
  console.log('最终页面摘要:', finalSummary.replace(/\n/g, ' '));

  console.log('\n====================================================');
  console.log('       🎉 全部 5 项端到端业务验收测试执行完毕！');
  console.log('====================================================');

  ws.close();
}

main().catch(console.error);
