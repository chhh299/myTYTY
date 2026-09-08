/**
 * 通义听悟移动端真实网页注入适配脚本 (tingwu-mobile-adapt.js)
 * 解决用户触控抢夺问题 (P2-1)，并适配短信登录
 */

(() => {
  console.log('[mytyty] 听悟移动深度适配脚本注入成功');

  let hasAlignedScroll = false;

  // 1. 核心登录弹窗修复与短信登录单次安全居中 (不暴力抢夺用户焦点)
  function fixLoginModal() {
    const loginModals = document.querySelectorAll(
      '.aliyun-login-component-wrapper, .login-intercepts-modal-body, .ant-modal, [class*="login-container"], [class*="login-dialog"], [class*="login-modal"]'
    );

    loginModals.forEach(modal => {
      // 允许横向触摸滚动
      if (modal.scrollWidth > modal.clientWidth) {
        modal.style.overflowX = 'auto';
        modal.style.webkitOverflowScrolling = 'touch';
      }

      // 寻找短信/密码/验证码登录选项卡或切换按钮
      const tabs = modal.querySelectorAll('.ant-tabs-tab, [class*="tab"], a, button, span');
      tabs.forEach(tab => {
        const txt = (tab.innerText || '').trim();
        if (txt === '短信登录' || txt === '验证码登录' || txt === '账号密码登录' || txt.includes('短信验证码') || txt.includes('密码登录')) {
          if (!tab.classList.contains('ant-tabs-tab-active') && !tab.classList.contains('active')) {
            try {
              tab.click();
              console.log('[mytyty] 已自动点击切换至短信/密码登录选项卡:', txt);
            } catch (e) {}
          }
        }
      });

      // 仅在首次弹出时单次对齐，严禁高频循环强推 scrollLeft 抢夺用户触控
      if (!hasAlignedScroll && modal.scrollWidth > modal.clientWidth + 50) {
        modal.scrollLeft = modal.scrollWidth - modal.clientWidth;
        hasAlignedScroll = true;
      }
    });

    // 检查 iframe 形式的登录框
    const iframes = document.querySelectorAll('iframe[src*="login"], iframe[src*="passport"]');
    iframes.forEach(iframe => {
      try {
        iframe.style.maxWidth = '100vw';
        iframe.style.width = '100%';
      } catch (e) {}
    });
  }

  // 2. 自动消杀 PC 端新手引导与遮罩
  function dismissAnnoyingModals() {
    const closeBtns = document.querySelectorAll(
      '.ant-modal-close, button[aria-label="Close"], [class*="guide-close"], [class*="survey-close"], [class*="download-close"]'
    );
    closeBtns.forEach(btn => {
      const modal = btn.closest('.ant-modal, [class*="dialog"], [class*="guide"], [class*="mask"]');
      if (modal) {
        const txt = modal.innerText || '';
        if (txt.includes('新手引导') || txt.includes('问卷调研') || txt.includes('客户端') || txt.includes('推荐使用 Chrome')) {
          try {
            btn.click();
            console.log('[mytyty] 已自动关闭引导弹窗');
          } catch (e) {}
        }
      }
    });
  }

  // 3. 历史记录滚动
  window.__mytytyScrollToHistory = function() {
    const historySection = document.querySelector('[class*="history"], [class*="record-list"], [class*="doc-list"], .ant-table');
    if (historySection) {
      historySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    }
    window.scrollTo({ top: 600, behavior: 'smooth' });
    return false;
  };

  // 4. 防抖式监听 DOM 变化
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      fixLoginModal();
      dismissAnnoyingModals();
    }, 200);
  });

  function init() {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      fixLoginModal();
      dismissAnnoyingModals();
    } else {
      setTimeout(init, 100);
    }
  }

  init();
})();
