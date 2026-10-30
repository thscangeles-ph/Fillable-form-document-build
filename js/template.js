// Loads the Word template, reads its content controls, and produces a filled .docx.
/* global JSZip */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const TEMPLATE_URL = 'template/THSC_Cardiac_Rehab_Forms_BLANK.dotx';
const END_WALK_TITLE = '6 Minute Walk Test Results — End of Program';

let templateBytes = null;
let schema = null;

// tag -> { kind: 'text'|'date'|'dropdown'|'checkbox', options?: string[], multiline?: bool }
export async function loadTemplate() {
  if (schema) return schema;
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`Could not load the Word template (${res.status})`);
  templateBytes = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(templateBytes);
  const doc = parseXml(await zip.file('word/document.xml').async('string'));
  schema = {};
  for (const sdt of controls(doc)) {
    const pr = child(sdt, W, 'sdtPr');
    const tag = attr(child(pr, W, 'tag'), 'val');
    if (!tag || schema[tag]) continue;
    const dd = child(pr, W, 'dropDownList');
    const text = child(pr, W, 'text');
    if (dd) {
      schema[tag] = { kind: 'dropdown', options: kids(dd, W, 'listItem').map((li) => attr(li, 'displayText')) };
    } else if (child(pr, W14, 'checkbox')) {
      schema[tag] = { kind: 'checkbox' };
    } else if (child(pr, W, 'date')) {
      schema[tag] = { kind: 'date' };
    } else {
      schema[tag] = { kind: 'text', multiline: text?.getAttributeNS(W, 'multiLine') === '1' };
    }
  }
  return schema;
}

// For number-style inputs: map a typed number onto the dropdown's display text ("95" -> "95%").
export function matchOption(options, value) {
  if (value === '' || value == null) return '';
  const exact = options.find((o) => o === String(value));
  if (exact) return exact;
  const n = parseFloat(value);
  if (Number.isNaN(n)) return null;
  // "2.0 kg" must not turn into "2 lbs": a typed unit has to match the option's.
  const unit = (s) => String(s).replace(/^[\s\d.,-]+/, '').trim().toLowerCase();
  const u = unit(value);
  return options.find((o) => parseFloat(o) === n && (!u || unit(o) === u)) ?? null;
}

export function isoToUs(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

/**
 * values: { tag: string|boolean }  (dates as yyyy-mm-dd, checkboxes as booleans)
 * signatures: { participant?, witness?, dasi? } each { png: dataURL, date: yyyy-mm-dd }
 */
export async function buildDocx(values, signatures = {}, pages = []) {
  await loadTemplate();
  const zip = await JSZip.loadAsync(templateBytes);
  const doc = parseXml(await zip.file('word/document.xml').async('string'));

  for (const sdt of controls(doc)) {
    const pr = child(sdt, W, 'sdtPr');
    const tag = attr(child(pr, W, 'tag'), 'val');
    const info = schema[tag];
    const value = values[tag];
    if (!info || value === undefined || value === null || value === '') continue;
    if (info.kind === 'checkbox') {
      setCheckbox(sdt, pr, value === true);
      continue;
    }
    let display = String(value);
    if (info.kind === 'date') {
      display = isoToUs(value);
      child(pr, W, 'date').setAttributeNS(W, 'w:fullDate', `${value}T00:00:00Z`);
    } else if (info.kind === 'dropdown') {
      // Values outside the template's list (e.g. a 15 m partial lap on a 20 m course) go in as plain text.
      const match = matchOption(info.options, value);
      if (match !== null) {
        display = match;
        child(pr, W, 'dropDownList').setAttributeNS(W, 'w:lastValue', display);
      }
    }
    setText(sdt, pr, display, info.multiline);
  }

  for (const p of ['smwt', 'smwte']) setLapLength(doc, `${p}_laps`, Number(values[`${p}_lap_length`]) === 20 ? 20 : 10);
  removeMacroLeftovers(doc);
  await placeSignatures(zip, doc, signatures);
  // Extra pages go before the end-of-program 6 Minute Walk, which stays the last form.
  const lastForm = findParagraph(doc, END_WALK_TITLE);
  for (const page of pages) appendPage(doc, page, lastForm);

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  await fillBoundData(zip, values);
  await addHeaderPatientLine(zip, values);
  // A filled copy is a document, not a template.
  const ctPath = '[Content_Types].xml';
  const ct = await zip.file(ctPath).async('string');
  zip.file(ctPath, ct.replace('wordprocessingml.template.main+xml', 'wordprocessingml.document.main+xml'));

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}

// ---------- control filling ----------

function setText(sdt, pr, text, multiline) {
  const ph = child(pr, W, 'showingPlcHdr');
  if (ph) pr.removeChild(ph);
  const content = child(sdt, W, 'sdtContent');
  const runs = kids(content, W, 'r');
  const doc = sdt.ownerDocument;
  const run = runs[0] || content.appendChild(doc.createElementNS(W, 'w:r'));
  runs.slice(1).forEach((r) => content.removeChild(r));
  [...run.childNodes].forEach((n) => { if (n.localName !== 'rPr') run.removeChild(n); });
  const lines = multiline ? text.split(/\r?\n/) : [text.replace(/\s*\r?\n\s*/g, ' ')];
  lines.forEach((line, i) => {
    if (i > 0) run.appendChild(doc.createElementNS(W, 'w:br'));
    const t = doc.createElementNS(W, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = line;
    run.appendChild(t);
  });
}

function setCheckbox(sdt, pr, checked) {
  const cb = child(pr, W14, 'checkbox');
  child(cb, W14, 'checked').setAttributeNS(W14, 'w14:val', checked ? '1' : '0');
  const state = child(cb, W14, checked ? 'checkedState' : 'uncheckedState');
  const symbol = String.fromCodePoint(parseInt(state.getAttributeNS(W14, 'val'), 16));
  const t = child(sdt, W, 'sdtContent').getElementsByTagNameNS(W, 't')[0];
  if (t) t.textContent = symbol;
}

// Patient name/age/sex/dates are bound to a custom XML part; Word refreshes the
// bound controls from it when the file opens, so it has to carry the same values.
async function fillBoundData(zip, values) {
  const path = 'customXml/item1.xml';
  const file = zip.file(path);
  if (!file) return;
  const xml = parseXml(await file.async('string'));
  const map = { name: 'pt_name', age: 'pt_age', birthday: 'pt_birthday', date: 'pt_date', sex: 'pt_sex' };
  for (const [node, tag] of Object.entries(map)) {
    const el = xml.documentElement.getElementsByTagNameNS('urn:thsc:cardiacrehab', node)[0];
    const v = values[tag];
    if (el && v) el.textContent = schema[tag]?.kind === 'date' ? isoToUs(v) : String(v);
  }
  zip.file(path, new XMLSerializer().serializeToString(xml));
}

// Puts "Patient: NAME   Age: 45   Enrolled: 10/27/2026" under the clinic header, so every
// page (continuation pages included) shows whose record it is.
async function addHeaderPatientLine(zip, values) {
  if (!values.pt_name) return;
  const parts = [
    ['Patient', values.pt_name],
    ['Age', values.pt_age],
    ['Enrolled', isoToUs(values.pt_date)],
  ].filter(([, v]) => v);
  for (const path of Object.keys(zip.files).filter((f) => /^word\/header\d*\.xml$/.test(f))) {
    const hdr = parseXml(await zip.file(path).async('string'));
    const anchor = [...hdr.getElementsByTagNameNS(W, 't')].find((t) => t.textContent.includes('CARDIAC REHABILITATION PROGRAM'));
    if (!anchor) continue;
    const runs = [];
    parts.forEach(([label, value], i) => {
      if (i) runs.push(run(hdr, '      ', { sz: 17 }));
      runs.push(run(hdr, `${label}: `, { b: true, sz: 17 }), run(hdr, String(value), { sz: 17 }));
    });
    const line = el(hdr, 'p', {},
      el(hdr, 'pPr', {},
        el(hdr, 'pBdr', {}, el(hdr, 'bottom', { val: 'single', sz: 4, space: 2, color: 'BFBFBF' })),
        el(hdr, 'spacing', { before: 40, after: 0 }),
        el(hdr, 'jc', { val: 'center' })),
      runs);
    const p = ancestor(anchor, W, 'p');
    p.parentNode.insertBefore(line, p.nextSibling);
    zip.file(path, new XMLSerializer().serializeToString(hdr));
  }
}

// Each 6 Minute Walk page prints "(x 10 meters)" after its lap count.
function setLapLength(doc, lapsTag, meters) {
  if (meters === 10) return;
  const sdt = controls(doc).find((c) => attr(child(child(c, W, 'sdtPr'), W, 'tag'), 'val') === lapsTag);
  const p = sdt && ancestor(sdt, W, 'p');
  if (!p) return;
  for (const t of p.getElementsByTagNameNS(W, 't')) {
    if (t.textContent.includes('(x 10 meters)')) t.textContent = t.textContent.replace('(x 10 meters)', `(x ${meters} meters)`);
  }
}

// The template's SAVE / CALCULATE buttons call macros a .dotx cannot carry.
// The app does both jobs, so the buttons and their hints come out of the filled copy.
function removeMacroLeftovers(doc) {
  const paras = new Set();
  for (const it of [...doc.getElementsByTagNameNS(W, 'instrText')]) {
    if (/MACROBUTTON/.test(it.textContent)) paras.add(ancestor(it, W, 'p'));
  }
  for (const t of [...doc.getElementsByTagNameNS(W, 't')]) {
    if (/filled in automatically when saving/.test(t.textContent)) paras.add(ancestor(t, W, 'p'));
  }
  for (const p of paras) {
    if (!p) continue;
    // A table cell must end in a paragraph, so inside cells only empty it.
    if (p.parentNode.localName === 'tc') {
      [...p.childNodes].forEach((n) => { if (n.localName !== 'pPr') p.removeChild(n); });
    } else {
      p.parentNode.removeChild(p);
    }
  }
}

// ---------- extra pages ----------

// Builds a page in the template's style (centered bold title, black-ruled tables with a
// beige header row) before the end-of-program 6 Minute Walk. page: { title, subtitle, info: [[[label, value], …], …],
// groups: [{ heading, rows: [[question, answer], …] }], outcome: { title, detail }, note }
const PAGE_WIDTH = 10386;
const HEADER_FILL = 'F3E7C6';
const GOLD = 'C9971C';

function appendPage(doc, page, before = null) {
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const ref = before || [...body.children].find((c) => c.localName === 'sectPr');
  const add = (node) => body.insertBefore(node, ref);
  const P = (runs, opts) => para(doc, runs, opts);
  const R = (text, opts) => run(doc, text, opts);

  add(P([R(page.title, { b: true, sz: 30 })], { pageBreak: true, keepNext: true, align: 'center', before: 60, after: 60 }));
  if (page.subtitle) add(P([R(page.subtitle, { sz: 17, color: '666666' })], { align: 'center', after: 200 }));
  for (const line of page.info || []) {
    const runs = [];
    line.forEach(([label, value], i) => {
      if (i) runs.push(R('      '));
      runs.push(R(`${label}: `, { b: true }), R(value));
    });
    add(P(runs, { after: 100 }));
  }
  for (const g of page.groups || []) {
    add(P([], { after: 60 }));
    add(table(doc, g));
  }
  add(P([R('Screening outcome', { b: true, sz: 22 })], { before: 280, after: 80, keepNext: true }));
  add(P([R(page.outcome.title, { b: true, sz: 22 })], { shade: HEADER_FILL, leftBar: GOLD, keepNext: !!page.outcome.detail, after: 0 }));
  if (page.outcome.detail) add(P([R(page.outcome.detail)], { shade: HEADER_FILL, leftBar: GOLD, after: 0 }));
  if (page.note) add(P([R(page.note, { i: true, sz: 16, color: '666666' })], { before: 240 }));
}

function table(doc, group) {
  const widths = [PAGE_WIDTH - 1800, 1800];
  const border = (name) => el(doc, name, { val: 'single', sz: 4, space: 0, color: '000000' });
  const cell = (text, i, { header = false } = {}) => el(doc, 'tc', {},
    el(doc, 'tcPr', {},
      el(doc, 'tcW', { w: widths[i], type: 'dxa' }),
      header ? el(doc, 'shd', { val: 'clear', color: 'auto', fill: HEADER_FILL }) : null,
      el(doc, 'vAlign', { val: 'center' })),
    para(doc, [run(doc, text, { b: header, sz: 19 })], { align: i ? 'center' : null, after: 0 }));
  const row = (cells, header) => el(doc, 'tr', {},
    el(doc, 'trPr', {}, el(doc, 'cantSplit'), header ? el(doc, 'tblHeader') : el(doc, 'trHeight', { val: 400, hRule: 'atLeast' })),
    cells.map((t, i) => cell(t, i, { header })));
  return el(doc, 'tbl', {},
    el(doc, 'tblPr', {},
      el(doc, 'tblW', { w: PAGE_WIDTH, type: 'dxa' }),
      el(doc, 'tblBorders', {}, ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border)),
      el(doc, 'tblLayout', { type: 'fixed' }),
      el(doc, 'tblCellMar', {}, el(doc, 'top', { w: 40, type: 'dxa' }), el(doc, 'left', { w: 80, type: 'dxa' }), el(doc, 'bottom', { w: 40, type: 'dxa' }), el(doc, 'right', { w: 80, type: 'dxa' }))),
    el(doc, 'tblGrid', {}, widths.map((w) => el(doc, 'gridCol', { w }))),
    row([group.heading, 'Answer'], true),
    group.rows.map((r) => row(r, false)));
}

function para(doc, runs, { align = null, before = 0, after = 100, pageBreak = false, keepNext = false, shade = null, leftBar = null } = {}) {
  // Child order follows the schema: keepNext, pageBreakBefore, pBdr, shd, spacing, jc.
  const pPr = el(doc, 'pPr', {},
    keepNext ? el(doc, 'keepNext') : null,
    pageBreak ? el(doc, 'pageBreakBefore') : null,
    leftBar ? el(doc, 'pBdr', {}, el(doc, 'left', { val: 'single', sz: 24, space: 8, color: leftBar })) : null,
    shade ? el(doc, 'shd', { val: 'clear', color: 'auto', fill: shade }) : null,
    el(doc, 'spacing', { before, after }),
    align ? el(doc, 'jc', { val: align }) : null);
  return el(doc, 'p', {}, pPr, runs);
}

function run(doc, text, { b = false, i = false, sz = 20, color = null } = {}) {
  const t = doc.createElementNS(W, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.textContent = text;
  return el(doc, 'r', {},
    el(doc, 'rPr', {}, b ? el(doc, 'b') : null, i ? el(doc, 'i') : null, color ? el(doc, 'color', { val: color }) : null,
      el(doc, 'sz', { val: sz }), el(doc, 'szCs', { val: sz })),
    t);
}

function el(doc, name, attrs = {}, ...children) {
  const e = doc.createElementNS(W, `w:${name}`);
  for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, `w:${k}`, String(v));
  for (const c of children.flat(Infinity)) if (c) e.appendChild(c);
  return e;
}

// ---------- signatures ----------

const SIGNATURE_LINES = {
  participant: 'Date and Signature of Participant',
  witness: 'Date and Signature of Witness',
  dasi: 'Patient Signature:',
};

async function placeSignatures(zip, doc, signatures) {
  const relsPath = 'word/_rels/document.xml.rels';
  const rels = parseXml(await zip.file(relsPath).async('string'));
  let docPrId = 5000;
  for (const [key, label] of Object.entries(SIGNATURE_LINES)) {
    const sig = signatures[key];
    if (!sig?.png) continue;
    const p = findParagraph(doc, label);
    if (!p) continue;
    const { bytes, width, height } = await decodePng(sig.png);
    const name = `signature_${key}.png`;
    zip.file(`word/media/${name}`, bytes);
    const rId = `rIdSig_${key}`;
    const rel = rels.createElementNS(rels.documentElement.namespaceURI, 'Relationship');
    rel.setAttribute('Id', rId);
    rel.setAttribute('Type', REL_IMAGE);
    rel.setAttribute('Target', `media/${name}`);
    rels.documentElement.appendChild(rel);

    // Replace the underscore tab with the signature image and the signing date.
    const tabRun = [...kids(p, W, 'r')].find((r) => child(r, W, 'tab'));
    const heightEmu = 457200 * 1.1; // ~0.5 in tall
    const widthEmu = Math.round((heightEmu * width) / height);
    const drawing = parseXml(drawingXml(rId, docPrId++, name, widthEmu, Math.round(heightEmu))).documentElement;
    const imgRun = doc.importNode(drawing, true);
    const dateRun = textRun(doc, sig.date ? `   ${isoToUs(sig.date)}` : '');
    if (tabRun) {
      p.replaceChild(imgRun, tabRun);
    } else {
      p.appendChild(imgRun);
    }
    p.insertBefore(dateRun, imgRun.nextSibling);
    // Keep a signature line under the image.
    let pPr = child(p, W, 'pPr');
    if (!pPr) pPr = p.insertBefore(doc.createElementNS(W, 'w:pPr'), p.firstChild);
    const bdr = parseXml(`<w:pBdr xmlns:w="${W}"><w:bottom w:val="single" w:sz="4" w:space="1" w:color="000000"/></w:pBdr>`).documentElement;
    // Schema order: pBdr comes before tabs/spacing.
    const after = child(pPr, W, 'tabs') || child(pPr, W, 'spacing');
    pPr.insertBefore(doc.importNode(bdr, true), after);
    if (key === 'dasi') {
      const ind = parseXml(`<w:ind xmlns:w="${W}" w:right="${10386 - 6000}"/>`).documentElement;
      pPr.appendChild(doc.importNode(ind, true));
    }
  }
  zip.file(relsPath, new XMLSerializer().serializeToString(rels));
}

function drawingXml(rId, id, name, cx, cy) {
  return `<w:r xmlns:w="${W}" xmlns:r="${R}"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${name}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function textRun(doc, text) {
  const r = doc.createElementNS(W, 'w:r');
  const t = doc.createElementNS(W, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.textContent = text;
  r.appendChild(t);
  return r;
}

async function decodePng(dataUrl) {
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  // PNG IHDR: width/height are big-endian uint32 at offsets 16 and 20.
  const view = new DataView(bytes.buffer);
  return { bytes, width: view.getUint32(16), height: view.getUint32(20) };
}

function findParagraph(doc, label) {
  for (const t of doc.getElementsByTagNameNS(W, 't')) {
    if (t.textContent.trim() === label.trim()) return ancestor(t, W, 'p');
  }
  return null;
}

// ---------- xml helpers ----------

function parseXml(s) {
  const d = new DOMParser().parseFromString(s, 'application/xml');
  const err = d.getElementsByTagName('parsererror')[0];
  if (err) throw new Error(`Template XML could not be read: ${err.textContent}`);
  return d;
}
function controls(doc) {
  // Inline content controls only; the template has no block-level ones.
  return [...doc.getElementsByTagNameNS(W, 'sdt')].filter((s) => child(child(s, W, 'sdtPr'), W, 'tag'));
}
function child(el, ns, name) {
  if (!el) return null;
  for (const c of el.children) if (c.namespaceURI === ns && c.localName === name) return c;
  return null;
}
function kids(el, ns, name) {
  return [...el.children].filter((c) => c.namespaceURI === ns && c.localName === name);
}
function attr(el, name) {
  return el ? el.getAttributeNS(W, name) : null;
}
function ancestor(el, ns, name) {
  let n = el.parentNode;
  while (n && !(n.namespaceURI === ns && n.localName === name)) n = n.parentNode;
  return n;
}
