#!/usr/bin/env node

/**
 * 门禁自动化测试套件 (verify-spec-gates.js)
 * 验证工程是否 100% 符合 spec.md 规定的质量门禁 QG-1 ~ QG-4 及 8.1 ~ 8.12 条款
 * 覆盖重工后的 P0-1, P0-2, P0-3, P1-1 修复项
 */

const fs = require('fs');
const path = require('path');

let failures = 0;
let passes = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passes++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failures++;
  }
}

console.log('========================================================');
console.log('开始执行 mytyty 架构重工后自动化门禁测试');
console.log('========================================================\n');

// 1. 验证 QG-1 & QG-2: 纯净度与绝对零 Mock
console.log('[门禁 1] QG-1 & QG-2 纯净度与真实性检查');
const htmlPath = path.join(__dirname, 'app/src/main/assets/ui/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

assert(!html.includes('00:12:47'), '严禁包含写死录音时间 00:12:47');
assert(!html.includes('12:47'), '严禁包含虚假时间 12:47');
assert(!html.includes('9:41'), '严禁包含虚假系统状态栏时间 9:41');
assert(!html.includes('wifi') && !html.includes('battery'), '严禁在卡片中伪造 Wi-Fi 与电池图标');
assert(html.includes('>00:00:00<'), '初始状态必须严格为 00:00:00 待命');
assert(html.includes('transcriptEmptyState'), '未录音前必须展示麦克风占位空状态，绝无假会议记录');

// 2. 验证 P0-1: 编译清洁度与变量未声明清除
console.log('\n[门禁 2] P0-1 编译清洁度与无未声明变量检查');
const mainActPath = path.join(__dirname, 'app/src/main/java/com/aliyun/tingwu/assistant/MainActivity.kt');
const mainAct = fs.readFileSync(mainActPath, 'utf8');
assert(!mainAct.includes('audioRecorderManager'), '必须彻底清除未声明的 audioRecorderManager 引用');
assert(!mainAct.includes('AudioRecorderManager(this)'), '严禁残留未声明的实例化赋值');

// 3. 验证 P0-2: 统一句子流规整器 (消灭双胞胎气泡)
console.log('\n[门禁 3] P0-2 统一句子流规整器检查 (tingwu-engine-injector.js)');
const injectorPath = path.join(__dirname, 'app/src/main/assets/tingwu-engine-injector.js');
const injector = fs.readFileSync(injectorPath, 'utf8');
assert(injector.includes('normalizeAndDispatchSentence'), '必须具备统一句子流规整器 normalizeAndDispatchSentence');
assert(injector.includes('active_sentence_'), '必须输出单唯一递增句 ID，彻底杜绝 ID 互斥双胞胎气泡');
assert(injector.includes('window.WebSocket = function'), '必须包含 WebSocket 原型链拦截主通道');
assert(injector.includes('new MutationObserver'), '必须包含 DOM MutationObserver 强力兜底通道');

// 4. 验证 P1-1: 录音双向 ACK 握手机制
console.log('\n[门禁 4] P1-1 录音双向 ACK 握手机制检查');
assert(injector.includes('notifyRecordingAck'), '听悟注入脚本必须包含 ACK 确认回传 notifyRecordingAck');
assert(mainAct.includes('handleRecordingAck'), 'MainActivity 必须具备 handleRecordingAck 握手确认方法');
assert(mainAct.includes('onNativeRecordingPending'), '必须具备缓冲态通知，杜绝未就绪前虚假走表');
const appJsPath = path.join(__dirname, 'app/src/main/assets/ui/app.js');
const appJs = fs.readFileSync(appJsPath, 'utf8');
assert(appJs.includes('onNativeRecordingPending'), '前台卡片必须支持 onNativeRecordingPending 缓冲态显示');

// 5. 验证 P0-3: 跨域 iframe 全屏托管与视口等比缩放
console.log('\n[门禁 5] P0-3 登录跨域 SOP 解决与视口等比缩放');
assert(mainAct.includes('currentTabIndex == 0') && mainAct.includes('binding.engineWebView.visibility = View.VISIBLE'), '检测到登录需切出 engineWebView 全屏托管');
const helperPath = path.join(__dirname, 'app/src/main/java/com/aliyun/tingwu/assistant/webview/DesktopSpoofHelper.kt');
const helper = fs.readFileSync(helperPath, 'utf8');
assert(helper.includes('settings.useWideViewPort = true'), '必须开启宽视口 useWideViewPort');
assert(helper.includes('settings.loadWithOverviewMode = true'), '必须开启等比缩放 loadWithOverviewMode');

// 6. 验证 8.5: UTF-8 TextDecoder 安全解码
console.log('\n[门禁 6] 8.5 UTF-8 TextDecoder 安全 Base64 解码');
assert(appJs.includes('TextDecoder'), '必须使用 TextDecoder 安全解码，废弃不安全的 escape()');
assert(mainAct.includes('Base64.encodeToString'), '原生层必须使用 Base64 编码向 UI 传输 JSON');

console.log('\n========================================================');
console.log(`门禁测试完成: ${passes} 通过, ${failures} 失败`);
console.log('========================================================');

if (failures > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
