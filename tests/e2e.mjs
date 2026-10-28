// End-to-end check: fills every tab in a headless browser, downloads the Word file,
// and verifies the filled values landed in the right content controls.
// Usage: node tests/e2e.mjs [outDir]   (needs Playwright + Chromium; starts its own server)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

// require() also finds a globally installed Playwright.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'tests', 'output'));
mkdirSync(out, { recursive: true });
const PORT = 8765;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const failures = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByRole('button', { name: '+ New patient' }).click();
  await page.waitForSelector('#f_pt_name');

  const fill = (tag, v) => page.fill(`[data-tag="${tag}"]`, v);
  const select = (tag, v) => page.selectOption(`[data-tag="${tag}"]`, v);
  const tab = (name) => page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
  const sign = async (index) => {
    const c = page.locator('canvas.sig-canvas').nth(index);
    await c.scrollIntoViewIfNeeded();
    const b = await c.boundingBox();
    await page.mouse.move(b.x + 40, b.y + b.height * 0.6);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) await page.mouse.move(b.x + 40 + i * 12, b.y + b.height * (0.6 - 0.25 * Math.sin(i / 2)));
    await page.mouse.up();
  };

  await fill('pt_name', 'joven samillano');
  await page.fill('#f_pt_birthday', '1981-06-03');
  await page.dispatchEvent('#f_pt_birthday', 'change');
  await select('pt_sex', 'Male');
  expect(await page.inputValue('#f_pt_age') !== '', 'age auto-filled from birthday');
  expect((await page.inputValue('#f_pt_name')) === 'JOVEN SAMILLANO', 'name upper-cased');

  // Consent
  await page.getByRole('button', { name: 'Monday' }).click();
  await page.getByRole('button', { name: 'Wednesday' }).click();
  await page.getByRole('button', { name: 'Friday' }).click();
  await fill('program_weeks', '4');
  await page.fill('#f_start_date', '2026-11-02');
  await page.dispatchEvent('#f_start_date', 'change');
  expect(await page.inputValue('#f_end_date') === '2026-11-30', 'end date suggested from start + weeks');
  await sign(0);
  await sign(1);

  // Finalize the participant signature: it locks and drawing no longer changes it.
  const participant = page.locator('.sig').nth(0);
  await participant.getByRole('button', { name: 'Finalize signature' }).click();
  expect((await participant.locator('.sig-lock').textContent()).includes('Locked'), 'participant signature locked');
  expect(await participant.getByRole('button', { name: 'Clear' }).isHidden(), 'clear hidden once finalized');
  const before = await page.evaluate(() => document.querySelectorAll('canvas.sig-canvas')[0].toDataURL());
  await sign(0);
  const after = await page.evaluate(() => document.querySelectorAll('canvas.sig-canvas')[0].toDataURL());
  expect(before === after, 'finalized signature cannot be redrawn');
  await page.screenshot({ path: `${out}/consent.png`, fullPage: true });

  // DASI: yes to 1-6, no to 7-12 -> 2.75+1.75+2.75+5.5+8+2.7 = 23.45
  await tab('DASI');
  for (let i = 1; i <= 12; i++) await page.click(`[data-tag="dasi_${i <= 6 ? 'yes' : 'no'}_${i}"]`);
  await sign(0);
  await fill('dasi_completed_by', 'Maria Samillano');
  await page.screenshot({ path: `${out}/dasi.png`, fullPage: true });

  // 6MWT
  await tab('6 Minute Walk');
  await fill('smwt_height', '1.70 m');
  await fill('smwt_weight', '72 kg');
  await fill('smwt_bp_baseline_sys', '120');
  await fill('smwt_bp_baseline_dia', '80');
  await fill('smwt_hr_baseline', '72');
  await select('smwt_o2_baseline', '98%');
  await fill('smwt_laps', '38');
  await select('smwt_partial', '7 m');
  // 20 m course: total uses 20 m laps and the partial lap can go up to 19 m.
  const walkTotalText = () => page.locator('.computed', { hasText: 'Total distance' }).locator('.computed-value').textContent();
  await page.selectOption('#f_smwt_lap_length', '20');
  expect((await walkTotalText()) === '767 m', `20 m laps total: ${await walkTotalText()}`);
  expect(await page.locator('#f_smwt_partial option').count() === 21, '20 m course offers 0-19 m partial laps');
  await select('smwt_partial', '15 m');
  expect((await walkTotalText()) === '775 m', `20 m laps + 15 m: ${await walkTotalText()}`);
  // Back to 10 m: a 15 m partial lap no longer fits and is cleared.
  await page.selectOption('#f_smwt_lap_length', '10');
  expect((await page.inputValue('#f_smwt_partial')) === '', 'out-of-range partial lap cleared');
  await select('smwt_partial', '7 m');
  expect((await walkTotalText()) === '387 m', `10 m laps total: ${await walkTotalText()}`);
  await select('smwt_stopped', 'No');
  await page.screenshot({ path: `${out}/walk.png`, fullPage: true });

  // Treatment plan
  await tab('Treatment Plan');
  await fill('itp_cardiologist', 'Dr. A. Reyes');
  await page.click('[data-tag="itp_ind_2"] + .box');
  await page.click('[data-tag="itp_comorb_1"] + .box');
  await fill('itp_height', '1.70');
  await fill('itp_weight', '72');
  await fill('itp_diagnosis', 'CAD s/p PCI to LAD\nHypertension stage 2');
  await page.getByRole('button', { name: /Use 6MWT result/ }).click();
  await page.click('[data-tag="gad2_q1_1"]');
  await page.click('[data-tag="gad2_q2_2"]');
  await page.click('[data-tag="phq2_q1_0"]');
  await page.click('[data-tag="phq2_q2_1"]');
  await fill('itp_thr', '120');
  await page.screenshot({ path: `${out}/plan.png`, fullPage: true });

  // Sessions
  await tab('Exercise Sessions');
  await page.fill('#f_s01_date', '2026-11-02');
  await page.dispatchEvent('#f_s01_date', 'change');
  await fill('s01_weight', '72');
  await select('s01_cal_sets', '3');
  await select('s01_cal_weights', '1.0 kg');
  await fill('s01_tm_duration', '15');
  await fill('s01_tm_speed', '3.5');
  await fill('s01_tm_pre_bp_sys', '118');
  await fill('s01_tm_pre_bp_dia', '76');
  await select('s01_tm_pre_o2', '97%');
  await select('s01_borg', '12');
  await page.click('[data-tag="s01_sym_sob"] + .box');
  await fill('s01_therapist', 'PT Cruz');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/sessions.png`, fullPage: true });
  expect((await page.textContent('#save-status')).includes('Up to date'), 'saved');

  // Reload: data persists
  await page.reload();
  await page.getByRole('tab', { name: /^Session 1\b/ }).click(); // reload opens the next open session
  await page.waitForSelector('#f_s01_weight');
  expect(await page.inputValue('#f_s01_weight') === '72', 'session data persisted after reload');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  const file = path.join(out, dl.suggestedFilename());
  await dl.saveAs(file);
  expect(dl.suggestedFilename() === `JOVEN SAMILLANO - ${await page.evaluate(() => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`; })}.docx`, `file name: ${dl.suggestedFilename()}`);

  // Inspect the docx
  let JSZip;
  try { JSZip = require('jszip'); } catch { JSZip = null; }
  const zipSrc = JSZip ? null : readFileSync(path.join(root, 'vendor', 'jszip.min.js'), 'utf8');
  if (!JSZip) { const m = { exports: {} }; new Function('module', 'exports', zipSrc)(m, m.exports); JSZip = m.exports; }
  const zip = await JSZip.loadAsync(readFileSync(file));
  const xml = await zip.file('word/document.xml').async('string');
  const ctl = (tag) => {
    const i = xml.indexOf(`<w:tag w:val="${tag}"/>`);
    const end = xml.indexOf('</w:sdt>', i);
    const content = xml.slice(xml.indexOf('<w:sdtContent>', i), end);
    return [...content.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
  };
  const checks = {
    attend_days: 'Monday, Wednesday and Friday', program_weeks: '4', start_date: '11/02/2026', end_date: '11/30/2026',
    dasi_total: '23.45', dasi_vo2: '19.68 mL/kg/min', dasi_mets: '5.62', dasi_yes_1: '●', dasi_no_1: '○', dasi_no_12: '●',
    smwt_bp_baseline_sys: '120', smwt_o2_baseline: '98%', smwt_laps: '38', smwt_partial: '7 m', smwt_total: '387',
    itp_bmi: '24.9', itp_ind_2: '☒', itp_ind_1: '☐', gad2_total: '3', phq2_total: '1', itp_6mwt_initial: '387', itp_thr: '120',
    s01_date: '11/02/2026', s01_tm_duration: '15 min', s01_tm_speed: '3.5', s01_cal_weights: '1.0 kg', s01_tm_pre_o2: '97%', s01_sym_sob: '☒', s01_borg: '12',
  };
  for (const [tag, want] of Object.entries(checks)) {
    const got = ctl(tag);
    expect(got === want, `${tag}: expected "${want}", got "${got}"`);
  }
  expect(!xml.includes('MACROBUTTON'), 'macro buttons removed');
  expect((xml.match(/rIdSig_/g) || []).length === 3, 'three signatures embedded');
  const custom = await zip.file('customXml/item1.xml').async('string');
  expect(custom.includes('<name>JOVEN SAMILLANO</name>') && custom.includes('<birthday>06/03/1981</birthday>'), `bound data: ${custom}`);
  const ct = await zip.file('[Content_Types].xml').async('string');
  expect(ct.includes('document.main+xml') && !ct.includes('template.main+xml'), 'saved as a document');
  console.log(`docx: ${file}`);

  // Finalized signature survives a reload and stays locked.
  await page.goto(`http://127.0.0.1:${PORT}/#/patient/${page.url().split('/patient/')[1].split('/')[0]}/consent`);
  await page.waitForSelector('.sig-lock');
  expect((await page.locator('.sig-lock').first().textContent()).includes('Locked'), 'lock persisted after reload');

  // Dashboard: add a second patient (female, dropped out) and check the summary.
  await page.goto(`http://127.0.0.1:${PORT}/#/`);
  await page.getByRole('button', { name: '+ New patient' }).click();
  await page.waitForSelector('#f_pt_name');
  await fill('pt_name', 'maria dela cruz');
  await select('pt_sex', 'Female');
  await fill('pt_age', '60');
  expect(await page.locator('.dropout-row').isHidden(), 'dropout reason hidden while in program');
  await page.selectOption('#f_program_status', 'dropped');
  expect(await page.locator('.dropout-row').isVisible(), 'dropout reason shown once dropped out');
  await page.selectOption('#f_dropout_reason', 'Financial');
  await page.fill('#f_dropout_details', 'Cannot afford sessions');
  await page.waitForTimeout(600);
  await page.getByRole('link', { name: '← Patients' }).click();
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.waitForSelector('.stats');
  const stat = async (label) => page.locator('.stat', { has: page.locator('.stat-label', { hasText: label }) }).innerText();
  const total = await stat('Total enrolled');
  expect(/^Total enrolled\s+2\b/.test(total) && /Male\s+1/.test(total) && /Female\s+1/.test(total), `total tile: ${total}`);
  const age = await stat('Average age');
  expect(age.includes('52.5') && /Male\s+45\.0/.test(age) && /Female\s+60\.0/.test(age), `age tile: ${age}`);
  const dropped = await stat('Dropped out');
  expect(/Dropped out\s+1\b/.test(dropped) && /Financial\s+1/.test(dropped), `dropped tile: ${dropped}`);
  const htn = await stat('Hypertension');
  expect(/^Hypertension\s+1\b/.test(htn) && /Of enrolled\s+50%/.test(htn) && /Male\s+1/.test(htn) && /Female\s+0/.test(htn), `hypertension tile: ${htn}`);
  expect((await page.locator('.dash-table').innerText()).includes('Financial'), 'dropout reason in table');
  expect(/Completed\s+0\b/.test(await stat('Completed')), 'completed tile');
  const walk = await stat('6MWD average');
  expect(/Initial\s+387/i.test(walk), `6MWD tile: ${walk}`);
  expect(await page.locator('.dash-table tbody tr').count() === 2, 'dashboard table rows');
  await page.screenshot({ path: `${out}/dashboard.png`, fullPage: true });

  // Backup round trip: import keeps the newer copy and never drops a finalized signature.
  await page.getByRole('link', { name: 'Patients' }).click();
  const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()]);
  const backup = JSON.parse(readFileSync(await bk.path(), 'utf8'));
  const joven = backup.patients.find((p) => p.fields.pt_name === 'JOVEN SAMILLANO');
  expect(joven?.signatures?.participant?.final === true, 'backup carries finalized signature');
  const older = { ...joven, updated: '2000-01-01T00:00:00.000Z', fields: { ...joven.fields, pt_age: '99' } };
  const newer = { ...joven, updated: '2999-01-01T00:00:00.000Z', fields: { ...joven.fields, pt_age: '46' }, signatures: {} };
  const extra = { id: 'imported-1', updated: '2026-10-01T00:00:00.000Z', fields: { pt_name: 'ANA REYES', pt_sex: 'Female', pt_age: '58' }, signatures: {} };
  const importFile = async (patients, name) => {
    await page.setInputFiles('input[type=file]', { name, mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify({ patients })) });
    await page.waitForSelector('.toast');
    const msg = await page.locator('.toast').last().textContent();
    await page.waitForTimeout(300);
    return msg;
  };
  const msg1 = await importFile([older, extra], 'old.txt');
  expect(msg1.includes('1 new') && msg1.includes('1 already up to date'), `import older: ${msg1}`);
  const msg2 = await importFile([newer], 'new.json');
  expect(msg2.includes('1 updated'), `import newer: ${msg2}`);
  const after2 = await page.evaluate(async () => (await import('/js/store.js')).listPatients());
  const j2 = after2.find((p) => p.fields.pt_name === 'JOVEN SAMILLANO');
  expect(j2.fields.pt_age === '46', `newer copy won: age ${j2.fields.pt_age}`);
  expect(j2.signatures.participant?.final === true, 'finalized signature kept through newer import');
  expect(after2.some((p) => p.fields.pt_name === 'ANA REYES'), 'new patient added from backup');
} finally {
  await browser.close();
  server.kill();
}

if (failures.length) {
  console.error(`FAILED (${failures.length}):\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('All checks passed');
