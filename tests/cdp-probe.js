/**
 * 基于标准 ws 模块的精准 CDP 探针 (cdp-probe.js)
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
  console.log('--- 正在通过标准 WebSocket 探测听悟当前真实录音界面 ---');

  const info = await evalCdp(`
    (function() {
      const elements = Array.from(document.querySelectorAll('*'));
      const buttons = [];
      const controls = [];

      for (const el of elements) {
        const txt = (el.innerText || '').trim();
        const title = el.getAttribute('title') || '';
        const aria = el.getAttribute('aria-label') || '';
        const cls = el.className || '';

        // 收集所有带文字短于 15 字符的元素
        if (txt && txt.length < 15 && el.children.length === 0) {
          if (['已保存', '保存', '双语显示', '纯译文显示', '录音中…', '正文', '完成', '暂停', '停止', '结束', '取消'].includes(txt)) {
            controls.push({
              txt: txt,
              tag: el.tagName,
              cls: cls,
              cursor: window.getComputedStyle(el).cursor
            });
          }
        }

        // 寻找控制栏里的图标/按钮 (没有文字的 SVG 或按钮)
        if (el.tagName === 'BUTTON' || (cls && typeof cls === 'string' && (cls.includes('btn') || cls.includes('icon') || cls.includes('Record')))) {
          buttons.push({
            tag: el.tagName,
            cls: cls,
            title: title,
            aria: aria,
            txt: txt.slice(0, 20)
          });
        }
      }

      // 寻找底部录音条里的所有按钮
      const bottomBar = document.querySelector('[class*="recordBottom"], [class*="bottom"], [class*="RecordBar"], [class*="footer"], .footer');
      const bottomBarInfo = bottomBar ? {
        cls: bottomBar.className,
        text: bottomBar.innerText,
        buttons: Array.from(bottomBar.querySelectorAll('button, div[role="button"], svg')).map(b => ({
          tag: b.tagName,
          cls: b.className,
          title: b.getAttribute('title') || b.parentElement.getAttribute('title') || ''
        }))
      } : null;

      return {
        url: location.href,
        controls: controls,
        buttons: buttons.slice(0, 10),
        bottomBar: bottomBarInfo,
        bodyPreview: document.body.innerText.slice(0, 250)
      };
    })()
  `);

  console.log('【录音状态与元素探查结果】:');
  console.log(JSON.stringify(info, null, 2));
}

main().catch(console.error);
