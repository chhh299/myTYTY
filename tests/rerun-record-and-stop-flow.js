/**
 * 完整重测录音启停链路 (rerun-record-and-stop-flow.js)
 * 1. 恢复到主页
 * 2. 点击“开启实时记录”进入录音工作台
 * 3. 点击“开始录音”进入实时录音
 * 4. 验证录音运行状态与计时器
 * 5. 点击 .stop-btn 结束录音，处理保存确认弹窗
 */

const WebSocket = require('ws');
const http = require('http');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function evalCdp(expression) {
  const list = await getJson('http://127.0.0.1:9222/json/list');
  const target = list.find(p => p.url && p.url.includes('tingwu.aliyun.com'));
  if (!target) throw new Error('未找到听悟页面');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true }
      }));
    });
    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        ws.close();
        resolve(msg.result && msg.result.result ? msg.result.result.value : (msg.result ? msg.result.value : null));
      }
    });
    ws.on('error', reject);
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('====================================================');
  console.log('       重新测试通义听悟真实录音启停与保存全链路');
  console.log('====================================================\n');

  // 1. 检查当前页面状态
  const curUrl = await evalCdp('location.href');
  console.log('[步骤 1] 当前页面 URL:', curUrl);

  // 如果页面上有遮罩/弹窗，或者停留在某个状态，先导航回主页
  console.log('[步骤 2] 导航回听悟主页以确保从干净状态开始...');
  await evalCdp('location.href = "https://tingwu.aliyun.com/home"');
  await sleep(3000);

  const homeUrl = await evalCdp('location.href');
  console.log('[步骤 2 完成] 主页已就绪:', homeUrl);

  // 2. 在主页寻找“开启实时记录”大按钮并点击
  console.log('\n[步骤 3] 正在主页搜寻并点击【开启实时记录】...');
  const clickStartEntry = await evalCdp(`
    (function() {
      const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开启实时记录');
      if (!btn) return { success: false, reason: '未找到开启实时记录按钮' };

      // 派发点击
      btn.click();
      return { success: true, tag: btn.tagName, cls: btn.className };
    })()
  `);
  console.log('[步骤 3 结果]:', clickStartEntry);

  if (!clickStartEntry.success) {
    console.error('未找到开启实时记录入口，终止测试');
    return;
  }

  // 3. 等待跳转至 /doc/record
  console.log('\n[步骤 4] 等待页面跳转至工作台 /doc/record ...');
  let recordReady = false;
  for (let i = 0; i < 15; i++) {
    await sleep(800);
    const url = await evalCdp('location.href');
    if (url.includes('/doc/record')) {
      recordReady = true;
      console.log(`[步骤 4 完成] 成功进入录音工作台 (${i * 800}ms):`, url);
      break;
    }
  }

  if (!recordReady) {
    console.error('跳转 /doc/record 超时');
    return;
  }

  // 4. 在 /doc/record 点击“开始录音”
  console.log('\n[步骤 5] 正在搜寻并点击【开始录音】按钮...');
  await sleep(1000);
  const clickStartRecord = await evalCdp(`
    (function() {
      const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开始录音');
      if (!btn) return { success: false, reason: '未找到开始录音按钮' };

      btn.click();
      return { success: true, tag: btn.tagName, cls: btn.className };
    })()
  `);
  console.log('[步骤 5 结果]:', clickStartRecord);

  // 5. 验证是否进入“录音中…”状态
  console.log('\n[步骤 6] 等待 2.5 秒验证是否成功进入录音中状态...');
  await sleep(2500);

  const recordState = await evalCdp(`
    (function() {
      const text = document.body ? document.body.innerText : '';
      const isRecording = text.includes('录音中…') || text.includes('/06:00:00');
      const timer = (text.match(/\\d{2}:\\d{2}\\/06:00:00/) || [])[0] || '未检测到计时器';

      // 检测是否有结束录音的 .stop-btn
      const stopBtn = document.querySelector('.stop-btn, [class*="stop-btn"], [class*="stopBtn"]');

      return {
        isRecording: isRecording,
        timer: timer,
        hasStopBtn: !!stopBtn,
        stopBtnTag: stopBtn ? stopBtn.tagName : '',
        stopBtnCls: stopBtn ? stopBtn.className : ''
      };
    })()
  `);
  console.log('[步骤 6 录音状态验证]:', JSON.stringify(recordState, null, 2));

  if (!recordState.isRecording) {
    console.warn('⚠️ 未能进入录音中状态，检查页面是否弹出权限或其他设置弹窗');
    return;
  }

  console.log('\n✅ 真实录音启动成功！计时器正在走动:', recordState.timer);

  // 6. 等待 3 秒录音后，测试点击 .stop-btn 停止录音
  console.log('\n[步骤 7] 保持录音 3 秒后，测试点击【.stop-btn】停止录音...');
  await sleep(3000);

  const stopClick = await evalCdp(`
    (function() {
      const stopBtn = document.querySelector('.stop-btn, [class*="stop-btn"], [class*="stopBtn"]');
      if (!stopBtn) return { success: false, reason: '未找到 stopBtn' };
      stopBtn.click();
      return { success: true, tag: stopBtn.tagName, cls: stopBtn.className };
    })()
  `);
  console.log('[步骤 7 点击停止结果]:', stopClick);

  // 7. 检查停止后的弹窗与状态
  console.log('\n[步骤 8] 等待 1.5 秒检查是否有保存或确认弹窗...');
  await sleep(1500);

  const postStopState = await evalCdp(`
    (function() {
      const text = document.body ? document.body.innerText : '';
      const hasModal = !!document.querySelector('.ant-modal, [class*="modal"]');
      const modalText = hasModal ? document.querySelector('.ant-modal, [class*="modal"]').innerText : '';
      const modalBtns = Array.from(document.querySelectorAll('.ant-modal button, [class*="modal"] button')).map(b => (b.innerText||'').trim());

      return {
        isStillRecording: text.includes('录音中…'),
        hasModal: hasModal,
        modalText: modalText.slice(0, 200),
        modalButtons: modalBtns
      };
    })()
  `);
  console.log('[步骤 8 停止后状态]:', JSON.stringify(postStopState, null, 2));

  // 8. 若有弹窗，自动点击确认/保存
  if (postStopState.hasModal) {
    console.log('\n[步骤 9] 检测到弹窗，正在点击【确定/结束并保存】...');
    const confirmRes = await evalCdp(`
      (function() {
        const btns = Array.from(document.querySelectorAll('.ant-modal button, [class*="modal"] button'));
        for (const b of btns) {
          const t = (b.innerText || '').trim();
          if (t === '确定' || t === '确认' || t === '结束并保存' || t === '保存' || t.includes('确定')) {
            b.click();
            return { clicked: true, text: t };
          }
        }
        return { clicked: false, availableButtons: btns.map(b => b.innerText) };
      })()
    `);
    console.log('[步骤 9 确认保存结果]:', confirmRes);
  }

  // 9. 最终验证
  await sleep(2000);
  const finalState = await evalCdp(`
    ({
      finalUrl: location.href,
      bodySnippet: document.body ? document.body.innerText.slice(0, 200) : ''
    })
  `);
  console.log('\n====================================================');
  console.log('       【全链路测试完成】');
  console.log('最终页面 URL:', finalState.finalUrl);
  console.log('最终页面摘要:', finalState.bodySnippet.replace(/\\n/g, ' '));
  console.log('====================================================');
}

main().catch(console.error);
