/**
 * 测试点击 .stop-btn 停止录音并检查保存与结果
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
  console.log('1. 寻找并点击 .stop-btn ...');
  const stopRes = await evalCdp(`
    (function() {
      const btn = document.querySelector('.stop-btn, [class*="stop-btn"], [class*="stopBtn"]');
      if (!btn) return { found: false };
      btn.click();
      return { found: true, tag: btn.tagName, cls: btn.className };
    })()
  `);
  console.log('点击 .stop-btn 结果:', stopRes);

  console.log('2. 等待 2 秒检查是否有确认弹窗或跳转...');
  await sleep(2000);

  const afterStop = await evalCdp(`
    (function() {
      const text = document.body ? document.body.innerText : '';
      const hasModal = !!document.querySelector('.ant-modal, [class*="modal"]');
      const modalText = hasModal ? document.querySelector('.ant-modal, [class*="modal"]').innerText : '';
      const confirmBtn = Array.from(document.querySelectorAll('.ant-modal button, [class*="modal"] button')).map(b => (b.innerText||'').trim());

      return {
        url: location.href,
        hasModal: hasModal,
        modalText: modalText,
        confirmButtons: confirmBtn,
        isRecording: text.includes('录音中…')
      };
    })()
  `);

  console.log('停止后的状态:', JSON.stringify(afterStop, null, 2));

  if (afterStop.hasModal) {
    console.log('3. 点击弹窗中的确认保存按钮...');
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
        return { clicked: false };
      })()
    `);
    console.log('确认保存结果:', confirmRes);
  }
}

main().catch(console.error);
