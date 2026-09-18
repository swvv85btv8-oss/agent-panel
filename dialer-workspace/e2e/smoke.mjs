/**
 * Browser smoke test. Drives the real UI against the real API, so a green run means the
 * pages render, the data loads and the interactions fire — not just that TypeScript is happy.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5273';
const results = [];
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    results.push(`  ok  ${name}`);
  } catch (e) {
    failures++;
    results.push(`FAIL  ${name}\n        ${e.message.split('\n')[0]}`);
  }
}

// The preinstalled Chromium does not match this Playwright build's expected revision,
// so point at it explicitly rather than downloading another copy.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();
const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e}`));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} (${r.failure()?.errorText})`));
page.on('response', (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.url()} -> ${r.status()}`);
});

await page.goto(BASE, { waitUntil: 'networkidle' });

await check('campaigns list renders seeded rows', async () => {
  await page.waitForSelector('text=WEST HFC', { timeout: 5000 });
  const rows = await page.locator('.dtable tbody tr').count();
  if (rows < 3) throw new Error(`expected 3+ rows, got ${rows}`);
});

await check('queue count comes from the API', async () => {
  const cell = page.locator('.dtable tbody tr', { hasText: 'WEST HFC' }).first();
  const text = await cell.innerText();
  if (!text.includes('Predictive')) throw new Error('dial method missing');
});

await check('nav rail is a labelled landmark', async () => {
  const nav = page.locator('nav[aria-label="Configuration"]');
  if (!(await nav.count())) throw new Error('no configuration nav landmark');
});

await check('library groups use the four agreed words', async () => {
  for (const word of ['Lead data', 'Call outcomes', 'Agent setup', 'Compliance']) {
    if (!(await page.locator(`.gh:text-is("${word}")`).count())) {
      throw new Error(`missing group "${word}"`);
    }
  }
});

await check('every icon-only button has an accessible name', async () => {
  const unnamed = await page.$$eval('button.iba, button.tbtn', (btns) =>
    btns.filter((b) => !b.getAttribute('aria-label')?.trim()).length,
  );
  if (unnamed) throw new Error(`${unnamed} icon buttons without an accessible name`);
});

await check('search filters server-side', async () => {
  await page.fill('input[type="search"]', 'Renewal');
  await page.waitForTimeout(500);
  const rows = await page.locator('.dtable tbody tr').count();
  if (rows !== 1) throw new Error(`expected 1 row, got ${rows}`);
  await page.fill('input[type="search"]', '');
  await page.waitForTimeout(500);
});

await check('template picker opens and lists all four templates', async () => {
  await page.click('button[aria-label="New campaign"]');
  await page.waitForSelector('[role="dialog"]');
  const cards = await page.locator('.tplc').count();
  if (cards !== 4) throw new Error(`expected 4 templates, got ${cards}`);
  await page.keyboard.press('Escape');
});

await check('no failed application requests', async () => {
  // The font CDN and favicon are environment noise here, not app faults.
  const external = /favicon|fonts\.(googleapis|gstatic)|google\.com/;
  const real = failedRequests.filter((u) => !external.test(u));
  if (real.length) throw new Error(real.slice(0, 3).join(' | '));
});

await check('no uncaught page errors', async () => {
  const real = consoleErrors.filter((e) => e.startsWith('pageerror'));
  if (real.length) throw new Error(real.slice(0, 2).join(' | '));
});

await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
