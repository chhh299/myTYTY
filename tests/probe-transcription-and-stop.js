/**
 * 深入探查 /doc/record 录音过程中的转写文本 DOM 与底部操作按钮
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
  if (!target) throw new Error('听悟页面不存在');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: expression,
          returnByValue: true
        }
      }));
    });

    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        ws.close();
        if (msg.result && msg.result.result) {
          resolve(msg.result.result.value);
        } else {
          resolve(msg);
        }
      }
    });

    ws.on('error', reject);
  });
}

async function main() {
  const data = await evalCdp(`
    (function() {
      // 1. 转写文本所在的容器
      const transNodes = [];
      const allDivs = Array.from(document.querySelectorAll('div, p, span'));
      for (const d of allDivs) {
        const t = (d.innerText || '').trim();
        if (t.includes('孤独') || t.includes('舒服') || t.includes('发生') || (t.length > 5 && d.parentElement && (d.parentElement.innerText||'').includes('正文'))) {
          if (d.children.length === 0 || Array.from(d.children).every(c => c.tagName === 'SPAN')) {
            transNodes.push({
              tag: d.tagName,
              cls: d.className,
              text: t,
              parentTag: d.parentElement ? d.parentElement.tagName : '',
              parentCls: d.parentElement ? d.parentElement.className : ''
            });
          }
        }
      }

      // 2. 探查底部栏里的全部可点击元素（暂停、停止/完成、取消等）
      // 查找包含 06:00:00 的容器
      const timerEl = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').includes('/06:00:00'));
      let container = timerEl;
      while (container && container.parentElement && container.parentElement !== document.body) {
        if (container.parentElement.tagName === 'BODY' || container.children.length > 3) {
          break;
        }
        container = container.parentElement;
      }

      // 收集 timer 附近的控制按钮
      const nearbyButtons = [];
      if (container) {
        Array.from(container.querySelectorAll('*')).forEach(el => {
          const cls = el.className || '';
          const tag = el.tagName;
          const cursor = window.getComputedStyle(el).cursor;
          if (cursor === 'pointer' || tag === 'BUTTON' || (typeof cls === 'string' && (cls.includes('btn') || cls.includes('icon')))) {
            nearbyButtons.push({
              tag: tag,
              cls: cls,
              txt: (el.innerText || '').trim(),
              title: el.getAttribute('title') || '',
              aria: el.getAttribute('aria-label') || ''
            });
          }
        });
      }

      return {
        timerText: timerEl ? timerEl.innerText : '',
        transNodes: transNodes.slice(0, 5),
        nearbyButtons: nearbyButtons.slice(0, 15)
      };
    })()
  `);

  console.log('【转写与控制分析】:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
