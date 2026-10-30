// Program summary computed from every patient record on this device.
import { h } from './dom.js';
import { isoToUs } from './template.js';
import { programStatus, statusLabel, sessionsDone, SESSIONS, DROPOUT_REASONS, hasHypertension } from './forms.js';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sexOf = (f) => (f.pt_sex === 'Male' || f.pt_sex === 'Female' ? f.pt_sex : null);

// 6MWD at enrollment / end of program: the Treatment Plan figure, else that 6 Minute Walk test's result.
export const walkInitial = (f) => num(f.itp_6mwt_initial) ?? num(f.smwt_total);
export const walkEnd = (f) => num(f.itp_6mwt_end) ?? num(f.smwte_total);

export function summarize(patients) {
  const rows = patients.map((p) => ({ p, f: p.fields, status: programStatus(p.fields) }));
  const bySex = (sex) => rows.filter((r) => sexOf(r.f) === sex);
  const ages = (rs) => rs.map((r) => num(r.f.pt_age)).filter((a) => a !== null);
  const initial = rows.map((r) => walkInitial(r.f)).filter((v) => v !== null);
  const end = rows.map((r) => walkEnd(r.f)).filter((v) => v !== null);
  const paired = rows.filter((r) => walkInitial(r.f) !== null && walkEnd(r.f) !== null);
  return {
    total: rows.length,
    male: bySex('Male').length,
    female: bySex('Female').length,
    sexUnknown: rows.filter((r) => !sexOf(r.f)).length,
    age: { all: ages(rows), male: ages(bySex('Male')), female: ages(bySex('Female')) },
    completed: rows.filter((r) => r.status === 'completed').length,
    dropped: rows.filter((r) => r.status === 'dropped').length,
    // Listed in the form's order, then any reason not on the list, then "not recorded".
    dropoutReasons: (() => {
      const counts = new Map();
      for (const r of rows.filter((x) => x.status === 'dropped')) {
        const key = r.f.dropout_reason || 'Reason not recorded';
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const order = (k) => (k === 'Reason not recorded' ? 1e9 : DROPOUT_REASONS.indexOf(k) === -1 ? 1e6 : DROPOUT_REASONS.indexOf(k));
      return [...counts].sort((a, b) => order(a[0]) - order(b[0]));
    })(),
    hypertension: {
      all: rows.filter((r) => hasHypertension(r.f)).length,
      male: bySex('Male').filter((r) => hasHypertension(r.f)).length,
      female: bySex('Female').filter((r) => hasHypertension(r.f)).length,
    },
    active: rows.filter((r) => r.status === 'active').length,
    walk: {
      initial,
      end,
      change: paired.map((r) => walkEnd(r.f) - walkInitial(r.f)),
    },
  };
}

const fmt1 = (v) => (v === null ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const fmt0 = (v) => (v === null ? '—' : String(Math.round(v)));
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const signed = (v) => (v === null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}`);

function tile(label, value, unit, rows = [], note = '') {
  return h('section.stat',
    h('h3.stat-label', label),
    h('p.stat-value', value, unit && value !== '—' ? h('span.stat-unit', unit) : null),
    rows.length ? h('dl.stat-rows', rows.map(([k, v]) => [h('dt', k), h('dd', v)])) : null,
    note ? h('p.stat-note', note) : null);
}

function walkFigure(label, values) {
  const v = fmt0(mean(values));
  return h('div',
    h('span.stat-sub', label),
    h('p.stat-value', v, v !== '—' ? h('span.stat-unit', 'm') : null),
    h('span.stat-note', `n = ${values.length}`));
}

export function renderDashboard(all, { from, to, onFilter, onExport }) {
  const inRange = all.filter((p) => {
    const d = p.fields.pt_date || '';
    return (!from || d >= from) && (!to || (d && d <= to));
  });
  const s = summarize(inRange);
  const n = (xs) => `n = ${xs.length}`;

  const fromInput = h('input.input', { type: 'date', value: from || '', onchange: (e) => onFilter({ from: e.target.value, to }) });
  const toInput = h('input.input', { type: 'date', value: to || '', onchange: (e) => onFilter({ from, to: e.target.value }) });
  const filters = h('div.dash-filters',
    h('label.field', h('span.label', 'Enrolled from'), fromInput),
    h('label.field', h('span.label', 'to'), toInput),
    (from || to) ? h('button.btn.btn-ghost', { type: 'button', onclick: () => onFilter({ from: '', to: '' }) }, 'All dates') : null,
    h('button.btn.btn-ghost', { type: 'button', onclick: () => onExport(inRange), disabled: !inRange.length }, 'Export CSV'));

  const tiles = h('div.stats',
    tile('Total enrolled', String(s.total), '', [['Male', String(s.male)], ['Female', String(s.female)], ...(s.sexUnknown ? [['Sex not recorded', String(s.sexUnknown)]] : [])]),
    tile('Average age', fmt1(mean(s.age.all)), 'yrs', [['Male', `${fmt1(mean(s.age.male))} yrs`], ['Female', `${fmt1(mean(s.age.female))} yrs`]], n(s.age.all)),
    tile('Completed', String(s.completed), '', [['Of enrolled', pct(s.completed, s.total)], ['Still in program', String(s.active)]]),
    tile('Dropped out', String(s.dropped), '', [['Of enrolled', pct(s.dropped, s.total)], ...s.dropoutReasons.map(([k, v]) => [k, String(v)])]),
    tile('Hypertension', String(s.hypertension.all), '', [
      ['Of enrolled', pct(s.hypertension.all, s.total)],
      ['Male', String(s.hypertension.male)],
      ['Female', String(s.hypertension.female)],
    ], 'Ticked under Co-morbidities in the Treatment Plan.'),
    h('section.stat.stat-wide',
      h('h3.stat-label', '6MWD average'),
      h('div.stat-pair',
        walkFigure('Initial', s.walk.initial),
        walkFigure('End of program', s.walk.end)),
      h('dl.stat-rows', h('dt', 'Average change'), h('dd', s.walk.change.length ? `${signed(mean(s.walk.change))} m (${n(s.walk.change)} with both)` : 'Needs patients with both values'))));

  const table = inRange.length ? h('div.table-wrap', h('table.dash-table',
    h('thead', h('tr', ['Patient', 'Sex', 'Age', 'Enrolled', 'Status', 'Hypertension', 'Sessions', '6MWD initial', '6MWD end'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', inRange
      .slice()
      .sort((a, b) => (b.fields.pt_date || '').localeCompare(a.fields.pt_date || ''))
      .map((p) => {
        const f = p.fields;
        return h('tr',
          h('td', h('a', { href: `#/patient/${encodeURIComponent(p.id)}` }, f.pt_name || 'Unnamed patient')),
          h('td', f.pt_sex || '—'),
          h('td.numcell', f.pt_age || '—'),
          h('td', isoToUs(f.pt_date) || '—'),
          h('td', statusLabel(programStatus(f)), programStatus(f) === 'dropped' && f.dropout_reason ? h('span.cell-note', f.dropout_reason) : null),
          h('td', hasHypertension(f) ? 'Yes' : '—'),
          h('td.numcell', `${sessionsDone(f)}/${SESSIONS}`),
          h('td.numcell', fmt0(walkInitial(f))),
          h('td.numcell', fmt0(walkEnd(f))));
      })))) : h('div.empty', h('p', all.length ? 'No patients enrolled in this date range.' : 'No patients yet.'));

  return h('div.dashboard', filters, tiles, h('h2.section-title', `Patients (${inRange.length})`), table);
}

export function toCsv(patients) {
  const cols = [
    ['Patient', (f) => f.pt_name || ''],
    ['Sex', (f) => f.pt_sex || ''],
    ['Age', (f) => f.pt_age || ''],
    ['Enrolled', (f) => isoToUs(f.pt_date)],
    ['Status', (f) => statusLabel(programStatus(f))],
    ['Dropout reason', (f) => (programStatus(f) === 'dropped' ? f.dropout_reason || '' : '')],
    ['Dropout details', (f) => (programStatus(f) === 'dropped' ? f.dropout_details || '' : '')],
    ['Hypertension', (f) => (hasHypertension(f) ? 'Yes' : 'No')],
    ['Sessions done', (f) => sessionsDone(f)],
    ['6MWD initial (m)', (f) => walkInitial(f) ?? ''],
    ['6MWD end (m)', (f) => walkEnd(f) ?? ''],
    ['DASI total', (f) => f.dasi_total || ''],
    ['METs', (f) => f.dasi_mets || ''],
  ];
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [cols.map(([k]) => k).join(',')];
  for (const p of patients) lines.push(cols.map(([, fn]) => esc(fn(p.fields))).join(','));
  return lines.join('\r\n');
}
