/**
 * Advanced Test — dex-ui (moongpt-harness Advanced Agent)
 * Usage: TEST_URL=https://... node advanced.spec.js
 *
 * Tests areas NOT covered by smoke/coverage:
 * A. Cancel order via UI
 * B. TP/SL order placement
 * C. Leverage modal — change leverage value
 * D. Explorer page — search by address
 * E. Settings panel — tab navigation
 * F. Spot page — "Coming Soon" or disabled state
 * G. Portfolio — positions/history after wallet connect
 * H. Market order placement
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

const results = {
  bugs: [],
  suggestions: [],
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
function info(msg) { console.log(`  OK: ${msg}`); }

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'dex-api.hifo.one', path, method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
        'Origin': 'https://dex-staging.hifo.one', 'User-Agent': 'Mozilla/5.0'
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); } });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// WALLET SETUP (shared with smoke pattern)
// ═══════════════════════════════════════════════════════════
async function setupWallet() {
  const now = Date.now();
  const approveTypes = {
    ApproveAgent: [
      { name: 'subaccountNumber', type: 'uint32' }, { name: 'agentAddress', type: 'address' },
      { name: 'agentName', type: 'string' }, { name: 'validUntilMs', type: 'uint64' },
      { name: 'nonce', type: 'uint64' }, { name: 'deadline', type: 'uint64' },
    ]
  };
  const domain = { name: 'Hermes-Dex', version: '1', chainId: 1, verifyingContract: '0x0000000000000000000000000000000000000000' };
  const msg = { subaccountNumber: 0, agentAddress: SESSION_ADDR, agentName: 'advtest', validUntilMs: now + 3600000, nonce: now, deadline: now + 60000 };
  const sig = await wallet.signTypedData(domain, approveTypes, msg);
  const raw = sig.slice(2); let v = parseInt(raw.slice(128, 130), 16); if (v < 27) v += 27;
  const approveSig = { r: '0x' + raw.slice(0, 64), s: '0x' + raw.slice(64, 128), v };
  const ar = await apiPost('/exchange', {
    action: { type: 'approveAgent', agentAddress: SESSION_ADDR, agentName: 'advtest', subaccountNumber: 0, validUntilMs: now + 3600000 },
    nonce: now, deadline: now + 60000, signature: approveSig, vaultAddress: null,
  });
  if (ar.status !== 'ok') throw new Error(`Pre-approve session key failed: ${JSON.stringify(ar)}`);

  const sessionKeyData = JSON.stringify({
    privateKey: SESSION_PK.slice(2), agentAddress: SESSION_ADDR.toLowerCase(),
    masterAddress: walletAddrLower, name: 'advtest', createdAt: now,
    validUntilMs: now + 3600000, suiAddress: SUI_ADDR,
  });

  const urlObj = new URL(BASE_URL);

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

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([
    {
      name: 'wagmi.store', value: JSON.stringify({
        state: { connections: { __type: 'Map', value: [['injected', { accounts: [WALLET_ADDR], chainId: 11155111 }]] }, chainId: 11155111, current: 'injected' },
        version: 3
      }), domain: urlObj.hostname, path: '/'
    },
    { name: 'dex-theme', value: 'basedOrange', domain: urlObj.hostname, path: '/' },
  ]);

  async function newPage() {
    const page = await ctx.newPage();
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

  return { browser, newPage };
}

async function hideModals(page) {
  await page.evaluate(() => {
    document.querySelectorAll('w3m-modal').forEach(m => m.style.cssText = 'display:none!important;pointer-events:none!important;');
    document.querySelectorAll('[data-radix-dialog-overlay]').forEach(m => m.style.display = 'none');
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION A: Cancel order via UI
// ═══════════════════════════════════════════════════════════
async function runCancelOrderTest(newPage) {
  const page = await newPage();
  try {
    // Place a limit order far from market (price=50000, won't fill)
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(7000);
    await hideModals(page);

    // Check orders before
    const beforeOrders = await apiPost('/info', { type: 'openOrders', user: SUI_ADDR });
    const beforeCount = Array.isArray(beforeOrders) ? beforeOrders.length : 0;

    // Place a limit buy
    const inputs = await page.locator('input[type="text"]').all();
    if (inputs.length >= 2) {
      await inputs[0].fill('50000');
      await inputs[1].fill('0.001');
    }
    await page.waitForTimeout(500);
    const placed = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /^long$/i.test(b.innerText?.trim()) && !b.disabled);
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!placed) { bug('[Advanced] Cancel order: Long button not found', 'Could not place order to cancel'); await page.close(); return; }

    await page.waitForTimeout(5000);
    const afterOrders = await apiPost('/info', { type: 'openOrders', user: SUI_ADDR });
    const afterCount = Array.isArray(afterOrders) ? afterOrders.length : 0;
    if (afterCount <= beforeCount) {
      bug('[Advanced] Cancel order: order not placed', `Orders before: ${beforeCount}, after: ${afterCount}`);
      await page.close(); return;
    }

    // Click Open Orders tab
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('button')).find(b => /open\s*orders/i.test(b.innerText) && b.offsetParent);
      if (tab) tab.click();
    });
    await page.waitForTimeout(1500);

    // Find and click cancel button
    const cancelled = await page.evaluate(() => {
      // Cancel buttons can appear as X icons, "Cancel" text, or trash icons next to orders
      const cancelBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b =>
        b.offsetParent && (/^cancel$/i.test(b.innerText?.trim()) || /cancel.*order/i.test(b.title) || b.getAttribute('aria-label')?.match(/cancel/i))
      );
      if (cancelBtn) { cancelBtn.click(); return { found: true, text: cancelBtn.innerText?.trim() || cancelBtn.getAttribute('aria-label') }; }
      // Try clicking an X button in the orders row area
      const xBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.offsetParent && (b.innerText?.trim() === '×' || b.innerText?.trim() === 'X' || b.className?.includes('cancel'))
      );
      if (xBtn) { xBtn.click(); return { found: true, text: 'X/× button' }; }
      return { found: false };
    });

    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/cancel-order-${ts()}.png` });

    const finalOrders = await apiPost('/info', { type: 'openOrders', user: SUI_ADDR });
    const finalCount = Array.isArray(finalOrders) ? finalOrders.length : 0;

    if (!cancelled.found) {
      bug('[Advanced] Cancel order button not found in Open Orders tab', 'After placing order, could not find a cancel button in the UI');
    } else if (finalCount >= afterCount) {
      bug('[Advanced] Cancel order button clicked but order not cancelled', `Orders: placed=${afterCount}, after_cancel=${finalCount}, btn: ${cancelled.text}`);
    } else {
      info(`Cancel order: ${afterCount}→${finalCount} orders (cancelled ${afterCount - finalCount})`);
    }
  } catch (err) {
    bug('[Advanced] Cancel order test threw', err.message);
  }
  await page.close();
}

// ═══════════════════════════════════════════════════════════
// SECTION B: TP/SL order placement
// ═══════════════════════════════════════════════════════════
async function runTPSLTest(newPage) {
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(7000);
    await hideModals(page);

    // Look for TP/SL toggle, Stop, or order type selector
    const tpslToggle = await page.evaluate(() => {
      // Try to find TP/SL toggle button or "Stop" order type tab
      const btns = Array.from(document.querySelectorAll('button, [role="tab"]'));
      const tpsl = btns.find(b => /tp\s*\/?\s*sl|take\s*profit|stop\s*loss/i.test(b.innerText) && b.offsetParent);
      const stop = btns.find(b => /^stop$/i.test(b.innerText?.trim()) && b.offsetParent);
      if (tpsl) { tpsl.click(); return { found: true, text: tpsl.innerText?.trim() }; }
      if (stop) { stop.click(); return { found: true, text: stop.innerText?.trim() }; }
      return { found: false };
    });
    await page.waitForTimeout(1000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/tpsl-toggle-${ts()}.png` });

    if (!tpslToggle.found) {
      // Soft warning — TP/SL may be in a different UI location
      suggest('[Advanced] TP/SL toggle not found in trade form', 'TP/SL toggle button or Stop order type tab not visible in the main trade form area. May be hidden behind a panel or not implemented yet.');
      await page.close();
      return;
    }

    // After clicking TP/SL, look for trigger price or TP/SL price fields
    const hasTpSlFields = await page.evaluate(() => {
      const text = document.body.innerText;
      return /trigger|tp\s*price|sl\s*price|take.*profit|stop.*loss/i.test(text);
    });

    if (!hasTpSlFields) {
      bug('[Advanced] TP/SL toggle clicked but no TP/SL price fields appeared', `Toggle text: ${tpslToggle.text}`);
    } else {
      info(`TP/SL toggle works: "${tpslToggle.text}"`);
    }
  } catch (err) {
    bug('[Advanced] TP/SL test threw', err.message);
  }
  await page.close();
}

// ═══════════════════════════════════════════════════════════
// SECTION C: Leverage modal
// ═══════════════════════════════════════════════════════════
async function runLeverageTest(newPage) {
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(7000);
    await hideModals(page);

    // Click leverage button (shows current leverage like "10x", "20x")
    const leverageBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.offsetParent && /\d+x|leverage/i.test(b.innerText?.trim())
      );
      if (btn) { btn.click(); return { found: true, text: btn.innerText?.trim() }; }
      return { found: false };
    });
    await page.waitForTimeout(1500);

    if (!leverageBtn.found) {
      bug('[Advanced] Leverage button not found', 'No button with pattern "Nx" or "leverage" text found on /trade page');
      await page.close(); return;
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/leverage-modal-${ts()}.png` });

    // Verify modal opened
    const modalOpen = await page.evaluate(() => {
      const text = document.body.innerText;
      return /leverage|slider|\d+x/i.test(text) &&
        (document.querySelector('[data-state="open"], [role="dialog"], [class*="modal"]') !== null);
    });

    if (!modalOpen) {
      bug('[Advanced] Leverage button clicked but modal did not open', `Button text: ${leverageBtn.text}`);
      await page.close(); return;
    }

    // Try adjusting leverage via input or slider
    const adjusted = await page.evaluate(() => {
      // Try to find a number input in the modal
      const inputs = Array.from(document.querySelectorAll('input[type="number"], input[type="range"], input[type="text"]'))
        .filter(i => i.offsetParent);
      if (inputs.length > 0) {
        const inp = inputs[0];
        inp.value = '5';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return { adjusted: true, type: inp.type };
      }
      return { adjusted: false };
    });

    await page.waitForTimeout(500);

    // Try to confirm/submit
    const confirmed = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.offsetParent && /confirm|apply|set|save/i.test(b.innerText?.trim()) && !b.disabled
      );
      if (btn) { btn.click(); return { found: true, text: btn.innerText?.trim() }; }
      return { found: false };
    });

    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/leverage-confirm-${ts()}.png` });

    if (!confirmed.found) {
      suggest('[Advanced] Leverage modal: confirm button not found', `Modal opened (btn: ${leverageBtn.text}) but could not find confirm/apply button. Modal may have closed automatically or confirmation is done differently.`);
    } else {
      info(`Leverage modal: opened (${leverageBtn.text}), adjusted input (${adjusted.type || 'n/a'}), confirmed (${confirmed.text})`);
    }
  } catch (err) {
    bug('[Advanced] Leverage modal test threw', err.message);
  }
  await page.close();
}

// ═══════════════════════════════════════════════════════════
// SECTION D: Explorer page — search by address
// ═══════════════════════════════════════════════════════════
async function runExplorerSearchTest() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE_URL}/explorer`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(5000);

    // Find search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="address" i], input[placeholder*="tx" i]').first();
    const inputCount = await searchInput.count();

    if (inputCount === 0) {
      // Explorer may not have a search box — just check it renders data
      const hasData = await page.evaluate(() => {
        const text = document.body.innerText;
        return /transaction|block|address|checkpoint|\$[\d,]+/i.test(text);
      });
      if (!hasData) {
        bug('[Advanced] Explorer page shows no data and no search input', 'Explorer page loaded but neither search input nor transaction/block data was found');
      } else {
        suggest('[Advanced] Explorer has no search input', 'Explorer page shows data but lacks a search box for looking up addresses/transactions');
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/explorer-nosearch-${ts()}.png` });
      await browser.close();
      return;
    }

    // Type a test address and verify response
    await searchInput.fill(WALLET_ADDR);
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/explorer-search-${ts()}.png` });

    const searchResult = await page.evaluate((addr) => {
      const text = document.body.innerText;
      const addrShort = addr.slice(0, 8).toLowerCase();
      return {
        hasAddressMatch: text.toLowerCase().includes(addrShort),
        hasResults: /no.*result|not.*found|transaction|history|balance/i.test(text),
      };
    }, WALLET_ADDR);

    if (!searchResult.hasResults && !searchResult.hasAddressMatch) {
      bug('[Advanced] Explorer search returned no visible feedback', `Searched for ${WALLET_ADDR.slice(0, 10)}... but got no results or error message`);
    } else {
      info(`Explorer search: address lookup triggered, results visible`);
    }
  } catch (err) {
    bug('[Advanced] Explorer search test threw', err.message);
  }
  await page.close();
  await browser.close();
}

// ═══════════════════════════════════════════════════════════
// SECTION E: Settings panel — tab navigation
// ═══════════════════════════════════════════════════════════
async function runSettingsTest() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(6000);

    // Click the settings gear icon
    const settingsBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b =>
        b.offsetParent && (
          b.querySelector('svg[class*="settings"], svg[class*="gear"]') ||
          b.getAttribute('aria-label')?.match(/setting/i) ||
          b.className?.includes('settings') ||
          b.title?.match(/setting/i)
        )
      );
      if (btn) { btn.click(); return { found: true }; }
      // Also try Lucide Settings icon — looks for button containing only an SVG with no text
      const svgBtns = Array.from(document.querySelectorAll('button')).filter(b =>
        b.offsetParent && b.querySelector('svg') && !b.innerText?.trim()
      );
      // Find one that opens a modal (heuristic: near top right)
      const settingsSvg = svgBtns.find(b => {
        const rect = b.getBoundingClientRect();
        return rect.right > window.innerWidth * 0.7 && rect.top < 100;
      });
      if (settingsSvg) { settingsSvg.click(); return { found: true, heuristic: true }; }
      return { found: false };
    });
    await page.waitForTimeout(1500);

    if (!settingsBtn.found) {
      suggest('[Advanced] Settings button not found in top navigation', 'Could not locate a settings/gear icon button in the top nav bar');
      await page.close();
      await browser.close();
      return;
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/settings-open-${ts()}.png` });

    // Check modal opened
    const modalInfo = await page.evaluate(() => {
      const dialog = document.querySelector('[data-state="open"], [role="dialog"]');
      if (!dialog) return { open: false };
      const text = dialog.innerText;
      const tabs = Array.from(dialog.querySelectorAll('[role="tab"]')).map(t => t.innerText?.trim()).filter(Boolean);
      return { open: true, tabs, text: text.substring(0, 200) };
    });

    if (!modalInfo.open) {
      bug('[Advanced] Settings button found but modal did not open', 'Clicked settings button but no dialog appeared');
      await page.close();
      await browser.close();
      return;
    }

    if (modalInfo.tabs.length === 0) {
      suggest('[Advanced] Settings modal has no tabs', `Settings modal opened but no tab navigation found. Content preview: ${modalInfo.text.substring(0, 100)}`);
    } else {
      // Try clicking each tab
      let brokenTabs = [];
      for (const tabName of modalInfo.tabs.slice(0, 5)) {
        await page.evaluate((name) => {
          const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.innerText?.trim() === name);
          if (tab) tab.click();
        }, tabName);
        await page.waitForTimeout(500);
        const tabActive = await page.evaluate((name) => {
          const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.innerText?.trim() === name);
          return tab ? tab.getAttribute('data-state') === 'active' || tab.getAttribute('aria-selected') === 'true' : false;
        }, tabName);
        if (!tabActive) brokenTabs.push(tabName);
      }

      await page.screenshot({ path: `${SCREENSHOT_DIR}/settings-tabs-${ts()}.png` });

      if (brokenTabs.length > 0) {
        bug('[Advanced] Settings tabs not activating on click', `Tabs that didn't activate: ${brokenTabs.join(', ')}`);
      } else {
        info(`Settings modal: ${modalInfo.tabs.length} tabs all navigable (${modalInfo.tabs.join(', ')})`);
      }
    }
  } catch (err) {
    bug('[Advanced] Settings panel test threw', err.message);
  }
  await page.close();
  await browser.close();
}

// ═══════════════════════════════════════════════════════════
// SECTION F: Spot page — Coming Soon / disabled state
// ═══════════════════════════════════════════════════════════
async function runSpotPageTest() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE_URL}/spot`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/spot-page-${ts()}.png` });

    const spotState = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasComingSoon: /coming\s*soon|not.*available|disabled|暂未|即将/i.test(text),
        hasTradingUI: /order\s*book|trade.*form|buy.*sell|place.*order/i.test(text),
        bodyText: text.substring(0, 300),
      };
    });

    if (spotState.hasTradingUI && !spotState.hasComingSoon) {
      // Spot is live — just verify it works
      info('Spot page: trading UI visible (spot is live)');
    } else if (spotState.hasComingSoon) {
      info('Spot page: "Coming Soon" / disabled state displayed correctly');
    } else {
      bug('[Advanced] Spot page shows neither trading UI nor Coming Soon message',
        `Page body: ${spotState.bodyText.substring(0, 200)}`);
    }

    // Also verify navigation from homepage goes to /spot (not /trade?type=spot)
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(4000);
    // Hover over Trade dropdown
    const tradeLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button')).find(l =>
        /^trade$/i.test(l.innerText?.trim()) && l.offsetParent
      );
      if (links) {
        links.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        return { found: true, text: links.innerText?.trim() };
      }
      return { found: false };
    });
    await page.waitForTimeout(800);

    if (tradeLink.found) {
      // Check dropdown for Spot link
      const spotLink = await page.evaluate(() => {
        const link = Array.from(document.querySelectorAll('a')).find(a =>
          /spot/i.test(a.innerText?.trim()) && a.offsetParent
        );
        return link ? { found: true, href: link.href } : { found: false };
      });
      if (spotLink.found) {
        const url = new URL(spotLink.href);
        if (url.pathname === '/spot') {
          info(`Navigation: Spot link correctly points to /spot`);
        } else {
          bug('[Advanced] Navigation: Spot link in dropdown does not point to /spot',
            `Found href: ${spotLink.href} — expected /spot`);
        }
      }
    }
  } catch (err) {
    bug('[Advanced] Spot page test threw', err.message);
  }
  await page.close();
  await browser.close();
}

// ═══════════════════════════════════════════════════════════
// SECTION G: Portfolio — positions/history
// ═══════════════════════════════════════════════════════════
async function runPortfolioTest(newPage) {
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/portfolio`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(8000);
    await hideModals(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/portfolio-${ts()}.png` });

    const portInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasContent: /position|history|balance|equity|pnl|usdc/i.test(text),
        hasTabs: document.querySelectorAll('[role="tab"]').length > 0,
        tabs: Array.from(document.querySelectorAll('[role="tab"]')).map(t => t.innerText?.trim()).filter(Boolean),
        bodyText: text.substring(0, 400),
      };
    });

    if (!portInfo.hasContent) {
      bug('[Advanced] Portfolio page shows no content after wallet connect',
        `Portfolio page loaded but no positions/history/balance data found. Body: ${portInfo.bodyText.substring(0, 150)}`);
    } else {
      info(`Portfolio: content visible (tabs: ${portInfo.tabs.join(', ') || 'none found'})`);

      // If tabs exist, verify they're clickable
      if (portInfo.tabs.length > 1) {
        for (const tab of portInfo.tabs.slice(0, 3)) {
          await page.evaluate((name) => {
            const t = Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.innerText?.trim() === name);
            if (t) t.click();
          }, tab);
          await page.waitForTimeout(800);
        }
        await page.screenshot({ path: `${SCREENSHOT_DIR}/portfolio-tabs-${ts()}.png` });
        info(`Portfolio tabs navigated: ${portInfo.tabs.slice(0, 3).join(', ')}`);
      }
    }
  } catch (err) {
    bug('[Advanced] Portfolio test threw', err.message);
  }
  await page.close();
}

// ═══════════════════════════════════════════════════════════
// SECTION H: Market order (via order type selector)
// ═══════════════════════════════════════════════════════════
async function runMarketOrderTest(newPage) {
  const page = await newPage();
  try {
    await page.goto(`${BASE_URL}/trade`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(7000);
    await hideModals(page);

    // Switch to Market order type
    const switched = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button, [role="tab"]'));
      const marketTab = tabs.find(t => /^market$/i.test(t.innerText?.trim()) && t.offsetParent);
      if (marketTab) { marketTab.click(); return { found: true, text: marketTab.innerText?.trim() }; }
      return { found: false };
    });
    await page.waitForTimeout(1000);

    if (!switched.found) {
      suggest('[Advanced] Market order type tab not found', 'Could not find a "Market" tab/button in the trade form to switch order type');
      await page.close(); return;
    }

    // Fill size only (market orders have no price field)
    await hideModals(page);
    const inputs = await page.locator('input[type="text"]').all();
    // Market order should have fewer inputs (no price)
    for (const inp of inputs.slice(0, 2)) {
      const val = await inp.inputValue();
      if (!val) {
        await inp.fill('0.001');
        break;
      }
    }
    await page.waitForTimeout(500);

    const beforeOrders = await apiPost('/info', { type: 'openOrders', user: SUI_ADDR });
    const beforeCount = Array.isArray(beforeOrders) ? beforeOrders.length : 0;

    // Submit
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /^long$/i.test(b.innerText?.trim()) && !b.disabled);
      if (btn) btn.click();
    });
    await page.waitForTimeout(5000);

    const toasts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"], [class*="toast"], [class*="snack"]')).map(e => e.innerText?.trim()).filter(Boolean)
    );
    await page.screenshot({ path: `${SCREENSHOT_DIR}/market-order-${ts()}.png` });

    // Market orders fill immediately — check for toast confirmation
    const hasSuccess = toasts.some(t => /success|filled|order/i.test(t));
    if (!hasSuccess) {
      // Market order may have failed due to testnet liquidity — soft report
      suggest('[Advanced] Market order: no success toast', `Market order submitted but no success/filled toast found. Toasts: ${JSON.stringify(toasts)}. May be testnet liquidity issue.`);
    } else {
      info(`Market order: success toast received (${toasts[0]})`);
    }
  } catch (err) {
    bug('[Advanced] Market order test threw', err.message);
  }
  await page.close();
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
async function run() {
  console.log(`\nAdvanced test: ${BASE_URL}\n`);

  // Sections without wallet
  console.log('── Section D: Explorer search ──');
  await runExplorerSearchTest();

  console.log('── Section E: Settings panel ──');
  await runSettingsTest();

  console.log('── Section F: Spot page ──');
  await runSpotPageTest();

  // Sections with wallet
  let browser, newPage;
  try {
    ({ browser, newPage } = await setupWallet());
  } catch (err) {
    bug('[Advanced] Wallet setup failed', err.message, 'P2');
    saveResults();
    return;
  }

  console.log('── Section A: Cancel order ──');
  await runCancelOrderTest(newPage);

  console.log('── Section B: TP/SL order ──');
  await runTPSLTest(newPage);

  console.log('── Section C: Leverage modal ──');
  await runLeverageTest(newPage);

  console.log('── Section G: Portfolio ──');
  await runPortfolioTest(newPage);

  console.log('── Section H: Market order ──');
  await runMarketOrderTest(newPage);

  await browser.close();
  saveResults();
}

function saveResults() {
  const outFile = `${SCREENSHOT_DIR}/advanced-results-${ts()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\nResults saved: ${outFile}`);
  console.log(`Bugs: ${results.bugs.length}, Suggestions: ${results.suggestions.length}`);
  if (results.bugs.length > 0) {
    console.log('\nBugs found:');
    results.bugs.forEach(b => console.log(`  [${b.priority}] ${b.title}`));
  }
  if (results.suggestions.length > 0) {
    console.log('\nSuggestions:');
    results.suggestions.forEach(s => console.log(`  ${s.title}`));
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  bug('Advanced test fatal error', err.message, 'P2');
  saveResults();
  process.exit(1);
});
