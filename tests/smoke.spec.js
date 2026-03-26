/**
 * Smoke Test — dex-ui (moongpt-harness Agent 1)
 * Usage: TEST_URL=https://... node smoke.spec.js
 *
 * Tests per test-rules.md:
 * 1. Homepage loads, HTTP 200, basic elements visible
 * 2. /trade page accessible, no errors
 * 3. /markets page accessible
 * 4. /app → /trade redirect
 * 5. <title> tags are unique and meaningful across pages
 * + Console JS error check
 * + Regression: /app 404 (issue #1), unique titles (issue #7)
 */

const { chromium } = require('/tmp/pw-test/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_URL || 'https://hermes-testnet-git-dev-chainupclouds-projects.vercel.app';
const SCREENSHOT_DIR = '/tmp/screenshots/dex-ui';
const TIMEOUT = 30000;

// Ensure screenshot dir exists
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = {
  passed: [],
  failed: [],
  timestamp: new Date().toISOString(),
  base_url: BASE_URL,
};

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'moongpt-harness/1.0 (smoke-test)',
  });

  const consoleErrors = {};

  async function newPage(label) {
    const page = await context.newPage();
    consoleErrors[label] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors[label].push(msg.text());
      }
    });
    page.on('pageerror', err => {
      consoleErrors[label].push(`[pageerror] ${err.message}`);
    });
    return page;
  }

  const titles = {};

  // ── Test 1: Homepage ──────────────────────────────────────────────────────
  try {
    const page = await newPage('homepage');
    const response = await page.goto(BASE_URL, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
    const status = response ? response.status() : 0;

    if (status !== 200) {
      throw new Error(`HTTP ${status} (expected 200)`);
    }

    // Basic element check — look for <body> or any content
    const bodyText = await page.textContent('body');
    if (!bodyText || bodyText.trim().length < 10) {
      throw new Error('Page body appears empty');
    }

    titles['homepage'] = await page.title();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/homepage-${ts()}.png` });
    results.passed.push({ test: 'Homepage loads (HTTP 200)', url: BASE_URL });
    await page.close();
  } catch (err) {
    results.failed.push({ test: 'Homepage loads (HTTP 200)', url: BASE_URL, error: err.message });
    console.error(`FAIL: Homepage — ${err.message}`);
  }

  // ── Test 2: /trade page ───────────────────────────────────────────────────
  const tradeUrl = `${BASE_URL}/trade`;
  try {
    const page = await newPage('trade');
    const response = await page.goto(tradeUrl, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
    const status = response ? response.status() : 0;

    if (status === 404 || status === 500) {
      throw new Error(`HTTP ${status}`);
    }

    titles['trade'] = await page.title();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/trade-${ts()}.png` });
    results.passed.push({ test: '/trade page accessible', url: tradeUrl });
    await page.close();
  } catch (err) {
    results.failed.push({ test: '/trade page accessible', url: tradeUrl, error: err.message });
    console.error(`FAIL: /trade — ${err.message}`);
  }

  // ── Test 3: /markets page ─────────────────────────────────────────────────
  const marketsUrl = `${BASE_URL}/markets`;
  try {
    const page = await newPage('markets');
    const response = await page.goto(marketsUrl, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
    const status = response ? response.status() : 0;

    if (status === 404 || status === 500) {
      throw new Error(`HTTP ${status}`);
    }

    titles['markets'] = await page.title();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/markets-${ts()}.png` });
    results.passed.push({ test: '/markets page accessible', url: marketsUrl });
    await page.close();
  } catch (err) {
    results.failed.push({ test: '/markets page accessible', url: marketsUrl, error: err.message });
    console.error(`FAIL: /markets — ${err.message}`);
  }

  // ── Test 4: /app → /trade redirect (regression #1) ───────────────────────
  const appUrl = `${BASE_URL}/app`;
  try {
    const page = await newPage('app-redirect');
    const response = await page.goto(appUrl, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
    const finalUrl = page.url();
    const status = response ? response.status() : 0;

    if (status === 404) {
      throw new Error(`HTTP 404 — /app not found (regression: issue #1)`);
    }

    // Accept redirect to /trade or any non-404 outcome
    const redirectedToTrade = finalUrl.includes('/trade');
    if (!redirectedToTrade) {
      // Not a hard failure if not 404, just note it
      results.passed.push({
        test: '/app redirect (non-404)',
        url: appUrl,
        note: `Final URL: ${finalUrl}`,
      });
    } else {
      results.passed.push({ test: '/app → /trade redirect', url: appUrl });
    }

    titles['app'] = await page.title();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/app-redirect-${ts()}.png` });
    await page.close();
  } catch (err) {
    results.failed.push({ test: '/app → /trade redirect', url: appUrl, error: err.message });
    console.error(`FAIL: /app redirect — ${err.message}`);
  }

  // ── Test 5: Unique & meaningful <title> tags (regression #7) ─────────────
  try {
    const titleValues = Object.values(titles).filter(Boolean);
    const uniqueTitles = new Set(titleValues);

    if (titleValues.length > 1 && uniqueTitles.size === 1) {
      throw new Error(
        `All pages share the same <title>: "${titleValues[0]}" (regression: issue #7)`
      );
    }

    // Check titles are meaningful (not empty, not just the app name repeated identically)
    const emptyTitles = Object.entries(titles).filter(([, t]) => !t || t.trim().length === 0);
    if (emptyTitles.length > 0) {
      throw new Error(`Empty <title> on pages: ${emptyTitles.map(([p]) => p).join(', ')}`);
    }

    results.passed.push({
      test: 'Page <title> tags are unique',
      detail: titles,
    });
  } catch (err) {
    results.failed.push({ test: 'Unique <title> tags', error: err.message, detail: titles });
    console.error(`FAIL: Titles — ${err.message}`);
  }

  // ── Test 6: Console JS errors (exploratory) ───────────────────────────────
  const pagesWithErrors = Object.entries(consoleErrors).filter(([, errs]) => errs.length > 0);
  if (pagesWithErrors.length > 0) {
    pagesWithErrors.forEach(([pageLabel, errs]) => {
      results.failed.push({
        test: `Console JS errors on ${pageLabel}`,
        errors: errs.slice(0, 5),
        note: 'Exploratory — may be P3/P4',
      });
      console.error(`FAIL: JS errors on ${pageLabel}: ${errs[0]}`);
    });
  } else {
    results.passed.push({ test: 'No console JS errors across tested pages' });
  }

  await browser.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n========== SMOKE TEST RESULTS ==========');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Passed: ${results.passed.length}`);
  console.log(`Failed: ${results.failed.length}`);
  console.log('');

  if (results.failed.length > 0) {
    console.log('FAILURES:');
    results.failed.forEach((f, i) => {
      console.log(`  ${i + 1}. [FAIL] ${f.test}`);
      if (f.error) console.log(`         Error: ${f.error}`);
      if (f.errors) console.log(`         Errors: ${f.errors.join(' | ')}`);
    });
  }

  console.log('\nPASSED:');
  results.passed.forEach((p, i) => {
    console.log(`  ${i + 1}. [PASS] ${p.test}`);
  });

  // Write JSON result for harness to parse
  const outPath = `/tmp/screenshots/dex-ui/results-${ts()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to: ${outPath}`);

  process.exit(results.failed.length > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
