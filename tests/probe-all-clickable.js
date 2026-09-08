/**
 * 探查在录音中状态下的所有可交互按钮与 DOM 节点
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
  const result = await evalCdp(`
    (function() {
      // 遍历所有有 pointer cursor 的元素
      const all = Array.from(document.querySelectorAll('*'));
      const clickable = [];
      for (const el of all) {
        const style = window.getComputedStyle(el);
        if (style.cursor === 'pointer' && el.children.length <= 2) {
          clickable.push({
            tag: el.tagName,
            cls: el.className,
            text: (el.innerText || '').trim(),
            title: el.getAttribute('title') || '',
            aria: el.getAttribute('aria-label') || ''
          });
        }
      }
      return clickable;
    })()
  `);

  console.log('【录音中所有可点击元素】:');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
