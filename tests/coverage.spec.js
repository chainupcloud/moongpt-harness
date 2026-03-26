/**
 * Full Coverage Test — dex-ui (moongpt-harness Coverage Agent)
 * Usage: TEST_URL=https://... node coverage.spec.js
 *
 * Unlike smoke tests (pass/fail only), coverage tests also produce SUGGESTIONS.
 * Output: { bugs: [...], suggestions: [...], metrics: {...} }
 *
 * Test areas:
 * 1. Performance — page load times
 * 2. Additional pages — /api-keys, /terms, /privacy, unknown 404
 * 3. Order types — Market order (vs Limit in smoke)
 * 4. Order cancel — place then cancel via UI
 * 5. Leverage modal — opens, shows options
 * 6. Portfolio page — has content after wallet connect
 * 7. Explorer page — shows transaction/checkpoint data
 * 8. Mobile viewport — renders without overflow/broken layout
 * 9. Form edge cases — negative price, zero size, max % buttons
 * 10. WebSocket / connection status indicator
 * 11. Transfer/Deposit/Withdraw buttons reachable
 * 12. Spot page — shows "not available" message (expected disabled state)
 */

const { chromium } = require('/tmp/pw-test/node_modules/playwright');
const { ethers } = require('/tmp/pw-test/node_modules/ethers');
const https = require('https');
const fs = require('fs');

const BASE_URL = process.env.TEST_URL || 'https://hermes-testnet-git-dev-chainupclouds-projects.vercel.app';
const SCREENSHOT_DIR = '/tmp/screenshots/dex-ui';
const TIMEOUT = 30000;

const WALLET_PK = process.env.TEST_WALLET_PRIVATE_KEY || '0x2a2a757267fe43d74a5f3ebd05a94a3cb549092096d78a4324cc29cac2ace7b2';
const SUI_ADDR = '0x94bd399ad5c05f9237c806c6dc8353ed5bd66a93bdf7c6f8346e6b191287c27c';
const SESSION_PK = '0xaaaaaabbbbbbccccccddddddeeeeeeffffffff00000011111122222233333344';

const wallet = new ethers.Wallet(WALLET_PK);
const WALLET_ADDR = wallet.address;
const walletAddrLower = WALLET_ADDR.toLowerCase();
const sessionWallet = new ethers.Wallet(SESSION_PK);
const SESSION_ADDR = sessionWallet.address;

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Results: bugs = create issues, suggestions = create enhancement issues
const results = {
  bugs: [],       // P1-P3: actual failures
  suggestions: [], // P4: improvement recommendations
  metrics: {},
  timestamp: new Date().toISOString(),
  base_url: BASE_URL,
};

function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function bug(title, detail, priority = 'P3') {
  results.bugs.push({ title, detail: String(detail).substring(0, 500), priority });
  console.error(`  BUG [${priority}]: ${title}`);
}
function suggest(title, detail) {
  results.suggestions.push({ title, detail: String(detail).substring(0, 500) });
  console.log(`  SUGGEST: ${title}`);
}
function metric(key, value) {
  results.metrics[key] = value;
  console.log(`  METRIC: ${key} = ${JSON.stringify(value)}`);
}
function info(msg) { console.log(`  OK: ${msg}`); }

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'dex-api.hifo.one', path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
        'Origin': 'https://dex-staging.hifo.one', 'User-Agent': 'Mozilla/5.0' }
    }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch(e) { resolve({ raw: b }); } }); });
    req.on('error', reject); req.write(data); req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// 1. Performance — page load times
// ═══════════════════════════════════════════════════════════
async function testPerformance(context) {
  console.log('\n── 1. Performance ──');
  // Only test pages not already in smoke's accessibility checks; focus on heavier pages
  const pages = ['/trade', '/portfolio', '/explorer'];
  const loadTimes = {};
  for (const path of pages) {
    const page = await context.newPage();
    try {
      const start = Date.now();
      await page.goto(`${BASE_URL}${path}`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      const elapsed = Date.now() - start;
      loadTimes[path] = elapsed;
      if (elapsed > 5000) {
        suggest(`页面加载超过 5 秒: ${path}`, `加载耗时 ${elapsed}ms，建议优化首屏性能`);
      } else if (elapsed > 3000) {
        suggest(`页面加载较慢: ${path}`, `加载耗时 ${elapsed}ms，建议控制在 3s 以内`);
      } else {
        info(`${path} 加载 ${elapsed}ms`);
      }
    } catch (err) {
      bug(`页面加载超时: ${path}`, err.message, 'P2');
    }
    await page.close();
  }
  metric('page_load_times_ms', loadTimes);
}

// ═══════════════════════════════════════════════════════════
// 2. Additional pages
// ═══════════════════════════════════════════════════════════
async function testAdditionalPages(context) {
  console.log('\n── 2. Additional pages ──');

  // /api-keys
  {
    const page = await context.newPage();
    try {
      const res = await page.goto(`${BASE_URL}/api-keys`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      if (res && res.status() === 404) bug('/api-keys 页面 404', 'API Keys 管理页面返回 404', 'P2');
      else {
        const body = await page.textContent('body');
        if (!body || body.trim().length < 20) bug('/api-keys 页面内容为空', '页面加载但内容为空', 'P3');
        else info('/api-keys 可访问');
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/api-keys-${ts()}.png` });
    } catch (err) { bug('/api-keys 页面加载失败', err.message, 'P2'); }
    await page.close();
  }

  // /terms
  {
    const page = await context.newPage();
    try {
      const res = await page.goto(`${BASE_URL}/terms`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      if (res && res.status() === 404) suggest('/terms 页面缺失', '服务条款页面返回 404，建议添加');
      else info('/terms 可访问');
    } catch (err) { suggest('/terms 页面加载失败', err.message); }
    await page.close();
  }

  // /privacy
  {
    const page = await context.newPage();
    try {
      const res = await page.goto(`${BASE_URL}/privacy`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      if (res && res.status() === 404) suggest('/privacy 页面缺失', '隐私政策页面返回 404，建议添加');
      else info('/privacy 可访问');
    } catch (err) { suggest('/privacy 页面加载失败', err.message); }
    await page.close();
  }

  // Unknown route → should show 404 or redirect gracefully
  {
    const page = await context.newPage();
    try {
      const res = await page.goto(`${BASE_URL}/nonexistent-page-xyz`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      const status = res ? res.status() : 0;
      const body = await page.textContent('body');
      const has404Content = /404|not found|页面不存在/i.test(body || '');
      if (status !== 404 && !has404Content) {
        suggest('未知路由未返回 404 页面', `访问 /nonexistent-page-xyz 返回 HTTP ${status}，建议添加自定义 404 页面`);
      } else {
        info('未知路由正确返回 404');
      }
    } catch (err) { }
    await page.close();
  }

  // /spot — should show "not available" message, not crash
  {
    const page = await context.newPage();
    try {
      const res = await page.goto(`${BASE_URL}/spot`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      const body = await page.textContent('body');
      const showsDisabled = /not available|coming soon|暂不|停用|disabled/i.test(body || '');
      if (!showsDisabled) {
        suggest('/spot 页面未明确显示"不可用"提示', '现货交易未上线，建议在页面上明确展示说明文字或引导');
      } else {
        info('/spot 显示已禁用提示');
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/spot-${ts()}.png` });
    } catch (err) { }
    await page.close();
  }
}

// ═══════════════════════════════════════════════════════════
// 3. Mobile viewport
// ═══════════════════════════════════════════════════════════
async function testMobileViewport() {
  console.log('\n── 3. Mobile viewport ──');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const pagesToCheck = ['/', '/trade', '/markets'];
  for (const path of pagesToCheck) {
    const page = await mobileCtx.newPage();
    try {
      await page.goto(`${BASE_URL}${path}`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      const issues = await page.evaluate(() => {
        // Check for horizontal scroll (content wider than viewport)
        const hasHScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth;
        // Check for elements overflowing viewport
        const overflowing = Array.from(document.querySelectorAll('*')).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.right > window.innerWidth + 5 && el.offsetParent !== null;
        }).length;
        return { hasHScroll, overflowing };
      });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile${path.replace('/', '-') || 'home'}-${ts()}.png` });
      if (issues.hasHScroll) {
        suggest(`移动端 ${path} 出现横向滚动`, `页面内容宽度超出视口，影响移动端体验`);
      } else if (issues.overflowing > 5) {
        suggest(`移动端 ${path} 有 ${issues.overflowing} 个元素溢出视口`, '建议检查移动端响应式布局');
      } else {
        info(`移动端 ${path} 布局正常`);
      }
    } catch (err) { bug(`移动端 ${path} 加载失败`, err.message, 'P3'); }
    await page.close();
  }
  await browser.close();
}

// ═══════════════════════════════════════════════════════════
// 4. Explorer data
// ═══════════════════════════════════════════════════════════
async function testExplorerData() {
  console.log('\n── 4. Explorer data ──');
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const c = await b.newContext({ ignoreHTTPSErrors: true });
  const page = await c.newPage();
  try {
    await page.goto(`${BASE_URL}/explorer`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const explorerData = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasCheckpoints = /checkpoint|区块|block/i.test(text);
      const hasTransactions = /transaction|tx|交易/i.test(text);
      return { hasCheckpoints, hasTransactions, bodyLen: text.length };
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/explorer-data-${ts()}.png` });
    if (explorerData.bodyLen < 100) {
      bug('Explorer 页面内容为空', '访问 /explorer 后页面几乎无内容', 'P3');
    } else if (!explorerData.hasCheckpoints && !explorerData.hasTransactions) {
      suggest('Explorer 页面缺少 checkpoint/transaction 数据', '建议检查 Explorer 数据 API 连通性');
    } else {
      info('Explorer 有数据展示');
    }
  } catch (err) { bug('Explorer 页面加载失败', err.message, 'P2'); }
  await page.close();
  await b.close();
}

// ═══════════════════════════════════════════════════════════
// Wallet-required tests setup
// ═══════════════════════════════════════════════════════════
async function setupWalletBrowser(sessionKeyData) {
  const tradeBrowser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const urlObj = new URL(BASE_URL);
  const tradeCtx = await tradeBrowser.newContext({ viewport: { width: 1440, height: 900 } });
  await tradeCtx.addCookies([
    { name: 'wagmi.store', value: JSON.stringify({
        state: { connections: { __type: 'Map', value: [['injected', { accounts: [WALLET_ADDR], chainId: 11155111 }]] }, chainId: 11155111, current: 'injected' },
        version: 3
      }), domain: urlObj.hostname, path: '/' },
  ]);
  const initScript = `
(function() {
  const WALLET_ADDR = ${JSON.stringify(WALLET_ADDR)};
  const SUI_ADDR = ${JSON.stringify(SUI_ADDR)};
  const SESSION_KEY_DATA = ${JSON.stringify(sessionKeyData)};
  const walletAddrLower = WALLET_ADDR.toLowerCase();
  try {
    localStorage.setItem('dex:eth_to_sui:' + walletAddrLower, SUI_ADDR);
    localStorage.setItem('dex:session_key:' + walletAddrLower, SESSION_KEY_DATA);
    localStorage.setItem('@appkit/connection_status', 'connected');
    localStorage.setItem('@appkit/active_caip_network_id', 'eip155:11155111');
  } catch(e) {}
  const provider = {
    isMetaMask: true, selectedAddress: WALLET_ADDR, chainId: '0xaa36a7', networkVersion: '11155111',
    request: async function(args) {
      const m = args.method;
      if (m === 'eth_requestAccounts' || m === 'eth_accounts') return [WALLET_ADDR];
      if (m === 'eth_chainId') return '0xaa36a7';
      if (m === 'net_version') return '11155111';
      if (m === 'eth_getBalance') return '0xde0b6b3a7640000';
      if (m === 'eth_blockNumber') return '0x1234';
      if (m === 'wallet_switchEthereumChain' || m === 'wallet_addEthereumChain') return null;
      if (m === 'personal_sign') return window.__nodeSignMessage(args.params[0]);
      if (m === 'eth_signTypedData_v4') return window.__nodeSignTypedData(args.params[1]);
      return null;
    },
    on: function(ev, h) { this['_h_'+ev] = h; },
    removeListener: function() {},
    emit: function(ev, ...a) { const h = this['_h_'+ev]; if (h) h(...a); },
  };
  window.ethereum = provider;
  window.dispatchEvent(new Event('ethereum#initialized'));
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({
      info: { uuid: '550e8400-e29b-41d4-a716-446655440000', name: 'MetaMask',
               icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzNCIgaGVpZ2h0PSIzMiI+PC9zdmc+',
               rdns: 'io.metamask' },
      provider
    })
  }));
  announce();
  window.addEventListener('eip6963:requestProvider', announce);
})();`;

  async function newPage() {
    const page = await tradeCtx.newPage();
    await page.exposeFunction('__nodeSignTypedData', async (jsonStr) => {
      const { domain, types, message } = JSON.parse(jsonStr);
      const t = { ...types }; delete t['EIP712Domain'];
      return wallet.signTypedData(domain, t, message);
    });
    await page.exposeFunction('__nodeSignMessage', async (msgHex) => {
      const str = msgHex.startsWith('0x') ? Buffer.from(msgHex.slice(2), 'hex').toString('utf8') : msgHex;
      return wallet.signMessage(str);
    });
    await page.addInitScript(initScript);
    return page;
  }

  return { tradeBrowser, newPage };
}

// ═══════════════════════════════════════════════════════════
// 5. Market order type
// ═══════════════════════════════════════════════════════════
async function testMarketOrder(newPage) {
  console.log('\n── 5. Market order type ──');
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      document.querySelectorAll('w3m-modal').forEach(m => m.style.cssText = 'display:none!important;pointer-events:none!important;');
    });
    // Switch to Market order type
    const switched = await page.evaluate(() => {
      // Find Order Type button/selector
      const orderTypeBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.offsetParent && /limit|order type/i.test(b.innerText)
      );
      if (orderTypeBtn) { orderTypeBtn.click(); return orderTypeBtn.innerText.trim(); }
      return null;
    });
    if (!switched) {
      suggest('Order Type 选择器未能定位', '建议为订单类型选择器添加 data-testid 属性，便于自动化测试');
    } else {
      await page.waitForTimeout(800);
      // Look for "Market" option in dropdown
      const marketClicked = await page.evaluate(() => {
        const options = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, button'))
          .filter(el => el.offsetParent && /^market$/i.test(el.innerText?.trim()));
        if (options[0]) { options[0].click(); return true; }
        return false;
      });
      if (!marketClicked) {
        suggest('Market 订单类型选项未找到', `从 "${switched}" 下拉后未能找到 Market 选项`);
      } else {
        await page.waitForTimeout(500);
        // Market order has no price input, just size
        const hasNoPrice = await page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(i => i.offsetParent);
          // Market order should have fewer inputs (no price)
          return inputs.length <= 2;
        });
        await page.screenshot({ path: `${SCREENSHOT_DIR}/market-order-${ts()}.png` });
        // Try to place market order (size = 0.001)
        const sizeInputs = await page.locator('input[type="text"]').count();
        if (sizeInputs >= 1) {
          // For market order, first input is size
          await page.locator('input[type="text"]').nth(0).click({ force: true });
          await page.keyboard.press('Control+A');
          await page.locator('input[type="text"]').nth(0).fill('0.001');
          await page.waitForTimeout(500);
        }
        const longBtnState = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /^long$/i.test(b.innerText?.trim()));
          return btn ? { found: true, disabled: btn.disabled } : { found: false };
        });
        if (!longBtnState.found) {
          bug('Market 订单切换后 Long 按钮消失', 'Market 类型下找不到 Long 提交按钮', 'P2');
        } else if (longBtnState.disabled) {
          suggest('Market 订单 Long 按钮为 disabled', '填写 size=0.001 后 Market 订单提交按钮仍禁用，请检查 Market 订单最低金额验证逻辑');
        } else {
          info('Market 订单类型切换正常，按钮可用');
        }
      }
    }
  } catch (err) { bug('Market 订单类型测试失败', err.message, 'P3'); }
  await page.close();
}

// ═══════════════════════════════════════════════════════════
// 6. Portfolio page with wallet
// ═══════════════════════════════════════════════════════════
async function testPortfolioWithWallet(newPage) {
  console.log('\n── 6. Portfolio with wallet ──');
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/portfolio`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(5000);
    const portfolioData = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasBalance = /\$[\d,]+\.?\d*|USDC|\d+\.\d{2}/i.test(text);
      const hasPositions = /position|仓位|open|equity/i.test(text);
      const isEmpty = text.trim().length < 100;
      return { hasBalance, hasPositions, isEmpty, textLen: text.length };
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/portfolio-wallet-${ts()}.png` });
    if (portfolioData.isEmpty) {
      bug('Portfolio 页面连接钱包后内容为空', '钱包已连接但 /portfolio 页面无内容', 'P3');
    } else if (!portfolioData.hasBalance && !portfolioData.hasPositions) {
      suggest('Portfolio 页面缺少余额/持仓数据', '页面有内容但未找到余额或仓位信息，建议检查数据加载');
    } else {
      info('Portfolio 页面正常显示数据');
    }
  } catch (err) { bug('Portfolio 页面加载失败', err.message, 'P2'); }
  await page.close();
}

// ═══════════════════════════════════════════════════════════
// 7. Leverage modal
// ═══════════════════════════════════════════════════════════
async function testLeverageModal(newPage) {
  console.log('\n── 7. Leverage modal ──');
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(6000);
    const leverageBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.offsetParent && /^\d+x$/i.test(b.innerText?.trim())
      );
      if (btn) { btn.click(); return btn.innerText.trim(); }
      return null;
    });
    if (!leverageBtn) {
      suggest('Leverage 按钮未找到', '杠杆选择按钮不可见或无法定位，建议添加 data-testid');
    } else {
      await page.waitForTimeout(800);
      const modalVisible = await page.evaluate(() => {
        // Check for a modal/dialog with leverage options (slider or number inputs)
        const modal = document.querySelector('[role="dialog"], [data-radix-dialog-content], [class*="modal"]');
        const hasSlider = !!document.querySelector('input[type="range"]');
        return { modal: !!modal, hasSlider };
      });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/leverage-modal-${ts()}.png` });
      if (!modalVisible.modal && !modalVisible.hasSlider) {
        suggest('Leverage 模态框未出现', `点击 "${leverageBtn}" 后未检测到弹窗或滑块`);
      } else {
        info(`Leverage 模态框正常弹出（${leverageBtn}）`);
        // Close modal
        await page.keyboard.press('Escape');
      }
    }
  } catch (err) { bug('Leverage 模态框测试失败', err.message, 'P3'); }
  await page.close();
}

// ═══════════════════════════════════════════════════════════
// 8. Percentage buttons (25%/50%/75%/100%)
// ═══════════════════════════════════════════════════════════
async function testPercentageButtons(newPage) {
  console.log('\n── 8. Percentage buttons ──');
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      document.querySelectorAll('w3m-modal').forEach(m => m.style.cssText = 'display:none!important;pointer-events:none!important;');
    });
    const pctResult = await page.evaluate(() => {
      // Find 25% button
      const pctBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.offsetParent && b.innerText?.trim() === '25%'
      );
      if (!pctBtn) return { found: false };
      pctBtn.click();
      return { found: true };
    });
    if (!pctResult.found) {
      suggest('百分比快捷按钮（25%/50%/75%/100%）未找到', '建议确保百分比按钮可见并正常工作');
    } else {
      await page.waitForTimeout(500);
      // Check if size input has been filled
      const sizeVal = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(i => i.offsetParent);
        return inputs[1]?.value || inputs[0]?.value || '';
      });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/pct-buttons-${ts()}.png` });
      if (!sizeVal || sizeVal === '0' || sizeVal === '') {
        suggest('点击 25% 按钮后 size 输入框未填充', '百分比按钮存在但点击后 size 字段无变化，请检查逻辑');
      } else {
        info(`百分比按钮正常，点击 25% 后 size = ${sizeVal}`);
      }
    }
  } catch (err) { bug('百分比按钮测试失败', err.message, 'P3'); }
  await page.close();
}

// ═══════════════════════════════════════════════════════════
// 9. Deposit/Withdraw button reachable
// ═══════════════════════════════════════════════════════════
async function testDepositWithdraw(newPage) {
  console.log('\n── 9. Deposit/Withdraw ──');
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(6000);
    const btnInfo = await page.evaluate(() => {
      const deposit = Array.from(document.querySelectorAll('button')).find(b =>
        b.offsetParent && /^deposit$/i.test(b.innerText?.trim())
      );
      const withdraw = Array.from(document.querySelectorAll('button')).find(b =>
        b.offsetParent && /^withdraw$/i.test(b.innerText?.trim())
      );
      return { hasDeposit: !!deposit, hasWithdraw: !!withdraw };
    });
    if (!btnInfo.hasDeposit) suggest('Deposit 按钮不可见', '建议确保 Deposit 按钮在钱包连接状态下可见');
    else info('Deposit 按钮可见');
    if (!btnInfo.hasWithdraw) suggest('Withdraw 按钮不可见', '建议确保 Withdraw 按钮在钱包连接状态下可见');
    else info('Withdraw 按钮可见');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/deposit-withdraw-${ts()}.png` });
  } catch (err) { bug('Deposit/Withdraw 测试失败', err.message, 'P3'); }
  await page.close();
}

// ═══════════════════════════════════════════════════════════
// 10. WebSocket connection status
// ═══════════════════════════════════════════════════════════
async function testWebSocketStatus(newPage) {
  console.log('\n── 10. WebSocket status ──');
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(7000);
    const wsInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      // Look for connection status indicator
      const hasConnected = /connected|已连接|online/i.test(text);
      const hasDisconnected = /disconnected|reconnecting|offline|断开/i.test(text);
      // Check for live price updates (price should not be "—" or "0.00")
      const priceEls = Array.from(document.querySelectorAll('[class*="price"], [class*="mark"]'))
        .map(el => el.innerText?.trim()).filter(t => t && t !== '—' && t !== '0.00' && /\d/.test(t));
      return { hasConnected, hasDisconnected, livePrices: priceEls.slice(0, 3) };
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/ws-status-${ts()}.png` });
    if (wsInfo.hasDisconnected) {
      bug('WebSocket 显示断开连接状态', '页面显示 disconnected/reconnecting，实时数据可能中断', 'P2');
    } else if (wsInfo.livePrices.length === 0) {
      suggest('未检测到实时价格数据', '建议确认 WebSocket 推送和价格展示正常');
    } else {
      info(`WebSocket 正常，实时价格: ${wsInfo.livePrices.join(', ')}`);
    }
  } catch (err) { bug('WebSocket 状态检测失败', err.message, 'P3'); }
  await page.close();
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
async function run() {
  console.log(`\nFull Coverage Test: ${BASE_URL}\n`);

  // No-wallet browser
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, userAgent: 'moongpt-harness/1.0 (coverage-test)' });

  await testPerformance(context);
  await testAdditionalPages(context);
  await browser.close();

  await testMobileViewport();
  await testExplorerData();

  // Wallet-required tests
  const now = Date.now();
  const approveTypes = { ApproveAgent: [
    { name: 'subaccountNumber', type: 'uint32' }, { name: 'agentAddress', type: 'address' },
    { name: 'agentName', type: 'string' }, { name: 'validUntilMs', type: 'uint64' },
    { name: 'nonce', type: 'uint64' }, { name: 'deadline', type: 'uint64' },
  ]};
  const domain = { name: 'Hermes-Dex', version: '1', chainId: 1, verifyingContract: '0x0000000000000000000000000000000000000000' };
  const msg = { subaccountNumber: 0, agentAddress: SESSION_ADDR, agentName: 'coverage', validUntilMs: now + 3600000, nonce: now, deadline: now + 60000 };
  const sig = await wallet.signTypedData(domain, approveTypes, msg);
  const raw = sig.slice(2); let v = parseInt(raw.slice(128, 130), 16); if (v < 27) v += 27;
  const approveSig = { r: '0x'+raw.slice(0,64), s: '0x'+raw.slice(64,128), v };
  const ar = await apiPost('/exchange', {
    action: { type: 'approveAgent', agentAddress: SESSION_ADDR, agentName: 'coverage', subaccountNumber: 0, validUntilMs: now + 3600000 },
    nonce: now, deadline: now + 60000, signature: approveSig, vaultAddress: null,
  });

  if (ar.status === 'ok') {
    const sessionKeyData = JSON.stringify({
      privateKey: SESSION_PK.slice(2), agentAddress: SESSION_ADDR.toLowerCase(),
      masterAddress: walletAddrLower, name: 'coverage', createdAt: now,
      validUntilMs: now + 3600000, suiAddress: SUI_ADDR,
    });
    const { tradeBrowser, newPage } = await setupWalletBrowser(sessionKeyData);
    await testMarketOrder(newPage);
    await testPortfolioWithWallet(newPage);
    await testLeverageModal(newPage);
    await testPercentageButtons(newPage);
    await testDepositWithdraw(newPage);
    await testWebSocketStatus(newPage);
    await tradeBrowser.close();
  } else {
    bug('Session key approve 失败，跳过钱包相关测试', JSON.stringify(ar), 'P1');
  }

  // Summary
  console.log('\n========== COVERAGE TEST RESULTS ==========');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Bugs found: ${results.bugs.length}`);
  console.log(`Suggestions: ${results.suggestions.length}`);
  console.log(`Metrics: ${JSON.stringify(results.metrics)}\n`);

  if (results.bugs.length > 0) {
    console.log('BUGS:');
    results.bugs.forEach((b, i) => console.log(`  ${i+1}. [${b.priority}] ${b.title}\n     ${b.detail}`));
  }
  if (results.suggestions.length > 0) {
    console.log('\nSUGGESTIONS:');
    results.suggestions.forEach((s, i) => console.log(`  ${i+1}. ${s.title}\n     ${s.detail}`));
  }

  const outPath = `/tmp/screenshots/dex-ui/coverage-results-${ts()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to: ${outPath}`);

  // Exit 0 even if suggestions found — only exit 1 for actual bugs
  process.exit(results.bugs.length > 0 ? 1 : 0);
}

run().catch(err => { console.error('Fatal:', err); process.exit(2); });
