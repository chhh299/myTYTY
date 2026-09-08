/**
 * 真实通义听悟浏览器端到端测试器 (run-real-browser-test.js)
 * 打开本地真实 Chromium 浏览器，加载真实 https://tingwu.aliyun.com/home
 * 注入与 Android App 100% 一模一样的伪装与脚本
 * 用户在此真实登录，控制台全程实时捕获真实 DOM 与状态流转
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9527;

// 1. 搭建本地轻量中转服务器，用于接收网页回传的真实调试数据
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/injector.js') {
    const code = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/tingwu-engine-injector.js'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(code);
    return;
  }

  if (req.url === '/report-real-dom' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('\n====================================================');
        console.log('       【捕获到通义听悟真实网页运行时数据】');
        console.log('====================================================');
        console.log('当前真实 URL:', data.url);
        console.log('当前引擎判定状态:', data.engineState);
        console.log('真实登录相关元素:', data.loginElements);
        console.log('真实用户区域信息:', data.userInfo);
        console.log('真实录音卡片与按钮:', data.recordCards);
        console.log('真实 Cookie 鉴权标识:', data.cookieKeys);
        console.log('====================================================\n');
      } catch (e) {}
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }

  if (req.url === '/bridge-event' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log(`[Bridge 真实事件] ${data.type} ->`, data.payload);
      } catch (e) {}
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[本地测试服务] 已在 http://127.0.0.1:${PORT} 启动`);
  launchRealBrowser();
});

// 2. 调起系统真实 Chromium 浏览器
function launchRealBrowser() {
  const browserPath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const userDataDir = path.join(__dirname, '../.tmp_browser_profile');

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // 带着完全一致的 PC 伪装 UA 与特性启动
  const args = [
    `--user-data-dir=${userDataDir}`,
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    '--no-first-run',
    '--no-default-browser-check',
    'https://tingwu.aliyun.com/home'
  ];

  console.log('[浏览器] 正在打开真实通义听悟页面，请在弹出的窗口中登录...');
  const child = spawn(browserPath, args, { detached: true, stdio: 'ignore' });
  child.unref();

  console.log('\n>>> 提示：窗口已弹出，请在浏览器中完成登录。');
  console.log('>>> 登录完成后，我们将在此实时检验听悟的真实 DOM 状态！\n');
}
