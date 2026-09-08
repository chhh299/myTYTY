/**
 * 完整模拟从 /home 点击“开启实时记录”进入 /doc/record 并启动录音、抓取转写文本的全流程
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

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('1. 检查当前页面 URL');
  const urlRes = await evalCdp('location.href');
  console.log('当前 URL:', urlRes);

  if (urlRes.includes('/home')) {
    console.log('2. 当前在 /home，点击“开启实时记录”...');
    const clickHome = await evalCdp(`
      (function() {
        const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开启实时记录');
        if (!btn) return '没找到开启实时记录';
        btn.click();
        return '已点击';
      })()
    `);
    console.log('点击结果:', clickHome);
    console.log('等待跳转至 /doc/record ...');
    await sleep(2500);
  }

  const currentUrl = await evalCdp('location.href');
  console.log('3. 跳转后 URL:', currentUrl);

  console.log('4. 检查是否出现“开始录音”按钮并点击...');
  const clickRecord = await evalCdp(`
    (function() {
      const btn = Array.from(document.querySelectorAll('*')).find(e => (e.innerText || '').trim() === '开始录音');
      if (!btn) return { found: false, body: document.body.innerText.slice(0, 200) };

      // 派发点击
      btn.click();
      return { found: true, tag: btn.tagName, cls: btn.className };
    })()
  `);
  console.log('点击开始录音结果:', clickRecord);

  console.log('5. 等待 2 秒检查录音状态与界面元素...');
  await sleep(2000);

  const status = await evalCdp(`
    (function() {
      const text = document.body ? document.body.innerText : '';
      const isRecording = text.includes('录音中…') || text.includes('/06:00:00');

      // 寻找转写文本段落
      const paragraphs = Array.from(document.querySelectorAll('p, [class*="paragraph"], [class*="sentence"], [class*="content"]'))
        .map(e => (e.innerText || '').trim())
        .filter(t => t.length > 0 && !t.includes('通义听悟') && !t.includes('保存') && !t.includes('双语显示'));

      // 寻找结束录音按钮
      const stopBtn = Array.from(document.querySelectorAll('*')).find(e => {
        const t = (e.innerText || '').trim();
        const title = e.getAttribute('title') || '';
        return t === '结束' || t === '停止' || t === '结束录音' || title.includes('结束') || title.includes('停止');
      });

      return {
        isRecording: isRecording,
        timerMatch: (text.match(/\\d{2}:\\d{2}\\/06:00:00/) || [])[0] || '无',
        paragraphs: paragraphs.slice(0, 5),
        hasStopBtn: !!stopBtn,
        stopBtnTag: stopBtn ? stopBtn.tagName : '',
        stopBtnCls: stopBtn ? stopBtn.className : ''
      };
    })()
  `);

  console.log('录音运行状态:', JSON.stringify(status, null, 2));
}

main().catch(console.error);
