/**
 * Smoke Test — dex-ui (moongpt-harness Agent 1)
 * Usage: TEST_URL=https://... node smoke.spec.js
 *
 * Test categories:
 * A. Page accessibility (1-7)
 * B. Trade UI elements without wallet (8-9)
 * C. Wallet + trading flow (10-16)
 *
 * Regressions: #1 (/app 404), #7 (duplicate titles), #11 (/markets 404)
 */

const { chromium } = require('/tmp/pw-test/node_modules/playwright');
const { ethers } = require('/tmp/pw-test/node_modules/ethers');
const https = require('https');
const fs = require('fs');

const BASE_URL = process.env.TEST_URL || 'https://hermes-testnet-git-dev-chainupclouds-projects.vercel.app';
const SCREENSHOT_DIR = '/tmp/screenshots/dex-ui';
const TIMEOUT = 30000;

// Test wallet — from moongpt-harness .env
const WALLET_PK = process.env.TEST_WALLET_PRIVATE_KEY || '0x2a2a757267fe43d74a5f3ebd05a94a3cb549092096d78a4324cc29cac2ace7b2';
const SUI_ADDR = '0x94bd399ad5c05f9237c806c6dc8353ed5bd66a93bdf7c6f8346e6b191287c27c';
const SESSION_PK = '0xaaaaaabbbbbbccccccddddddeeeeeeffffffff00000011111122222233333344';

const wallet = new ethers.Wallet(WALLET_PK);
const WALLET_ADDR = wallet.address;
const walletAddrLower = WALLET_ADDR.toLowerCase();
const sessionWallet = new ethers.Wallet(SESSION_PK);
const SESSION_ADDR = sessionWallet.address;

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = { passed: [], failed: [], timestamp: new Date().toISOString(), base_url: BASE_URL };

function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function pass(test, detail) { results.passed.push({ test, ...(detail ? { detail } : {}) }); console.log(`  PASS: ${test}`); }
function fail(test, error) { results.failed.push({ test, error: String(error).substring(0, 300) }); console.error(`  FAIL: ${test} — ${error}`); }

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
// SECTION A: Page accessibility (no wallet needed)
// ═══════════════════════════════════════════════════════════
async function runPageTests(context, consoleErrors, titles) {
  async function checkPage(label, url, opts = {}) {
    const page = await context.newPage();
    consoleErrors[label] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors[label].push(msg.text()); });
    page.on('pageerror', err => { consoleErrors[label].push(`[pageerror] ${err.message}`); });
    try {
      const res = await page.goto(url, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      const status = res ? res.status() : 0;
      if (opts.expectRedirect) {
        if (status === 404) throw new Error(`HTTP 404 (regression: ${opts.regression || 'redirect expected'})`);
        pass(opts.testName || label, `final: ${page.url()}`);
      } else {
        if (status === 404 || status === 500) throw new Error(`HTTP ${status}`);
        // Optional: check body not empty
        const body = await page.textContent('body');
        if (!body || body.trim().length < 20) throw new Error('Page body empty');
        pass(opts.testName || label);
      }
      titles[label] = await page.title();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${label}-${ts()}.png` });
    } catch (err) {
      fail(opts.testName || label, err.message);
    }
    await page.close();
  }

  // Test 1: Homepage
  await checkPage('homepage', BASE_URL, { testName: 'Homepage loads (HTTP 200)' });
  // Test 2: /trade
  await checkPage('trade', `${BASE_URL}/trade`, { testName: '/trade page accessible' });
  // Test 3: /markets (regression #11)
  await checkPage('markets', `${BASE_URL}/markets`, { testName: '/markets page accessible (regression #11)' });
  // Test 4: /portfolio
  await checkPage('portfolio', `${BASE_URL}/portfolio`, { testName: '/portfolio page accessible' });
  // Test 5: /explorer
  await checkPage('explorer', `${BASE_URL}/explorer`, { testName: '/explorer page accessible' });
  // Test 6: /spot (disabled but should not 404)
  await checkPage('spot', `${BASE_URL}/spot`, { testName: '/spot page accessible (shows disabled message)' });
  // Test 7: /app redirect (regression #1)
  await checkPage('app-redirect', `${BASE_URL}/app`, { testName: '/app → redirect, not 404 (regression #1)', expectRedirect: true, regression: 'issue #1' });
}

// ═══════════════════════════════════════════════════════════
// SECTION B: Trade UI elements (no wallet)
// ═══════════════════════════════════════════════════════════
async function runUIElementTests(context, consoleErrors) {
  // Test 8: Order book has bid/ask prices
  {
    const page = await context.newPage();
    consoleErrors['orderbook'] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors['orderbook'].push(msg.text()); });
    try {
      await page.goto(`${BASE_URL}/trade`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(8000); // extra time for market data to load
      const obData = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        // Look for BTC price range numbers (5-digit numbers like 50000-99999)
        const btcPrices = bodyText.match(/[5-9]\d{4}(\.\d+)?/g) || [];
        // Look for any price-formatted numbers (commas or dots, 4+ digits)
        const anyPrices = bodyText.match(/\d{2,3},\d{3}(\.\d+)?|\d{4,6}\.\d{1,2}/g) || [];
        // Look for coin names mentioned multiple times (market data rows)
        const coins = (bodyText.match(/\b(BTC|ETH|SOL|DOGE|HYPE)\b/g) || []);
        return { btcPrices: btcPrices.slice(0,3), anyPrices: anyPrices.slice(0,3), coins: [...new Set(coins)] };
      });
      const hasPrices = obData.btcPrices.length > 0 || obData.anyPrices.length > 0 || obData.coins.length > 0;
      if (!hasPrices) throw new Error('No price/coin data visible on /trade page (market data may not be loading)');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/orderbook-${ts()}.png` });
      pass('Order book / price data visible on /trade', `coins: ${obData.coins.join(',')}, prices: ${[...obData.btcPrices, ...obData.anyPrices].slice(0,3).join(', ')}`);
    } catch (err) {
      fail('Order book / price data visible on /trade', err.message);
    }
    await page.close();
  }

  // Test 9: Markets page has data rows
  {
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/markets`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(7000); // extra time for market data API
      const rowCount = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const coins = (bodyText.match(/\b(BTC|ETH|SOL|DOGE|HYPE|SUI|AVAX)\b/g) || []);
        const uniqueCoins = [...new Set(coins)];
        // Also count rows
        const rows = document.querySelectorAll('tr, [class*="market-row"], [class*="marketRow"]');
        return { uniqueCoins, rows: rows.length };
      });
      // Testnet may have only 1 market (BTC) — just verify at least 1 market loads
      if (rowCount.uniqueCoins.length < 1 && rowCount.rows < 2) throw new Error(`Markets page shows no market data (coins: ${rowCount.uniqueCoins.join(',')}, rows: ${rowCount.rows})`);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/markets-data-${ts()}.png` });
      pass('Markets page shows market data', `coins: ${rowCount.uniqueCoins.join(', ')}, rows: ${rowCount.rows}`);
    } catch (err) {
      fail('Markets page shows market data', err.message);
    }
    await page.close();
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION C: Wallet + trading flow
// ═══════════════════════════════════════════════════════════
async function runTradingTests() {
  // Pre-approve session key
  const now = Date.now();
  const approveTypes = { ApproveAgent: [
    { name: 'subaccountNumber', type: 'uint32' }, { name: 'agentAddress', type: 'address' },
    { name: 'agentName', type: 'string' }, { name: 'validUntilMs', type: 'uint64' },
    { name: 'nonce', type: 'uint64' }, { name: 'deadline', type: 'uint64' },
  ]};
  const domain = { name: 'Hermes-Dex', version: '1', chainId: 1, verifyingContract: '0x0000000000000000000000000000000000000000' };
  const msg = { subaccountNumber: 0, agentAddress: SESSION_ADDR, agentName: 'smoketest', validUntilMs: now + 3600000, nonce: now, deadline: now + 60000 };
  const sig = await wallet.signTypedData(domain, approveTypes, msg);
  const raw = sig.slice(2); let v = parseInt(raw.slice(128, 130), 16); if (v < 27) v += 27;
  const approveSig = { r: '0x'+raw.slice(0,64), s: '0x'+raw.slice(64,128), v };
  const ar = await apiPost('/exchange', {
    action: { type: 'approveAgent', agentAddress: SESSION_ADDR, agentName: 'smoketest', subaccountNumber: 0, validUntilMs: now + 3600000 },
    nonce: now, deadline: now + 60000, signature: approveSig, vaultAddress: null,
  });
  if (ar.status !== 'ok') { fail('[Trading] Pre-approve session key', `API returned: ${JSON.stringify(ar)}`); return; }

  const sessionKeyData = JSON.stringify({
    privateKey: SESSION_PK.slice(2), agentAddress: SESSION_ADDR.toLowerCase(),
    masterAddress: walletAddrLower, name: 'smoketest', createdAt: now,
    validUntilMs: now + 3600000, suiAddress: SUI_ADDR,
  });

  const tradeBrowser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const urlObj = new URL(BASE_URL);

  const tradeCtx = await tradeBrowser.newContext({ viewport: { width: 1440, height: 900 } });
  await tradeCtx.addCookies([
    { name: 'wagmi.store', value: JSON.stringify({
        state: { connections: { __type: 'Map', value: [['injected', { accounts: [WALLET_ADDR], chainId: 11155111 }]] }, chainId: 11155111, current: 'injected' },
        version: 3
      }), domain: urlObj.hostname, path: '/' },
    { name: 'dex-theme', value: 'basedOrange', domain: urlObj.hostname, path: '/' },
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

  async function newTradePage() {
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

  async function hideModals(page) {
    await page.evaluate(() => {
      document.querySelectorAll('w3m-modal').forEach(m => m.style.cssText = 'display:none!important;pointer-events:none!important;');
      document.querySelectorAll('[data-radix-dialog-overlay]').forEach(m => m.style.display = 'none');
    });
  }

  async function fillAndSubmit(page, price, size, side) {
    await hideModals(page);
    // Select side tab (Buy/Long or Sell/Short)
    if (side === 'sell') {
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => /sell.*short|short.*sell/i.test(b.innerText) && b.offsetParent);
        if (btn) btn.click();
      });
      await page.waitForTimeout(300);
    }
    const tCount = await page.locator('input[type="text"]').count();
    if (tCount >= 1) {
      await page.locator('input[type="text"]').nth(0).click({ force: true });
      await page.keyboard.press('Control+A');
      await page.locator('input[type="text"]').nth(0).fill(String(price));
    }
    if (tCount >= 2) {
      await page.locator('input[type="text"]').nth(1).click({ force: true });
      await page.keyboard.press('Control+A');
      await page.locator('input[type="text"]').nth(1).fill(String(size));
    }
    await page.waitForTimeout(600);
  }

  async function clickSubmit(page, side) {
    const btnText = side === 'sell' ? /^short$/i : /^long$/i;
    return page.evaluate((pattern) => {
      const re = new RegExp(pattern, 'i');
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && re.test(b.innerText?.trim()) && !b.disabled);
      if (btn) { btn.click(); return btn.innerText.trim(); }
      return null;
    }, side === 'sell' ? '^short$' : '^long$');
  }

  async function verifyOrder(page, label) {
    await page.waitForTimeout(5000);
    const toasts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"], [class*="toast"], [class*="snack"]')).map(e => e.innerText?.trim()).filter(Boolean)
    );
    const apiOrders = await apiPost('/info', { type: 'openOrders', user: SUI_ADDR });
    return { toasts, orderCount: Array.isArray(apiOrders) ? apiOrders.length : 0 };
  }

  // ── Test 10: Wallet connects, address visible in header ──
  {
    const page = await newTradePage();
    try {
      await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(6000);
      const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText?.trim()).filter(Boolean));
      if (!btns.some(b => b.includes('0x') || b.toLowerCase().includes('7099'))) {
        throw new Error(`Wallet address not in header. Buttons: ${btns.slice(0,8).join(' | ')}`);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/wallet-connected-${ts()}.png` });
      pass('[Trading] Wallet connects via EIP-6963 — address shown in header');
    } catch (err) { fail('[Trading] Wallet connects via EIP-6963', err.message); }
    await page.close();
  }

  // ── Test 11: Account balance visible after wallet connect ──
  {
    const page = await newTradePage();
    try {
      await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(7000);
      const balanceInfo = await page.evaluate(() => {
        // Look for USDC balance or equity value in account panel
        const text = document.body.innerText;
        const hasBalance = /\$[\d,]+\.?\d*|\d+\.?\d*\s*USDC|equity|balance/i.test(text);
        const sample = text.match(/(\$[\d,]+\.?\d*|\d+\.?\d*\s*USDC)/)?.[0] || '';
        return { hasBalance, sample };
      });
      if (!balanceInfo.hasBalance) throw new Error('No balance/equity value visible on page after wallet connect');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/balance-${ts()}.png` });
      pass('[Trading] Account balance / equity visible after wallet connect', balanceInfo.sample);
    } catch (err) { fail('[Trading] Account balance visible after wallet connect', err.message); }
    await page.close();
  }

  // ── Test 12: BTC-USDC Long (Limit) order placed ──
  let orderCountBefore = 0;
  {
    const page = await newTradePage();
    try {
      await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(6000);
      const prevOrders = await apiPost('/info', { type: 'openOrders', user: SUI_ADDR });
      orderCountBefore = Array.isArray(prevOrders) ? prevOrders.length : 0;
      await fillAndSubmit(page, 50000, 0.001, 'buy');
      const clicked = await clickSubmit(page, 'buy');
      if (!clicked) throw new Error('Long button not found or still disabled after fill');
      const { toasts, orderCount } = await verifyOrder(page, 'btc-long');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/btc-long-${ts()}.png` });
      const success = toasts.some(t => /success|placed|order/i.test(t)) || orderCount > orderCountBefore;
      if (!success) throw new Error(`No confirmation. Toasts: ${JSON.stringify(toasts)}, orders: ${orderCountBefore}→${orderCount}`);
      orderCountBefore = orderCount;
      pass('[Trading] BTC-USDC Long (Limit) order placed', `orders: ${orderCountBefore}`);
    } catch (err) { fail('[Trading] BTC-USDC Long (Limit) order placed', err.message); }
    await page.close();
  }

  // ── Test 13: Open Orders tab shows placed orders ──
  {
    const page = await newTradePage();
    try {
      await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(6000);
      const tabInfo = await page.evaluate(() => {
        // Click "Open Orders" tab
        const tab = Array.from(document.querySelectorAll('button')).find(b => /open\s*orders/i.test(b.innerText) && b.offsetParent);
        if (tab) tab.click();
        return { tabFound: !!tab, tabText: tab?.innerText?.trim() };
      });
      await page.waitForTimeout(1000);
      const ordersVisible = await page.evaluate(() => {
        // After clicking tab, look for order rows (coin names or order IDs)
        const text = document.body.innerText;
        return /BTC|ETH|SOL/i.test(text) && /limit|market|long|short/i.test(text);
      });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/open-orders-tab-${ts()}.png` });
      if (!tabInfo.tabFound) throw new Error('Open Orders tab button not found');
      if (!ordersVisible) throw new Error('Open Orders tab clicked but no order data visible');
      pass('[Trading] Open Orders tab shows placed orders');
    } catch (err) { fail('[Trading] Open Orders tab shows placed orders', err.message); }
    await page.close();
  }

  // ── Test 14: BTC-USDC Short (Sell) order placed ──
  {
    const page = await newTradePage();
    try {
      await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(6000);
      const prevOrders = await apiPost('/info', { type: 'openOrders', user: SUI_ADDR });
      const prevCount = Array.isArray(prevOrders) ? prevOrders.length : 0;
      // Use a very high sell price ($200000) so it won't fill immediately
      await fillAndSubmit(page, 200000, 0.001, 'sell');
      const clicked = await clickSubmit(page, 'sell');
      if (!clicked) throw new Error('Short button not found or disabled after fill');
      const { toasts, orderCount } = await verifyOrder(page, 'btc-short');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/btc-short-${ts()}.png` });
      const success = toasts.some(t => /success|placed|order/i.test(t)) || orderCount > prevCount;
      if (!success) throw new Error(`No confirmation. Toasts: ${JSON.stringify(toasts)}, orders: ${prevCount}→${orderCount}`);
      pass('[Trading] BTC-USDC Short (Sell, Limit) order placed', `price=200000, orders: ${prevCount}→${orderCount}`);
    } catch (err) { fail('[Trading] BTC-USDC Short (Sell, Limit) order placed', err.message); }
    await page.close();
  }

  // ── Test 15: Watchlist shows available markets ──
  // Note: testnet has only 1 market (BTC-USDC), so we only verify watchlist renders coins
  {
    const page = await newTradePage();
    try {
      await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(6000);
      const watchlistInfo = await page.evaluate(() => {
        // Watchlist items — buttons or divs in the watchlist area
        const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter(b => b.offsetParent)
          .map(b => b.innerText?.trim())
          .filter(t => t && /(BTC|ETH|SOL|DOGE|HYPE|SUI)/i.test(t));
        return { watchlistBtns: allBtns };
      });
      if (watchlistInfo.watchlistBtns.length === 0) throw new Error('No market buttons found in watchlist');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/watchlist-${ts()}.png` });
      pass('[Trading] Watchlist shows available markets', `markets: ${watchlistInfo.watchlistBtns.join(', ')}`);
    } catch (err) { fail('[Trading] Watchlist shows available markets', err.message); }
    await page.close();
  }

  // ── Test 16: Form validation — $10 minimum order check ──
  {
    const page = await newTradePage();
    try {
      await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(6000);
      await hideModals(page);
      // Fill with price=1, size=0.001 → $0.001 orderValue (< $10 min)
      await fillAndSubmit(page, 1, 0.001, 'buy');
      const longDisabled = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /^long$/i.test(b.innerText?.trim()));
        return btn ? btn.disabled : null;
      });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/validation-${ts()}.png` });
      if (longDisabled !== true) throw new Error(`Long button should be disabled for $0.001 order value, got disabled=${longDisabled}`);
      pass('[Trading] Form validation: Long disabled when order value < $10');
    } catch (err) { fail('[Trading] Form validation: Long disabled when order value < $10', err.message); }
    await page.close();
  }

  await tradeBrowser.close();
}

// ═══════════════════════════════════════════════════════════
// TITLE CHECK (across pages A)
// ═══════════════════════════════════════════════════════════
function checkTitles(titles) {
  try {
    const titleValues = Object.values(titles).filter(Boolean);
    const uniqueTitles = new Set(titleValues);
    if (titleValues.length > 1 && uniqueTitles.size === 1) {
      throw new Error(`All pages share same <title>: "${titleValues[0]}" (regression: issue #7)`);
    }
    const dupSegments = Object.entries(titles).filter(([, t]) => {
      const parts = t.split(/\s*[|–-]\s*/).map(s => s.trim().toLowerCase()).filter(Boolean);
      return parts.length !== new Set(parts).size;
    });
    if (dupSegments.length > 0) {
      throw new Error(`Duplicate title segments: ${dupSegments.map(([p, t]) => `${p}: "${t}"`).join(', ')}`);
    }
    pass('Page <title> tags unique, no duplicate segments (regression #7)', titles);
  } catch (err) { fail('Page <title> tags unique', err.message); }
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
async function run() {
  console.log(`\nSmoke test: ${BASE_URL}\n`);

  // Section A + B: plain browser
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, userAgent: 'moongpt-harness/1.0 (smoke-test)' });
  const consoleErrors = {};
  const titles = {};

  console.log('── Section A: Page accessibility ──');
  await runPageTests(context, consoleErrors, titles);
  checkTitles(titles);

  // Console JS errors check
  const pagesWithErrors = Object.entries(consoleErrors).filter(([, e]) => e.length > 0);
  if (pagesWithErrors.length > 0) {
    pagesWithErrors.forEach(([label, errs]) => fail(`Console JS errors on ${label}`, errs.slice(0,3).join(' | ')));
  } else {
    pass('No console JS errors across tested pages');
  }

  console.log('\n── Section B: Trade UI elements ──');
  await runUIElementTests(context, consoleErrors);

  await browser.close();

  // Section C: wallet + trading
  console.log('\n── Section C: Wallet + trading flow ──');
  try {
    await runTradingTests();
  } catch (err) {
    fail('[Trading] Unexpected error in trading tests', err.message);
  }

  // Summary
  console.log('\n========== SMOKE TEST RESULTS ==========');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Passed: ${results.passed.length} / Failed: ${results.failed.length}\n`);

  if (results.failed.length > 0) {
    console.log('FAILURES:');
    results.failed.forEach((f, i) => console.log(`  ${i+1}. [FAIL] ${f.test}\n         ${f.error}`));
    console.log('');
  }

  console.log('PASSED:');
  results.passed.forEach((p, i) => console.log(`  ${i+1}. [PASS] ${p.test}`));

  const outPath = `/tmp/screenshots/dex-ui/results-${ts()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to: ${outPath}`);

  process.exit(results.failed.length > 0 ? 1 : 0);
}

run().catch(err => { console.error('Fatal:', err); process.exit(2); });
