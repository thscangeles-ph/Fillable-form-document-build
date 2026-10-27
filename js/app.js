import { h, todayIso } from './dom.js';
import { loadTemplate, buildDocx, isoToUs } from './template.js';
import { listPatients, getPatient, savePatient, deletePatient, newPatient, importPatients } from './store.js';
import { initInstall, installButton } from './install.js';
import { TABS, field, derive, ageFrom, sessionsDone, dasiScore, SESSIONS, statusField, programStatus, statusLabel } from './forms.js';
import { renderDashboard, toCsv } from './dashboard.js';

const main = document.getElementById('main');
const statusEl = document.getElementById('save-status');
let schema = null;
let teardown = null;

// ---------- save status ----------

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusEl.querySelector('.status-text').textContent = text;
}

// ---------- routing ----------

async function route() {
  if (teardown) await teardown();
  teardown = null;
  const [, page, id, tab] = location.hash.split('/');
  window.scrollTo(0, 0);
  if (page === 'patient' && id) return showPatient(decodeURIComponent(id), tab);
  if (page === 'dashboard') return showDashboard();
  return showList();
}

const viewSwitch = (active) => h('nav.view-switch', { 'aria-label': 'Views' },
  h('a', { href: '#/', 'aria-current': active === 'list' ? 'page' : null }, 'Patients'),
  h('a', { href: '#/dashboard', 'aria-current': active === 'dashboard' ? 'page' : null }, 'Dashboard'));

// ---------- dashboard ----------

const dashFilter = { from: '', to: '' };

async function showDashboard() {
  setStatus('idle', 'Saved on this device');
  const patients = await listPatients();
  const body = h('div');
  const render = () => body.replaceChildren(renderDashboard(patients, {
    ...dashFilter,
    onFilter: (f) => { Object.assign(dashFilter, f); render(); },
    onExport: (rows) => download(new Blob([`\ufeff${toCsv(rows)}`], { type: 'text/csv' }), `THSC Cardiac Rehab summary ${todayIso()}.csv`),
  }));
  render();
  main.replaceChildren(h('div.page',
    viewSwitch('dashboard'),
    h('div.list-head', h('h1.page-title', 'Dashboard')),
    body,
    h('p.fine.center', 'Calculated from the patient records on this device. To include other tablets, import their backups here first.'),
  ));
}

// ---------- patient list ----------

async function showList() {
  setStatus('idle', 'Saved on this device');
  const patients = (await listPatients()).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  const search = h('input.input.search', { type: 'search', placeholder: 'Search patients…', 'aria-label': 'Search patients' });
  const list = h('div.patient-list');

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const rows = patients.filter((p) => (p.fields.pt_name || '').toLowerCase().includes(q));
    if (!patients.length) {
      list.replaceChildren(h('div.empty', h('h3', 'No patients yet'), h('p', 'Add a patient to start their cardiac rehab forms.')));
      return;
    }
    if (!rows.length) {
      list.replaceChildren(h('div.empty', h('p', 'No patient matches that search.')));
      return;
    }
    list.replaceChildren(...rows.map((p) => {
      const f = p.fields;
      const done = sessionsDone(f);
      return h('a.patient-row', { href: `#/patient/${encodeURIComponent(p.id)}` },
        h('div.pr-name',
          h('strong', f.pt_name || 'Unnamed patient'),
          h('span.muted', [f.pt_age && `${f.pt_age} yrs`, f.pt_sex].filter(Boolean).join(' · ') || '—',
            programStatus(f) !== 'active' ? h('span.status-chip', { 'data-status': programStatus(f) }, statusLabel(programStatus(f))) : null)),
        h('div.pr-meta', h('span.label', 'Enrolled'), h('span', isoToUs(f.pt_date) || '—')),
        h('div.pr-progress',
          h('span.label', 'Sessions'),
          h('div.bar', h('span', { style: `width:${(done / SESSIONS) * 100}%` })),
          h('span.count', `${done}/${SESSIONS}`)),
        h('span.chev', '›'));
    }));
  };
  search.addEventListener('input', render);
  render();

  const importInput = h('input', { type: 'file', accept: 'application/json,.json,text/plain,.txt', hidden: true, onchange: onImport });

  main.replaceChildren(h('div.page',
    viewSwitch('list'),
    h('div.list-head',
      h('h1.page-title', 'Patients'),
      h('div.actions',
        installButton(),
        canShareFiles() ? h('button.btn.btn-ghost', { type: 'button', onclick: shareBackup }, 'Share backup') : null,
        h('button.btn.btn-ghost', { type: 'button', onclick: exportAll }, 'Export backup'),
        h('button.btn.btn-ghost', { type: 'button', onclick: () => importInput.click() }, 'Import backup'),
        importInput,
        h('button.btn.btn-primary', { type: 'button', onclick: createPatient }, '+ New patient'))),
    search,
    list,
    h('p.fine.center', 'Patient records are stored in this browser on this device. Use Share backup or Export backup to copy them to another device, then Import backup there.'),
  ));
  search.focus();
}

async function createPatient() {
  const p = newPatient();
  await savePatient(p);
  location.hash = `#/patient/${encodeURIComponent(p.id)}/consent`;
}

async function backupJson() {
  return JSON.stringify({ app: 'thsc-cardiac-rehab', version: 1, exported: new Date().toISOString(), patients: await listPatients() });
}

async function exportAll() {
  download(new Blob([await backupJson()], { type: 'application/json' }), `THSC Cardiac Rehab backup ${todayIso()}.json`);
}

// Phone/tablet share sheet (Bluetooth, Quick Share, AirDrop, email…). Browsers only
// allow sharing a short list of file types, so the backup goes out as a .txt file.
const shareFile = (text) => new File([text], `THSC Cardiac Rehab backup ${todayIso()}.txt`, { type: 'text/plain' });

function canShareFiles() {
  try {
    return !!navigator.canShare?.({ files: [shareFile('{}')] });
  } catch {
    return false;
  }
}

async function shareBackup() {
  try {
    await navigator.share({ files: [shareFile(await backupJson())], title: 'THSC Cardiac Rehab backup' });
  } catch (err) {
    if (err.name !== 'AbortError') toast(`Could not share: ${err.message}`, true);
  }
}

async function onImport(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.patients;
    if (!Array.isArray(list)) throw new Error('Not a backup file');
    const r = await importPatients(list);
    const parts = [`${r.added} new`, `${r.updated} updated`];
    if (r.kept) parts.push(`${r.kept} already up to date here`);
    toast(`Backup imported: ${parts.join(', ')}`);
    route();
  } catch (err) {
    toast(`Could not import: ${err.message}`, true);
  }
}

// ---------- patient page ----------

async function showPatient(id, tabId) {
  const patient = await getPatient(id);
  if (!patient) {
    main.replaceChildren(h('div.page', h('div.empty', h('h3', 'Patient not found'), h('a.btn.btn-ghost', { href: '#/' }, '← Patients'))));
    return;
  }
  const tab = TABS.find((t) => t.id === tabId) || TABS[0];
  const fields = patient.fields;
  const watchers = [];
  let saveTimer = null;
  let pending = null;

  const persist = async () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    setStatus('saving', 'Saving…');
    try {
      pending = savePatient(patient);
      await pending;
      setStatus('ok', 'Up to date');
    } catch (err) {
      setStatus('error', 'Not saved');
      toast(`Could not save: ${err.message}`, true);
    }
  };
  const scheduleSave = () => {
    setStatus('saving', 'Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  };

  const ctx = {
    schema,
    fields,
    signatures: patient.signatures,
    state: (showPatient.state ||= {}),
    watch(fn) { watchers.push(fn); fn(); },
    set(tag, value, { quiet = false } = {}) {
      if (value === '' || value === false) delete fields[tag];
      else fields[tag] = value;
      if (!quiet) ctx.changed();
    },
    changed() {
      for (const [k, v] of Object.entries(derive(fields))) {
        if (v === '') delete fields[k];
        else fields[k] = v;
      }
      watchers.forEach((fn) => fn());
      scheduleSave();
    },
    sig(key, value) {
      if (value) patient.signatures[key] = value;
      else delete patient.signatures[key];
      watchers.forEach((fn) => fn());
      scheduleSave();
    },
  };

  const title = h('h1.patient-title');
  ctx.watch(() => { title.textContent = fields.pt_name || 'New patient'; });

  // Header fields shared by every form.
  const birthday = field(ctx, 'pt_birthday', 'Birthday');
  birthday.querySelector('input').addEventListener('change', (e) => {
    const age = ageFrom(e.target.value);
    if (!age) return;
    document.getElementById('f_pt_age').value = age;
    ctx.set('pt_age', age);
  });
  const header = h('section.card.patient-fields',
    field(ctx, 'pt_name', 'Patient name', { cls: 'grow' }),
    field(ctx, 'pt_age', 'Age', { suffix: 'yrs', inputmode: 'numeric' }),
    field(ctx, 'pt_sex', 'Sex'),
    birthday,
    field(ctx, 'pt_date', 'Date enrolled'),
    statusField(ctx));
  header.querySelector('#f_pt_name').addEventListener('input', (e) => {
    const el = e.target;
    const caret = el.selectionStart;
    el.value = el.value.toUpperCase();
    el.setSelectionRange(caret, caret);
    ctx.set('pt_name', el.value);
  });

  const tabs = h('nav.tabs', { role: 'tablist' });
  ctx.watch(() => tabs.replaceChildren(...TABS.map((t) => h('a.tab-link', {
    href: `#/patient/${encodeURIComponent(id)}/${t.id}`, role: 'tab', 'aria-selected': String(t.id === tab.id),
  }, t.label, tabBadge(t.id, fields, patient)))));

  main.replaceChildren(h('div.page',
    h('div.patient-head',
      h('a.btn.btn-ghost.back', { href: '#/' }, '← Patients'),
      title,
      h('div.actions',
        h('button.btn.btn-primary', { type: 'button', onclick: () => downloadWord(patient, fields) }, 'Download Word'),
        h('button.btn.btn-danger', { type: 'button', onclick: () => removePatient(patient, () => clearTimeout(saveTimer)) }, 'Delete'))),
    header,
    tabs,
    h('div.tab-panel', { role: 'tabpanel' }, tab.render(ctx)),
  ));

  const selected = tabs.querySelector('[aria-selected="true"]');
  if (selected) tabs.scrollLeft = selected.offsetLeft - tabs.offsetLeft - 16;

  // Bring older records' calculated fields up to date without marking them dirty.
  Object.assign(fields, Object.fromEntries(Object.entries(derive(fields)).filter(([, v]) => v !== '')));
  setStatus('ok', 'Up to date');

  teardown = async () => {
    if (saveTimer) await persist();
    else if (pending) await pending.catch(() => {});
  };
}

function tabBadge(id, f, p) {
  let done = false;
  if (id === 'consent') done = !!(p.signatures.participant && p.signatures.witness);
  if (id === 'dasi') done = dasiScore(f).answered === 12;
  if (id === 'walk') done = !!f.smwt_total;
  if (id === 'plan') done = !!(f.itp_cardiologist && f.gad2_total && f.phq2_total);
  if (id === 'sessions') return h('span.badge', `${sessionsDone(f)}/${SESSIONS}`);
  return done ? h('span.badge.ok', { 'aria-label': 'complete' }, '✓') : null;
}

async function downloadWord(patient, fields) {
  const btn = document.activeElement;
  try {
    if (btn) btn.disabled = true;
    const blob = await buildDocx(fields, patient.signatures);
    const name = (fields.pt_name || 'Patient').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const date = isoToUs(fields.pt_date || todayIso()).replace(/\//g, '-');
    download(blob, `${name} - ${date}.docx`);
  } catch (err) {
    toast(`Could not create the Word file: ${err.message}`, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function removePatient(patient, cancelSave) {
  const name = patient.fields.pt_name || 'this patient';
  if (!confirm(`Delete ${name} and all of their forms from this device? This cannot be undone.`)) return;
  cancelSave();
  teardown = null;
  await deletePatient(patient.id);
  toast(`Deleted ${name}`);
  location.hash = '#/';
}

// ---------- utilities ----------

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function toast(text, isError = false) {
  const t = h('div.toast', { class: isError ? 'error' : null, role: 'status' }, text);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

// ---------- boot ----------

(async function boot() {
  initInstall(toast);
  try {
    schema = await loadTemplate();
  } catch (err) {
    main.replaceChildren(h('div.page', h('div.empty', h('h3', 'Could not start'), h('p', err.message), h('p.muted', 'Open the app through a web server (not as a file), e.g. python3 -m http.server.'))));
    return;
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => {
    if (statusEl.dataset.state === 'saving') e.preventDefault();
  });
  route();
})();
