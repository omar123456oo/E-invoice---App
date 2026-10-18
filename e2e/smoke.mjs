// End-to-end smoke test driving Chrome through the DevTools Protocol (no extra dependencies).
// Requires the API (npm run dev:memory -w apps/api) and the web app (npm start -w apps/web) to be running.
//   BASE_URL=http://localhost:4200 CHROME_BIN=google-chrome SHOTS_DIR=e2e/shots node e2e/smoke.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:4200';
const CHROME = process.env.CHROME_BIN ?? 'google-chrome';
const SHOTS = process.env.SHOTS_DIR ?? '';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ChangeMe-Dev-Only-123';
const PORT = 9300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'e2e-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(work, 'profile')}`, '--window-size=1440,960', '--no-first-run', '--no-sandbox', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let ws;
let seq = 0;
const pending = new Map();
const consoleErrors = [];
const steps = [];

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r));
        ws.addEventListener('message', (e) => {
          const m = JSON.parse(e.data);
          if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
          }
          if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
          if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
        });
        return;
      }
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome is not reachable');
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++seq;
  pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}
async function waitFor(expr, timeout = 10000) {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    if (await evaluate(`!!(${expr})`)) return;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${expr}`);
}
async function shot(name) {
  if (!SHOTS) return;
  await sleep(250);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}
async function go(path) {
  await send('Page.navigate', { url: BASE + path });
  await sleep(700);
}
const q = (sel) => JSON.stringify(sel);
const fill = (sel, value) => evaluate(`(() => { const el = document.querySelector(${q(sel)}); if (!el) throw new Error('missing ' + ${q(sel)}); el.focus(); el.value = ${q(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const click = (sel) => evaluate(`(() => { const el = document.querySelector(${q(sel)}); if (!el) throw new Error('missing ' + ${q(sel)}); el.click(); return true; })()`);
const clickText = (text) => evaluate(`(() => { const el = [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim().includes(${q(text)})); if (!el) throw new Error('missing button ' + ${q(text)}); el.click(); return true; })()`);
const hasText = (text) => evaluate(`document.body.innerText.includes(${q(text)})`);

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    steps.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    steps.push({ name, ok: false, error: err.message });
    console.log(`  ✗ ${name}: ${err.message}`);
    await shot(`failed-${steps.length}`).catch(() => {});
    throw err;
  }
}

async function login(email) {
  await send('Network.clearBrowserCookies');
  await go('/login');
  await waitFor(`document.querySelector('input[type=email]')`);
  await fill('input[type=email]', email);
  await fill('input[type=password]', PASSWORD);
  await click('button[type=submit]');
  await waitFor(`!location.pathname.startsWith('/login')`);
  await sleep(800);
}

try {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  console.log('E2E smoke test');

  await step('signed-out visitor is sent to the login page', async () => {
    await go('/');
    await waitFor(`location.pathname === '/login' && document.querySelector('input[type=email]')`);
    await shot('01-login');
  });

  await step('cashier completes a cash sale and prints an internal receipt', async () => {
    await login('cashier@demo.local');
    await waitFor(`location.pathname === '/pos'`);
    await waitFor(`document.querySelector('.catalog input') || [...document.querySelectorAll('button')].some((b) => b.textContent.includes('فتح وردية'))`);
    if (!(await evaluate(`!!document.querySelector('.catalog input')`))) {
      await clickText('فتح وردية');
      await waitFor(`document.querySelector('.catalog input')`);
    }
    for (const term of ['مياه', 'قهوة']) {
      await fill('.catalog input', term);
      await waitFor(`document.querySelector('.result')`);
      await click('.result');
    }
    await waitFor(`document.querySelector('.sums .grand')`);
    await fill('.tender input', '500');
    await click('button.pay');
    await waitFor(`document.querySelector('app-receipt-print')`);
    if (!(await hasText('غير مسجل لدى مصلحة الضرائب'))) throw new Error('internal receipt notice missing');
    await shot('02-sale');
  });

  await step('owner sees the dashboard and receipts', async () => {
    await login('owner@demo.local');
    await waitFor(`document.querySelector('.headline')`);
    await go('/receipts');
    await waitFor(`document.querySelector('table.data tbody tr')`);
    await click('table.data tbody tr');
    await waitFor(`document.querySelector('.status app-eta-stamp')`);
    await shot('03-receipt');
  });

  await step('owner creates a customer', async () => {
    await go('/customers');
    await waitFor(`document.querySelector('header button')`);
    await click('header button');
    await waitFor(`document.querySelector('input[name=n]')`);
    await fill('input[name=n]', 'عميل تجريبي');
    await fill('input[name=m]', '01000000000');
    await evaluate(`document.querySelector('input[name=n]').closest('form').querySelector('button[type=submit]').click()`);
    await waitFor(`document.body.innerText.includes('عميل تجريبي')`);
  });

  await step('owner imports products from a CSV file', async () => {
    const csvPath = join(work, 'products.csv');
    // Unique codes per run: re-uploading identical content is (correctly) reported as a duplicate.
    const run = Date.now().toString(36).toUpperCase();
    const header = 'kind,internalCode,barcode,nameAr,nameEn,description,etaItemType,etaItemCode,unitType,unitPrice,taxCodes';
    writeFileSync(csvPath, `\uFEFF${header}\r\nGOODS,E2E-${run}-1,0042,عصير,Juice,Juice 1L,EGS,EG-000000000-901,EA,15.00,VAT_STD\r\nGOODS,E2E-${run}-2,,خطأ,,Bad,EGS,EG-000000000-902,EA,-1,VAT_STD\r\n`);
    await go('/imports');
    await waitFor(`document.querySelector('input[type=file]')`);
    const { result } = await send('Runtime.evaluate', { expression: `document.querySelector('input[type=file]')` });
    await send('DOM.enable');
    await send('DOM.setFileInputFiles', { files: [csvPath], objectId: result.objectId });
    await sleep(300);
    await clickText(await evaluate(`document.documentElement.lang === 'ar' ? 'رفع ملف' : 'Upload file'`).then((t) => t));
    await waitFor(`location.pathname.startsWith('/imports/') && document.querySelector('.counts')`, 15000);
    await shot('04-import-preview');
    await evaluate(`document.querySelector('.panel mat-checkbox input:not([name])') && [...document.querySelectorAll('mat-checkbox')].find((c) => c.textContent.includes('الصالح فقط') || c.textContent.includes('only valid'))?.querySelector('input').click()`);
    await sleep(300);
    await clickText(await evaluate(`document.documentElement.lang === 'ar' ? 'استيراد الصفوف الصالحة' : 'Import valid rows'`));
    await waitFor(`document.body.innerText.includes('تم الاستيراد') || document.body.innerText.includes('Imported')`);
  });

  await step('owner runs the tax summary report', async () => {
    await go('/reports');
    await waitFor(`document.querySelector('form button[type=submit]')`);
    await click('form button[type=submit]');
    await waitFor(`document.querySelector('table.data tbody tr')`);
    await shot('05-report');
  });

  await step('other administration pages load', async () => {
    for (const path of ['/settings/branches', '/settings/devices', '/settings/tax', '/settings/company', '/eta', '/notifications', '/profile', '/admin/users', '/admin/audit', '/shifts', '/returns', '/products']) {
      await go(path);
      await waitFor(`document.querySelector('main h1')`);
    }
  });

  await step('phone width has no horizontal overflow', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await go('/dashboard');
    await waitFor(`document.querySelector('.headline')`);
    if (await evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')) throw new Error('horizontal overflow at 390px');
  });

  await step('no browser console errors', async () => {
    if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 5).join(' | '));
  });
  console.log(`\n${steps.filter((s) => s.ok).length}/${steps.length} steps passed`);
} catch (err) {
  console.log(`\nFAILED: ${err.message}`);
  if (consoleErrors.length) console.log('console errors:', consoleErrors.slice(0, 5));
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
}
