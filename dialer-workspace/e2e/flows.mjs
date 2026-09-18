/**
 * End-to-end verification of the behaviours the brief specifies. Drives the real UI
 * against the real API, so a green run means the rules actually hold in the product,
 * not just in the unit tests.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5273';
const API = process.env.API ?? 'http://localhost:4100';
const results = [];
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    results.push(`  ok  ${name}`);
  } catch (e) {
    failures++;
    results.push(`FAIL  ${name}\n        ${String(e.message).split('\n')[0]}`);
  }
}

await fetch(`${API}/api/dev/reseed`, { method: 'POST' });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

const openWestHfc = async () => {
  await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle' });
  await page.click('.dtable tbody tr:has-text("WEST HFC") .dt-link');
  await page.waitForSelector('.modeseg');
};

/**
 * All settings deliberately opens with every section collapsed — a section only
 * auto-expands when it holds a blocking issue or an unsaved change. Tests that want to
 * see fields therefore have to expand, exactly as a user would.
 */
const showAllSettings = async () => {
  await page.click('.ms >> nth=1');
  await page.waitForTimeout(200);
  await page.click('button:text-is("Expand all")');
  await page.waitForTimeout(250);
};

/* =================================================== essentials vs all settings */
await check('campaign form opens in Essentials mode showing far fewer fields', async () => {
  await openWestHfc();
  const essentials = await page.locator('.ms').first().innerText();
  const all = await page.locator('.ms').nth(1).innerText();
  const e = Number(essentials.match(/\d+/)[0]);
  const a = Number(all.match(/\d+/)[0]);
  if (!(e < a)) throw new Error(`essentials ${e} should be fewer than all ${a}`);
  if (a < 50) throw new Error(`expected the full inventory to be 50+, got ${a}`);
});

await check('sections with nothing essential are hidden entirely in Essentials', async () => {
  const essentialsSections = await page.locator('section.card').count();
  await page.click('.ms >> nth=1'); // All settings
  await page.waitForTimeout(250);
  const allSections = await page.locator('section.card').count();
  if (!(essentialsSections < allSections)) {
    throw new Error(`essentials showed ${essentialsSections} sections, all showed ${allSections}`);
  }
});

await check('All settings opens collapsed, showing a one-line summary per section', async () => {
  // A section auto-expands only when it holds an issue or a change, so a clean
  // campaign starts fully collapsed.
  const closed = await page.locator('section.card.closed').count();
  if (closed < 8) throw new Error(`expected most sections collapsed, got ${closed}`);
  const summaries = await page.locator('.sumline').count();
  if (summaries < 8) throw new Error(`expected a summary per collapsed section, got ${summaries}`);
  await page.click('button:text-is("Expand all")');
  await page.waitForTimeout(250);
  if (await page.locator('section.card.closed').count()) throw new Error('Expand all left sections closed');
});

/* ========================================================= progressive disclosure */
await check('a dependent field appears only when its toggle is on, beside that toggle', async () => {
  await openWestHfc();
  await showAllSettings();

  const csatSection = page.locator('section#sec-outcomes');
  const before = await csatSection.locator('label:has-text("Survey")').count();
  if (before !== 0) throw new Error('survey field visible before CSAT was enabled');

  await csatSection.locator('button[role="switch"][aria-label="Run a CSAT survey"]').click();
  await page.waitForTimeout(150);
  const after = await csatSection.locator('label:has-text("Survey")').count();
  if (after === 0) throw new Error('survey field did not appear inside the same section');
});

await check('enabling a toggle adds a blocking issue for the field it reveals', async () => {
  const footer = await page.locator('.ftr .st').innerText();
  if (!/blocking issue/.test(footer)) throw new Error(`footer did not report the issue: "${footer}"`);
});

await check('the publish button is never disabled — it explains itself instead', async () => {
  const btn = page.locator('.ftr .btn.pri');
  if (await btn.isDisabled()) throw new Error('publish button was disabled');
  const label = await btn.innerText();
  if (!/^Fix \d+ to publish$/.test(label)) throw new Error(`unexpected label "${label}"`);
});

await check('the full issue list appears only after the user asks for it', async () => {
  if (await page.locator('.issues').count()) throw new Error('issue list was showing unprompted');
  await page.click('.ftr .btn.pri');
  await page.waitForSelector('.issues');
  const items = await page.locator('.issues li').count();
  if (!items) throw new Error('issue list was empty');
});

await check('clicking an issue jumps to the section that holds it', async () => {
  await page.click('.issues li button >> nth=0');
  await page.waitForTimeout(400);
  const active = await page.locator('.rail .nav.on').innerText();
  if (!active.trim()) throw new Error('no rail section became active');
});

await check('turning the toggle back off clears the issue', async () => {
  await page.locator('section#sec-outcomes button[role="switch"][aria-label="Run a CSAT survey"]').click();
  await page.waitForTimeout(250);
  const label = await page.locator('.ftr .btn.pri').innerText();
  if (label !== 'Publish changes') throw new Error(`expected publish to unblock, got "${label}"`);
});

/* ============================================================= dirty tracking */
await check('a changed field is marked at field, section, phase and footer level', async () => {
  await openWestHfc();
  await showAllSettings();
  const compliance = page.locator('section#sec-compliance');
  await compliance.locator('button[role="switch"][aria-label="Mask sensitive lead details"]').click();
  await page.waitForTimeout(250);

  if (!(await compliance.locator('.dirty').count())) throw new Error('no field-level dirty marker');
  if (!(await compliance.locator('.badge').count())) throw new Error('no section change count');
  if (!(await page.locator('.rail .gh .cnt').count())) throw new Error('no phase change count');
  const footer = await page.locator('.ftr .st').innerText();
  if (!/unsaved change/.test(footer)) throw new Error(`footer missing total: "${footer}"`);
});

await check('Discard restores the last published values', async () => {
  await page.click('.ftr .btn.sec');
  await page.waitForTimeout(400);
  const footer = await page.locator('.ftr .st').innerText();
  if (/unsaved change/.test(footer)) throw new Error(`still dirty after discard: "${footer}"`);
});

/* ============================================================ pacing by method */
await check('changing the dial method swaps the pacing controls', async () => {
  await openWestHfc();
  if (!(await page.locator('.pacing:has-text("Predictive pacing")').count())) {
    throw new Error('predictive pacing block missing');
  }
  if (!(await page.locator('label:has-text("Max abandon rate")').count())) {
    throw new Error('predictive-only field missing');
  }
  await page.selectOption('section#sec-dialing select >> nth=0', 'Power');
  await page.waitForTimeout(250);
  if (await page.locator('label:has-text("Max abandon rate")').count()) {
    throw new Error('predictive field survived the switch to Power');
  }
  if (!(await page.locator('label:has-text("Lines per agent")').count())) {
    throw new Error('power pacing field missing');
  }
  await page.selectOption('section#sec-dialing select >> nth=0', 'Progressive');
  await page.waitForTimeout(250);
  const note = await page.locator('.pacing .pnote').innerText();
  if (!/No pacing controls needed/.test(note)) throw new Error(`unexpected note: ${note}`);
});

/* ================================================ dense band vs revealing toggles */
await check('standalone toggles sit in a dense band, revealing ones stay in the grid', async () => {
  await openWestHfc();
  await showAllSettings();
  const band = page.locator('section#sec-compliance .dband');
  if (!(await band.count())) throw new Error('no dense toggle band in Compliance');
  const bandToggles = await band.locator('.dtog').count();
  if (bandToggles < 3) throw new Error(`expected 3+ toggles in the band, got ${bandToggles}`);
  // "Allow transfer / conference" reveals three fields, so it stays in the main grid --
  // while the toggles it reveals, which gate nothing themselves, do go in the band.
  const transfers = page.locator('section#sec-transfers');
  const inGrid = await transfers.locator('.grid .tog .tl:text-is("Allow transfer / conference")').count();
  if (!inGrid) throw new Error('the revealing toggle was not in the main grid');
  const inBand = await transfers.locator('.dband .dl:text-is("Allow transfer / conference")').count();
  if (inBand) throw new Error('the revealing toggle was put in the dense band');
});

/* ================================================================ owned queues */
await check('inbound queues are listed inside the campaign, not in the nav', async () => {
  await openWestHfc();
  await showAllSettings();
  const rows = await page.locator('.qrow').count();
  if (rows !== 2) throw new Error(`expected 2 owned queues, got ${rows}`);
  const railText = await page.locator('.rail').innerText();
  if (/queue/i.test(railText)) throw new Error('queues leaked into the nav rail');
});

await check('opening a queue shows its own fields and tiered agents', async () => {
  await page.click('.qrow >> nth=0');
  await page.waitForSelector('#qsec-qbasics');
  const tiers = await page.locator('text=Tier 1').count();
  if (!tiers) throw new Error('tier UI missing for a queue with priority on');
});

await check('a twinned queue field shows the campaign value as reference, not a copy', async () => {
  const ref = page.locator('.cmpref').first();
  if (!(await ref.count())) throw new Error('no campaign reference shown');
  const text = await ref.innerText();
  if (!/Campaign uses/.test(text)) throw new Error(`unexpected reference text: ${text}`);
});

await check('a DID already used by another queue is refused with the clashing queue named', async () => {
  page.once('dialog', (d) => d.accept('022 6178 0155')); // already on the escalations queue
  await page.click('.chips .addlink');
  await page.waitForTimeout(800);
  const err = await page.locator('.f .err').first().innerText().catch(() => '');
  if (!/already pointed at/.test(err)) throw new Error(`expected a collision message, got "${err}"`);
});

/* ================================================================= lead lists */
await check('lead lists live in the library and report how many campaigns use them', async () => {
  await page.goto(`${BASE}/library/lead-lists`, { waitUntil: 'networkidle' });
  const row = page.locator('.dtable tbody tr:has-text("WEST_HFC_JUL")');
  const text = await row.innerText();
  if (!/2 campaigns/.test(text)) throw new Error(`usage count wrong: ${text}`);
});

await check('records paginate and sensitive columns are masked', async () => {
  await page.click('.dtable tbody tr:has-text("WEST_HFC_JUL") .dt-link');
  await page.waitForSelector('.pager');
  const rows = await page.locator('.dtable tbody tr').count();
  if (rows !== 10) throw new Error(`expected 10 rows per page, got ${rows}`);
  const masked = await page.locator('.dt-mask').count();
  if (!masked) throw new Error('no masked cells for the sensitive columns');
  const headerHasTag = await page.locator('th:has-text("Loan Account No") .mtag').count();
  if (!headerHasTag) throw new Error('masked column not labelled in the header');
});

await check('the structure drawer refuses to let phone or altphone be masked', async () => {
  await page.click('button[aria-label="Edit structure"]');
  await page.waitForSelector('[role="dialog"]');
  const alwaysVisible = await page.locator('.drawer >> text=always visible').count();
  if (alwaysVisible !== 2) throw new Error(`expected 2 unmaskable fixed columns, got ${alwaysVisible}`);
});

await check('the sample CSV is generated from the schema', async () => {
  const cells = await page.locator('.drawer span[style*="monospace"], .drawer span').allInnerTexts();
  if (!cells.some((c) => c.includes('Loan Account No'))) {
    throw new Error('custom column missing from the sample preview');
  }
  await page.keyboard.press('Escape');
});

/* =============================================================== dispositions */
await check('selecting a node lists the full effective action list with its source', async () => {
  await page.goto(`${BASE}/library/dispositions`, { waitUntil: 'networkidle' });
  await page.click('.dtable tbody tr:has-text("SMFG") .dt-link');
  await page.waitForSelector('[role="tree"]');
  await page.click('[role="tree"] .trow:has-text("Not interested") >> nth=0');
  await page.waitForTimeout(300);
  const panel = await page.locator('text=Selecting this outcome runs').count();
  if (!panel) throw new Error('effective action list missing');
});

await check('setting an action on a parent reports how far it reaches', async () => {
  // The seeded tree carries actions only on leaves, so put one on a parent to see the cascade.
  await page.click('[role="tree"] .trow:has-text("Connected") >> nth=0');
  await page.waitForTimeout(300);
  await page.selectOption('#daction', 'callback');
  await page.waitForTimeout(500);
  const cascade = await page.locator('text=/Also applies to the \\d+ dispositions/').count();
  if (!cascade) throw new Error('cascade reach not reported');
});

await check('descendants of that parent now show it as an inherited, dashed badge', async () => {
  const dashed = await page.locator('[role="tree"] span[style*="dashed"]').count();
  if (!dashed) throw new Error('no inherited (dashed) badges rendered on the descendants');
});

await check('two callbacks on one path are flagged as a conflict', async () => {
  // "Call back later" already carries a callback and sits directly under "Connected".
  await page.waitForTimeout(400);
  const conflict = await page.locator('.issues:has-text("same action twice")').count();
  if (!conflict) throw new Error('conflict not detected after adding a second callback on the path');
});

await check('duplicate DND on one path is NOT flagged, being idempotent', async () => {
  await page.click('[role="tree"] .trow:has-text("Connected") >> nth=0');
  await page.waitForTimeout(300);
  await page.selectOption('#daction', 'dnd');
  await page.waitForTimeout(500);
  // "Not interested" beneath it also adds to DND; adding twice is the same outcome.
  const conflict = await page.locator('.issues:has-text("same action twice")').count();
  if (conflict) throw new Error('duplicate DND was wrongly flagged as a conflict');
});

await check('a code is suggested from the name and stays 3 characters', async () => {
  await page.click('button:text-is("Add primary")');
  await page.waitForTimeout(300);
  await page.fill('#dname', 'Escalated to legal');
  await page.waitForTimeout(400);
  const code = await page.inputValue('#dcode');
  if (!code) throw new Error('no code suggested');
  if (code.length > 3) throw new Error(`code "${code}" is longer than 3 characters`);
});

await check('the tree refuses a sixth level', async () => {
  await page.goto(`${BASE}/library/dispositions`, { waitUntil: 'networkidle' });
  await page.click('.dtable tbody tr:has-text("SMFG") .dt-link');
  await page.waitForSelector('[role="tree"]');
  await page.click('[role="tree"] .trow:has-text("Do not call again") >> nth=0');
  await page.waitForTimeout(300);
  const btn = page.locator('button:has-text("Maximum depth reached")');
  if (!(await btn.count())) throw new Error('level 5 node still offered a child');
});

/* ==================================================================== surveys */
await check('a survey type cannot be changed after creation', async () => {
  await page.goto(`${BASE}/library/surveys`, { waitUntil: 'networkidle' });
  await page.click('.dtable tbody tr:has-text("Standard CSAT") .dt-link');
  await page.waitForSelector('#general-head');
  const selects = await page.locator('select').allInnerTexts();
  if (selects.some((s) => /Web survey/.test(s))) throw new Error('a type switcher was offered');
  // The tag is uppercased by CSS, so compare case-insensitively.
  const tag = (await page.locator('.card .grouptag').first().innerText()).trim().toLowerCase();
  if (tag !== 'voice') throw new Error(`expected the type shown as a fixed tag, got "${tag}"`);
});

await check('a web survey requires two options for choice questions only', async () => {
  await page.goto(`${BASE}/library/surveys`, { waitUntil: 'networkidle' });
  await page.click('.dtable tbody tr:has-text("Post-call form") .dt-link');
  await page.waitForSelector('#questions-head');
  const optionInputs = await page.locator('input[aria-label*="option"]').count();
  if (optionInputs < 2) throw new Error('dropdown question has no option inputs');
  // The short-answer question explains itself instead of offering options.
  const explain = await page.locator('text=The agent types a free-text answer.').count();
  if (!explain) throw new Error('short answer question still offered options');
});

/* ======================================================================== DND */
await check('DND numbers are masked but prefixes are shown in full', async () => {
  await page.goto(`${BASE}/library/dnd`, { waitUntil: 'networkidle' });
  await page.click('.dtable tbody tr >> nth=0');
  await page.waitForSelector('.pager');
  const masked = await page.locator('.dt-mask').count();
  if (!masked) throw new Error('numbers were not masked');
  await page.click('button[aria-label="Show full numbers"]');
  await page.waitForTimeout(200);
  if (await page.locator('.dt-mask').count()) throw new Error('reveal toggle did not unmask');
});

/* ======================================================= inline creation + seeds */
await check('every library dropdown in a campaign offers + New', async () => {
  await openWestHfc();
  await showAllSettings();
  const newButtons = await page.locator('.newbtn').count();
  if (newButtons < 5) throw new Error(`expected + New on every library select, got ${newButtons}`);
});

await check('inline creation makes an object and selects it without leaving the page', async () => {
  await openWestHfc();
  await showAllSettings();
  const section = page.locator('section#sec-agents');
  await section.locator('button[role="switch"][aria-label="Enforce agent pause code"]').click();
  await page.waitForTimeout(200);
  const before = page.url();
  await section.locator('.newbtn').last().click();
  await page.waitForSelector('.drawer');
  await page.fill('#inline-name', 'Overnight breaks');
  await page.click('button:text-is("Create and select")');
  await page.waitForTimeout(700);
  if (page.url() !== before) throw new Error('inline creation navigated away');
  const selected = await section.locator('select').last().locator('option:checked').innerText();
  if (!/Overnight breaks/.test(selected)) throw new Error(`new object not selected, got "${selected}"`);
});

/* ============================================================= accessibility */
await check('toggles are switches with a checked state', async () => {
  const switches = await page.locator('button[role="switch"]').count();
  if (switches < 5) throw new Error(`expected several switches, got ${switches}`);
  const unchecked = await page.$$eval('button[role="switch"]', (els) =>
    els.filter((e) => e.getAttribute('aria-checked') === null).length,
  );
  if (unchecked) throw new Error(`${unchecked} switches without aria-checked`);
});

await check('every section is a labelled region', async () => {
  const unlabelled = await page.$$eval('section.card', (els) =>
    els.filter((e) => !e.getAttribute('aria-labelledby')).length,
  );
  if (unlabelled) throw new Error(`${unlabelled} sections without aria-labelledby`);
});

await check('the active rail item is marked aria-current', async () => {
  await page.goto(`${BASE}/library/dnd`, { waitUntil: 'networkidle' });
  const current = await page.locator('.rail [aria-current]').count();
  if (!current) throw new Error('no aria-current in the rail');
});

await check('no uncaught page errors across the whole run', async () => {
  if (pageErrors.length) throw new Error(pageErrors.slice(0, 2).join(' | '));
});

await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failing` : `\nall ${results.length} passing`);
process.exit(failures ? 1 : 0);
