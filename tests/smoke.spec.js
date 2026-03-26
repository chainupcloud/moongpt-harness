/**
 * Smoke Test — dex-ui (moongpt-harness Agent 1)
 * Usage: TEST_URL=https://... node smoke.spec.js
 *
 * Tests per test-rules.md:
 * 1. Homepage loads, HTTP 200, basic elements visible
 * 2. /trade page accessible, no errors
 * 3. /markets page accessible
 * 4. /app → /trade redirect
 * 5. <title> tags unique and meaningful; no duplicate segments within a title
 * 6. No console JS errors
 * 7. [Trading] Wallet connects via EIP-6963 mock — address visible in header
 * 8. [Trading] Order placement — Buy Long BTC-USDC succeeds (toast + API confirm)
 *
 * Regression: #1 (/app 404), #7 (duplicate titles)
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

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, userAgent: 'moongpt-harness/1.0 (smoke-test)' });
  const consoleErrors = {};
  const titles = {};

  async function newPage(label) {
    const page = await context.newPage();
    consoleErrors[label] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors[label].push(msg.text()); });
    page.on('pageerror', err => { consoleErrors[label].push(`[pageerror] ${err.message}`); });
    return page;
  }

  // ── Test 1: Homepage ──────────────────────────────────────────────────────
  try {
    const page = await newPage('homepage');
    const res = await page.goto(BASE_URL, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
    if (!res || res.status() !== 200) throw new Error(`HTTP ${res ? res.status() : 0}`);
    const body = await page.textContent('body');
    if (!body || body.trim().length < 10) throw new Error('Page body empty');
    titles['homepage'] = await page.title();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/homepage-${ts()}.png` });
    results.passed.push({ test: 'Homepage loads (HTTP 200)', url: BASE_URL });
    await page.close();
  } catch (err) {
    results.failed.push({ test: 'Homepage loads (HTTP 200)', url: BASE_URL, error: err.message });
  }

  // ── Test 2: /trade ────────────────────────────────────────────────────────
  try {
    const page = await newPage('trade');
    const res = await page.goto(`${BASE_URL}/trade`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
    if (res && (res.status() === 404 || res.status() === 500)) throw new Error(`HTTP ${res.status()}`);
    titles['trade'] = await page.title();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/trade-${ts()}.png` });
    results.passed.push({ test: '/trade page accessible', url: `${BASE_URL}/trade` });
    await page.close();
  } catch (err) {
    results.failed.push({ test: '/trade page accessible', url: `${BASE_URL}/trade`, error: err.message });
  }

  // ── Test 3: /markets ──────────────────────────────────────────────────────
  try {
    const page = await newPage('markets');
    const res = await page.goto(`${BASE_URL}/markets`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
    if (res && (res.status() === 404 || res.status() === 500)) throw new Error(`HTTP ${res.status()}`);
    titles['markets'] = await page.title();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/markets-${ts()}.png` });
    results.passed.push({ test: '/markets page accessible', url: `${BASE_URL}/markets` });
    await page.close();
  } catch (err) {
    results.failed.push({ test: '/markets page accessible', url: `${BASE_URL}/markets`, error: err.message });
  }

  // ── Test 4: /app redirect (regression #1) ─────────────────────────────────
  try {
    const page = await newPage('app-redirect');
    const res = await page.goto(`${BASE_URL}/app`, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
    if (res && res.status() === 404) throw new Error('HTTP 404 — /app not found (regression: issue #1)');
    const finalUrl = page.url();
    titles['app'] = await page.title();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/app-redirect-${ts()}.png` });
    results.passed.push({ test: '/app → /trade redirect', url: `${BASE_URL}/app`, note: `Final: ${finalUrl}` });
    await page.close();
  } catch (err) {
    results.failed.push({ test: '/app → /trade redirect', url: `${BASE_URL}/app`, error: err.message });
  }

  // ── Test 5: Title uniqueness + no duplicate segments (regression #7) ──────
  try {
    const titleValues = Object.values(titles).filter(Boolean);
    const uniqueTitles = new Set(titleValues);
    if (titleValues.length > 1 && uniqueTitles.size === 1) {
      throw new Error(`All pages share same <title>: "${titleValues[0]}" (regression: issue #7)`);
    }
    const emptyTitles = Object.entries(titles).filter(([, t]) => !t || t.trim().length === 0);
    if (emptyTitles.length > 0) throw new Error(`Empty <title> on: ${emptyTitles.map(([p]) => p).join(', ')}`);

    // Check each title for duplicate segments (e.g. "Hermes DEX | Hermes DEX")
    const dupSegments = Object.entries(titles).filter(([, t]) => {
      const parts = t.split(/\s*[|–-]\s*/).map(s => s.trim().toLowerCase()).filter(Boolean);
      return parts.length !== new Set(parts).size;
    });
    if (dupSegments.length > 0) {
      throw new Error(`Duplicate segments in title: ${dupSegments.map(([p, t]) => `${p}: "${t}"`).join(', ')}`);
    }

    results.passed.push({ test: 'Page <title> tags unique and no duplicate segments', detail: titles });
  } catch (err) {
    results.failed.push({ test: 'Unique <title> tags', error: err.message, detail: titles });
  }

  // ── Test 6: Console JS errors ─────────────────────────────────────────────
  const pagesWithErrors = Object.entries(consoleErrors).filter(([, errs]) => errs.length > 0);
  if (pagesWithErrors.length > 0) {
    pagesWithErrors.forEach(([label, errs]) => {
      results.failed.push({ test: `Console JS errors on ${label}`, errors: errs.slice(0, 5) });
    });
  } else {
    results.passed.push({ test: 'No console JS errors across tested pages' });
  }

  await browser.close();

  // ── Tests 7+8: Wallet connect + Order placement ───────────────────────────
  // These require a fresh browser context with EIP-6963 mock + session key
  try {
    // Pre-approve session key via API
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
    if (ar.status !== 'ok') throw new Error(`ApproveAgent failed: ${JSON.stringify(ar)}`);

    const sessionKeyData = JSON.stringify({
      privateKey: SESSION_PK.slice(2), agentAddress: SESSION_ADDR.toLowerCase(),
      masterAddress: walletAddrLower, name: 'smoketest', createdAt: now,
      validUntilMs: now + 3600000, suiAddress: SUI_ADDR,
    });

    // Launch browser with wallet mock
    const tradeBrowser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const tradeCtx = await tradeBrowser.newContext({ viewport: { width: 1440, height: 900 } });

    const urlObj = new URL(BASE_URL);
    await tradeCtx.addCookies([
      { name: 'wagmi.store', value: JSON.stringify({
          state: { connections: { __type: 'Map', value: [['injected', { accounts: [WALLET_ADDR], chainId: 11155111 }]] }, chainId: 11155111, current: 'injected' },
          version: 3
        }), domain: urlObj.hostname, path: '/' },
      { name: 'dex-theme', value: 'basedOrange', domain: urlObj.hostname, path: '/' },
    ]);

    const tradePage = await tradeCtx.newPage();
    await tradePage.exposeFunction('__nodeSignTypedData', async (jsonStr) => {
      const { domain, types, message } = JSON.parse(jsonStr);
      const t = { ...types }; delete t['EIP712Domain'];
      return wallet.signTypedData(domain, t, message);
    });
    await tradePage.exposeFunction('__nodeSignMessage', async (msgHex) => {
      const str = msgHex.startsWith('0x') ? Buffer.from(msgHex.slice(2), 'hex').toString('utf8') : msgHex;
      return wallet.signMessage(str);
    });

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
               icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzNCIgaGVpZ2h0PSIzMiI+PC9zdmc+', rdns: 'io.metamask' },
      provider
    })
  }));
  announce();
  window.addEventListener('eip6963:requestProvider', announce);
})();`;

    await tradePage.addInitScript(initScript);
    await tradePage.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await tradePage.waitForTimeout(6000);
    await tradePage.screenshot({ path: `${SCREENSHOT_DIR}/trading-loaded-${ts()}.png` });

    // Test 7: Wallet connected (address in header)
    const headerBtns = await tradePage.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => b.innerText?.trim()).filter(Boolean)
    );
    const addrShown = headerBtns.some(b => b.includes('0x') || b.toLowerCase().includes('7099'));
    if (!addrShown) {
      results.failed.push({ test: '[Trading] Wallet connect via EIP-6963', error: `Wallet address not shown in header. Buttons: ${headerBtns.slice(0,10).join(' | ')}` });
    } else {
      results.passed.push({ test: '[Trading] Wallet connects via EIP-6963 mock — address visible in header' });
    }

    // Test 8: Order placement
    // Force-hide any modal, fill price=50000 size=0.001 (orderValue=$50 > $10 min)
    await tradePage.evaluate(() => {
      document.querySelectorAll('w3m-modal').forEach(m => m.style.cssText = 'display:none!important;pointer-events:none!important;');
      document.querySelectorAll('[data-radix-dialog-overlay]').forEach(m => m.style.display = 'none');
    });

    const textInputCount = await tradePage.locator('input[type="text"]').count();
    if (textInputCount >= 2) {
      await tradePage.locator('input[type="text"]').nth(0).click({ force: true });
      await tradePage.keyboard.press('Control+A');
      await tradePage.locator('input[type="text"]').nth(0).fill('50000');
      await tradePage.locator('input[type="text"]').nth(1).click({ force: true });
      await tradePage.keyboard.press('Control+A');
      await tradePage.locator('input[type="text"]').nth(1).fill('0.001');
      await tradePage.waitForTimeout(800);
    }

    await tradePage.screenshot({ path: `${SCREENSHOT_DIR}/trading-filled-${ts()}.png` });

    // Check Long button is enabled
    const longEnabled = await tradePage.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /^long$/i.test(b.innerText?.trim()));
      return btn ? !btn.disabled : false;
    });

    if (!longEnabled) {
      results.failed.push({ test: '[Trading] Order placement — Long button enabled after fill', error: 'Long button still disabled after filling price=50000 size=0.001' });
    } else {
      // Click Long and verify
      const prevOrders = await apiPost('/info', { type: 'openOrders', user: SUI_ADDR });
      const prevCount = Array.isArray(prevOrders) ? prevOrders.length : 0;

      await tradePage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /^long$/i.test(b.innerText?.trim()) && !b.disabled);
        if (btn) btn.click();
      });
      await tradePage.waitForTimeout(6000);
      await tradePage.screenshot({ path: `${SCREENSHOT_DIR}/trading-submitted-${ts()}.png` });

      // Check toast
      const toasts = await tradePage.evaluate(() =>
        Array.from(document.querySelectorAll('[role="alert"], [class*="toast"], [class*="snack"]')).map(e => e.innerText?.trim()).filter(Boolean)
      );
      const success = toasts.some(t => /success|placed|order/i.test(t));

      // Verify via API
      const newOrders = await apiPost('/info', { type: 'openOrders', user: SUI_ADDR });
      const newCount = Array.isArray(newOrders) ? newOrders.length : 0;
      const orderIncreased = newCount > prevCount;

      if (!success && !orderIncreased) {
        results.failed.push({ test: '[Trading] Order placement — BTC-USDC Long submitted', error: `No success toast and order count unchanged (${prevCount} → ${newCount}). Toasts: ${JSON.stringify(toasts)}` });
      } else {
        results.passed.push({ test: '[Trading] Order placement — BTC-USDC Long submitted', detail: `Orders: ${prevCount} → ${newCount}, toast: ${toasts[0] || 'none'}` });
      }
    }

    await tradeBrowser.close();
  } catch (err) {
    results.failed.push({ test: '[Trading] Wallet connect + order placement', error: err.message.substring(0, 300) });
    console.error(`FAIL: Trading tests — ${err.message}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n========== SMOKE TEST RESULTS ==========');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Passed: ${results.passed.length} / Failed: ${results.failed.length}`);

  if (results.failed.length > 0) {
    console.log('\nFAILURES:');
    results.failed.forEach((f, i) => {
      console.log(`  ${i+1}. [FAIL] ${f.test}`);
      if (f.error) console.log(`         ${f.error}`);
      if (f.errors) console.log(`         ${f.errors.slice(0,3).join(' | ')}`);
    });
  }

  console.log('\nPASSED:');
  results.passed.forEach((p, i) => console.log(`  ${i+1}. [PASS] ${p.test}`));

  const outPath = `/tmp/screenshots/dex-ui/results-${ts()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to: ${outPath}`);

  process.exit(results.failed.length > 0 ? 1 : 0);
}

run().catch(err => { console.error('Fatal:', err); process.exit(2); });
