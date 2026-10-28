// Loads the Word template, reads its content controls, and produces a filled .docx.
/* global JSZip */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const TEMPLATE_URL = 'template/THSC_Cardiac_Rehab_Forms_BLANK.dotx';

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
  return options.find((o) => parseFloat(o) === n) ?? null;
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
export async function buildDocx(values, signatures = {}) {
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

  setLapLength(doc, Number(values.smwt_lap_length) === 20 ? 20 : 10);
  removeMacroLeftovers(doc);
  await placeSignatures(zip, doc, signatures);

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  await fillBoundData(zip, values);
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

// The 6 Minute Walk page prints "(x 10 meters)" after the lap count.
function setLapLength(doc, meters) {
  if (meters === 10) return;
  for (const t of doc.getElementsByTagNameNS(W, 't')) {
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
