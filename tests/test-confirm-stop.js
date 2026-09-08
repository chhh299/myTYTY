/**
 * 测试点击弹窗中的“确认结束”并验证结束完成状态
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

async function main() {
  console.log('测试在弹窗中点击【确认结束】...');
  const res = await evalCdp(`
    (function() {
      const allEls = Array.from(document.querySelectorAll('button, div, span, a'));
      for (const el of allEls) {
        const t = (el.innerText || '').trim();
        if (t === '确认结束') {
          el.click();
          return { clicked: true, tag: el.tagName, cls: el.className };
        }
      }
      return { clicked: false };
    })()
  `);
  console.log('点击确认结束结果:', res);

  await new Promise(r => setTimeout(r, 2500));

  const after = await evalCdp(`
    ({
      url: location.href,
      bodyText: document.body ? document.body.innerText.slice(0, 300) : ''
    })
  `);
  console.log('确认结束后的页面状态:', after);
}

main().catch(console.error);
