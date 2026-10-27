// The five tabs. Every input is keyed by the Word template's content-control tag.
import { h, todayIso } from './dom.js';
import { matchOption } from './template.js';
import { signaturePad } from './signature.js';

export const DASI_WEIGHTS = [2.75, 1.75, 2.75, 5.5, 8.0, 2.7, 3.5, 8.0, 4.5, 5.25, 6.0, 7.5];
const DASI_QUESTIONS = [
  'Can you take care of yourself (eating, dressing, bathing or using the toilet)?',
  'Can you walk indoors such as around your house?',
  'Can you walk a block or two on level ground?',
  'Can you climb a flight of stairs or walk up a hill?',
  'Can you run a short distance?',
  'Can you do light work around the house like dusting or washing dishes?',
  'Can you do moderate work around the house like vacuuming, sweeping floors, or carrying in groceries?',
  'Can you do heavy work around the house like scrubbing floors or lifting and moving heavy furniture?',
  'Can you do yard work like raking leaves, weeding, or pushing a power mower?',
  'Can you have sexual relations?',
  'Can you participate in moderate recreational activities like golf, bowling, dancing, doubles tennis, or throwing a baseball or football?',
  'Can you participate in strenuous sports like swimming, singles tennis, football, basketball, or skiing?',
];

const CONSENT = [
  ['1. Explanation of Outpatient Cardiac Rehabilitation Program', 'You will be placed in a rehabilitation program that will include physical exercises, educational activities, and other health-related services. The levels of exercise that you will undertake will be based on your cardiovascular response to an exercise test and other clinical information. You will be given clear instructions regarding the amount and kind of regular exercise you should do. The program staff, depending on your progress, may adjust your exercise sessions. This program is 12 sessions in duration, and you will undergo a reevaluation with a graded exercise test after the completion of the rehabilitation program as deemed needed by the Cardiac Rehabilitation Specialist. Other tests may be recommended as needed.'],
  ['2. Monitoring Your Vital Signs.', 'Your vital signs will be monitored as required. You agree to have your blood pressure, pulse rate, and oxygen saturation taken before, during, and after each exercise session by program staff members. You agree to report to the rehabilitation staff any unusual or worsened symptoms associated with your exercise program. These include, but are not limited to, unusual shortness of breath with low level activity, pain, pressure, tightness, unusually fast, slow or irregular heart rate, faintness or dizziness.'],
  ['3. Participant Risks and Discomforts.', 'There exists the possibility of certain changes occurring during exercise sessions. These include abnormal blood pressure response, fainting, irregular, fast or slow heart rhythm, and in very rare instances, heart attack (1 per 294,000 hours of exercise), stroke, or death (1 per 784,000 hours of exercise). Every effort will be made to minimize those risks by provision of appropriate exercise instruction and supervision. Emergency equipment and trained personnel are available to deal with unusual situations that may arise.'],
  ['4. Benefits to be Expected.', 'Exercise has been recommended as a routine part of the treatment for all heart patients and has been shown to have several benefits including improvement in physical capacity, risk factors for heart disease and likely longevity. Overall, the benefits of exercise far outweigh the risks. Participation in the rehabilitation program may help to evaluate which activities you may safely engage in during your daily life. No assurance can be given that the rehabilitation program will increase your exercise tolerance, although considerable evidence shows improvement is usually achieved.'],
  ['5. Responsibility of the Participant', 'To promote your safety and gain benefit, you must give priority to regular attendance and adherence to the prescribed intensity, duration, frequency, progression, and type of activity. To achieve the best possible care:', {
    'DO NOT:': [
      'Withhold any information pertinent to symptoms from any staff member.',
      'Exceed your target heart rate.',
      'Exercise when you do not feel well.',
      'Exercise within 2 hours after eating or using tobacco products or alcohol.',
      'Use extremely hot water during showering after exercise.',
    ],
    'DO:': [
      'Report any unusual symptoms that you experience before, during, or after exercise. (You may help assure the safety and well-being of others in the program if you would also report any unusual symptoms you notice in others.)',
      'Follow, without exception, all recommendations made by staff concerning the limits on any exercise, weight control, or health-related activities that you may be encouraged to do and document by recordings.',
    ],
  }],
  ['6. Use of Medical Records', 'The information that is obtained while you are a participant in the Cardiac Rehabilitation Program will be treated as privileged and confidential. It is not to be released or revealed to any person except your referring physician without your written consent. The information obtained, however, may be used for statistical analysis or scientific purposes with your right to privacy retained. Your exercise progress may be shared with your family members or significant others with your permission.'],
  ['7. Inquiries', 'Any questions about the rehabilitation program are welcome. If you have any doubts or questions, please ask us for further explanation. You can contact us in person or by phone # 09177136573 (THSC Concierge).'],
  ['8. Freedom of Consent', 'I agree to voluntarily participate in the Cardiac Rehabilitation Program. I understand that I am free to deny any consent if I so desire, both now and at any point in the program. I acknowledge that I have read this form in its entirety or it has been read to me, and I understand my responsibility in the Rehabilitation Program in which I will be engaged. I accept the risks, rules, and regulations set forth and I understand and appreciate the consequences of my decision. Knowing these, and having had an opportunity to ask questions which have been answered to my satisfaction, I consent to treatment and participation in this Rehabilitation Program.'],
];

const SAFETY_NOTE = 'I understand that for safety reasons, I am not to begin exercising without staff supervision. I will phone The Heart Specialists Clinic and Diagnostic Center Concierge and/or the Cardiac Rehabilitation Staff to notify of absence. (* We have patients waiting to enter the class and have to abide by attention to attendance.) The staff understands that due to other medical concerns or issues, it may be necessary for me to be absent.';

const INDICATIONS = ['Post Coronary Artery Bypass and Grafting', 'Post Acute Coronary Syndrome', 'Heart Failure', 'Post Percutaneous Coronary Intervention', 'Chronic Stable Angina', 'Post Valvular Heart Surgery'];
const COMORBIDITIES = ['Hypertension', 'Diabetes', 'Dyslipidemia', 'Chronic Kidney disease', 'COPD/ASTHMA', 'Cerebrovascular disease', 'Peripheral Artery disease'];
const GAD2 = ['Feeling nervous, anxious or on edge', 'Not being able to stop or control worrying'];
const PHQ2 = ['Little interest or pleasure in doing things', 'Feeling down, depressed or hopeless'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const SESSIONS = 12;
export const sessionKey = (n) => `s${String(n).padStart(2, '0')}`;

export const TABS = [
  { id: 'consent', label: 'Informed Consent', render: consentTab },
  { id: 'dasi', label: 'DASI', render: dasiTab },
  { id: 'walk', label: '6 Minute Walk', render: walkTab },
  { id: 'plan', label: 'Treatment Plan', render: planTab },
  { id: 'sessions', label: 'Exercise Sessions', render: sessionsTab },
];

// ---------- derived values (the template's CALCULATE / save macros) ----------

const fmt = (n, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);

function radioValue(f, prefix, choices) {
  const hit = choices.find((c) => f[`${prefix}_${c}`] === true);
  return hit === undefined ? null : hit;
}

export function dasiScore(f) {
  let total = 0;
  let answered = 0;
  for (let i = 1; i <= 12; i++) {
    if (f[`dasi_yes_${i}`] === true) { total += DASI_WEIGHTS[i - 1]; answered++; } else if (f[`dasi_no_${i}`] === true) answered++;
  }
  return { total, answered };
}

function screenTotal(f, prefix) {
  const a = radioValue(f, `${prefix}_q1`, [0, 1, 2, 3]);
  const b = radioValue(f, `${prefix}_q2`, [0, 1, 2, 3]);
  return a === null || b === null ? null : a + b;
}

function bmi(f) {
  let ht = parseFloat(f.itp_height);
  const wt = parseFloat(f.itp_weight);
  if (!(ht > 0 && wt > 0)) return null;
  if (ht > 3) ht /= 100; // typed in cm
  return wt / (ht * ht);
}

function walkTotal(f) {
  const laps = parseFloat(f.smwt_laps);
  if (Number.isNaN(laps)) return null;
  return laps * 10 + (parseFloat(f.smwt_partial) || 0);
}

// Values the template expects to be calculated; empty string clears a stale result.
export function derive(f) {
  const out = {};
  const d = dasiScore(f);
  if (d.answered === 12) {
    const vo2 = 0.43 * d.total + 9.6;
    out.dasi_total = fmt(d.total);
    out.dasi_vo2 = `${fmt(vo2)} mL/kg/min`;
    out.dasi_mets = fmt(vo2 / 3.5);
  } else {
    out.dasi_total = out.dasi_vo2 = out.dasi_mets = '';
  }
  const w = walkTotal(f);
  out.smwt_total = w === null ? '' : String(w);
  const g = screenTotal(f, 'gad2');
  out.gad2_total = g === null ? '' : String(g);
  const p = screenTotal(f, 'phq2');
  out.phq2_total = p === null ? '' : String(p);
  const b = bmi(f);
  out.itp_bmi = b === null ? '' : fmt(b, 1);
  return out;
}

export function sessionsDone(f) {
  let n = 0;
  for (let i = 1; i <= SESSIONS; i++) if (f[`${sessionKey(i)}_date`]) n++;
  return n;
}

export function ageFrom(birthIso, onIso = todayIso()) {
  if (!birthIso) return '';
  const [by, bm, bd] = birthIso.split('-').map(Number);
  const [y, m, d] = onIso.split('-').map(Number);
  let age = y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
  return age >= 0 && age < 130 ? String(age) : '';
}

// ---------- field widgets ----------
// ctx: { schema, fields, set(tag, value), sig(key, value), signatures, watch(fn) }

const BIG_LIST = 25; // longer dropdowns become number inputs

export function field(ctx, tag, label, opt = {}) {
  const info = ctx.schema[tag] || { kind: 'text' };
  const val = ctx.fields[tag] ?? '';
  let input;
  if (info.kind === 'date') {
    input = h('input.input', { type: 'date', value: val, onchange: (e) => ctx.set(tag, e.target.value) });
  } else if (info.kind === 'dropdown' && info.options.length <= BIG_LIST) {
    input = h('select.input',
      { onchange: (e) => ctx.set(tag, e.target.value) },
      h('option', { value: '' }, '—'),
      info.options.map((o) => h('option', { value: o, selected: o === val }, o)));
  } else if (info.kind === 'dropdown') {
    const nums = info.options.map(parseFloat).filter((n) => !Number.isNaN(n));
    const step = nums.some((n) => !Number.isInteger(n)) ? '0.1' : '1';
    input = h('input.input.num', {
      type: 'number', inputmode: step === '1' ? 'numeric' : 'decimal', step,
      min: Math.min(...nums), max: Math.max(...nums), value: val === '' ? '' : parseFloat(val),
      oninput: (e) => {
        const ok = e.target.value === '' || matchOption(info.options, e.target.value) !== null;
        e.target.classList.toggle('invalid', !ok);
        e.target.title = ok ? '' : `Allowed: ${info.options[0]} – ${info.options[info.options.length - 1]}`;
        ctx.set(tag, e.target.value);
      },
    });
  } else if (opt.multiline) {
    input = h('textarea.input', { rows: opt.rows || 3, oninput: (e) => ctx.set(tag, e.target.value) });
    input.value = val;
  } else {
    input = h('input.input', { type: 'text', value: val, placeholder: opt.placeholder || '', inputmode: opt.inputmode, oninput: (e) => ctx.set(tag, e.target.value) });
  }
  input.id = `f_${tag}`;
  input.dataset.tag = tag;
  const control = opt.suffix ? h('div.with-suffix', input, h('span.suffix', opt.suffix)) : input;
  if (label === null) return control;
  return h('label.field', { class: opt.cls || null, for: input.id }, h('span.label', label), control);
}

function bp(ctx, prefix, label) {
  return h('div.field', { class: 'bp' },
    label ? h('span.label', label) : null,
    h('div.bp-pair', field(ctx, `${prefix}_sys`, null), h('span.slash', '/'), field(ctx, `${prefix}_dia`, null), h('span.suffix', 'mmHg')));
}

function check(ctx, tag, label) {
  const input = h('input', { type: 'checkbox', checked: ctx.fields[tag] === true, onchange: (e) => ctx.set(tag, e.target.checked) });
  input.dataset.tag = tag;
  return h('label.check', input, h('span.box'), h('span', label));
}

// A row of mutually exclusive choices stored as the template's separate checkboxes.
function segmented(ctx, prefix, choices, labels = choices) {
  const group = h('div.seg', { role: 'radiogroup' });
  const buttons = choices.map((c, i) => {
    const tag = `${prefix}_${c}`;
    const b = h('button.seg-btn', {
      type: 'button', role: 'radio', 'aria-checked': String(ctx.fields[tag] === true),
      onclick: () => {
        const turnOn = ctx.fields[tag] !== true;
        for (const other of choices) ctx.set(`${prefix}_${other}`, turnOn && other === c, { quiet: true });
        buttons.forEach((bb, j) => bb.setAttribute('aria-checked', String(turnOn && j === i)));
        ctx.changed();
      },
    }, labels[i]);
    b.dataset.tag = tag;
    return b;
  });
  group.append(...buttons);
  return group;
}

function computed(ctx, label, fn, cls = '') {
  const value = h('output.computed-value');
  const note = h('span.computed-note');
  const box = h('div.computed', { class: cls || null }, h('span.label', label), value, note);
  ctx.watch(() => {
    const [v, n = '', flag = false] = fn();
    value.textContent = v === '' || v == null ? '—' : v;
    note.textContent = n;
    box.classList.toggle('flag', !!flag);
  });
  return box;
}

const card = (title, ...children) => h('section.card', title ? h('h3.card-title', title) : null, ...children);
const intro = (title, text) => h('header.tab-intro', h('h2', title), h('p', text));
const grid = (cols, ...children) => h('div.grid', { style: `--cols:${cols}` }, ...children);
const gridTop = (cols, ...children) => h('div.grid.top', { style: `--cols:${cols}` }, ...children);

// ---------- tabs ----------

function consentTab(ctx) {
  const consent = h('div.consent');
  for (const [head, body, lists] of CONSENT) {
    consent.append(h('p', h('strong', head), ' ', body));
    if (lists) {
      for (const [k, items] of Object.entries(lists)) {
        consent.append(h('p.list-head', h('strong', k)), h('ul', items.map((t) => h('li', t))));
      }
    }
  }

  const daysInput = () => document.getElementById('f_attend_days');
  const chips = WEEKDAYS.map((d) => h('button.chip', {
    type: 'button',
    onclick: (e) => {
      e.currentTarget.classList.toggle('on');
      const picked = [...e.currentTarget.parentNode.querySelectorAll('.chip.on')].map((c) => c.textContent);
      const text = picked.length > 1 ? `${picked.slice(0, -1).join(', ')} and ${picked[picked.length - 1]}` : picked.join('');
      daysInput().value = text;
      ctx.set('attend_days', text);
    },
  }, d));
  const current = String(ctx.fields.attend_days || '');
  chips.forEach((c) => c.classList.toggle('on', current.includes(c.textContent)));

  const suggestEnd = () => {
    const f = ctx.fields;
    const weeks = parseInt(f.program_weeks, 10);
    if (!f.start_date || !(weeks > 0) || f.end_date) return;
    const d = new Date(`${f.start_date}T00:00:00`);
    d.setDate(d.getDate() + weeks * 7);
    const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const el = document.getElementById('f_end_date');
    if (el) el.value = iso;
    ctx.set('end_date', iso);
  };
  ctx.watch(suggestEnd);

  return h('div.tab',
    intro('Informed Consent for Participation', 'Let the patient read the consent, fill in the program schedule, then sign on the tablet.'),
    h('section.card', h('h3.card-title', 'Consent text (sections 1–8)'), consent),
    card('Program schedule',
      h('div.field', h('span.label', 'I understand that I will regularly attend classes on'), h('div.chips', chips), field(ctx, 'attend_days', null, { placeholder: 'e.g. Monday, Wednesday and Friday' })),
      grid(3,
        field(ctx, 'program_weeks', 'Program length', { suffix: 'weeks', inputmode: 'numeric' }),
        field(ctx, 'start_date', 'Start date'),
        field(ctx, 'end_date', 'Estimated end date')),
      h('p.muted', 'Classes run from 9:00am to 12:00nn.'),
      h('p.fine', SAFETY_NOTE)),
    card('Signatures',
      h('div.sig-grid',
        signaturePad({ label: 'Participant', value: ctx.signatures.participant, onChange: (v) => ctx.sig('participant', v) }),
        signaturePad({ label: 'Witness', value: ctx.signatures.witness, onChange: (v) => ctx.sig('witness', v) })),
      h('p.muted', 'The participant\'s printed name comes from the patient name above.')),
  );
}

function dasiTab(ctx) {
  const rows = DASI_QUESTIONS.map((q, i) => h('div.q-row',
    h('span.q-num', String(i + 1)),
    h('span.q-text', q),
    segmented(ctx, `dasi`, [`yes_${i + 1}`, `no_${i + 1}`], [`Yes · ${fmt(DASI_WEIGHTS[i])}`, 'No · 0'])));

  return h('div.tab',
    intro('Duke Activity Status Index (DASI)', 'A self-administered questionnaire that measures functional capacity and gives a rough estimate of peak oxygen uptake. Tap Yes or No for each question.'),
    card(null, h('div.q-list', rows)),
    card('Score',
      grid(3,
        computed(ctx, 'Total score (DASI)', () => {
          const d = dasiScore(ctx.fields);
          return d.answered === 12 ? [fmt(d.total)] : [fmt(d.total), `${d.answered} of 12 answered`];
        }),
        computed(ctx, 'Estimated peak VO2 = 0.43 × DASI + 9.6', () => [ctx.fields.dasi_vo2 || '', ctx.fields.dasi_vo2 ? '' : 'Answer all 12']),
        computed(ctx, 'METs = peak VO2 ÷ 3.5', () => [ctx.fields.dasi_mets || '']))),
    card('Signature',
      h('div.sig-grid', signaturePad({ label: 'Patient', value: ctx.signatures.dasi, onChange: (v) => ctx.sig('dasi', v) })),
      h('p.muted', 'If the patient is unable to complete the form:'),
      grid(2, field(ctx, 'dasi_completed_by', 'Completed by'), field(ctx, 'dasi_relationship', 'Relationship to patient'))),
    h('p.fine', 'Reference: Hlatky MA, Boineau RE, et al. A brief self-administered questionnaire to determine functional capacity (The Duke Activity Status Index). Am J Cardiol. 1989; 64:651-654.'),
  );
}

function walkTab(ctx) {
  const vitals = (phase, label) => h('div.vitals-col',
    h('h4', label),
    bp(ctx, `smwt_bp_${phase}`, 'Blood pressure'),
    field(ctx, `smwt_hr_${phase}`, 'Heart rate', { suffix: 'bpm' }),
    field(ctx, `smwt_o2_${phase}`, 'O2 saturation'));

  return h('div.tab',
    intro('6 Minute Walk Test Results', 'Record baseline vitals, run the test, then record end-of-test vitals and the distance walked.'),
    card('Patient measurements', grid(2,
      field(ctx, 'smwt_height', 'Height', { placeholder: 'e.g. 1.70 m' }),
      field(ctx, 'smwt_weight', 'Weight', { placeholder: 'e.g. 72 kg' }))),
    card('Vital signs', h('div.vitals', vitals('baseline', 'Baseline'), vitals('end', 'End of test'))),
    card('During the test',
      grid(2,
        field(ctx, 'smwt_stopped', 'Stopped or paused before 6 minutes?'),
        field(ctx, 'smwt_stop_reason', 'If yes, reason')),
      field(ctx, 'smwt_symptoms', 'Other symptoms at end of test')),
    card('Distance',
      grid(3,
        field(ctx, 'smwt_laps', 'Number of laps', { suffix: '× 10 m' }),
        field(ctx, 'smwt_partial', 'Final partial lap'),
        computed(ctx, 'Total distance in 6 minutes', () => [ctx.fields.smwt_total ? `${ctx.fields.smwt_total} m` : '', 'laps × 10 + partial lap'], 'accent'))),
  );
}

function screenCard(ctx, title, prefix, questions) {
  return card(title,
    h('p.muted', 'Over the last 2 weeks, how often have you been bothered by the following?'),
    h('div.q-list', questions.map((q, i) => h('div.q-row.stack',
      h('span.q-num', String(i + 1)),
      h('span.q-text', q),
      segmented(ctx, `${prefix}_q${i + 1}`, [0, 1, 2, 3], ['0 · Not at all', '1 · Several days', '2 · Over half the days', '3 · Nearly every day'])))),
    computed(ctx, 'Total score (0–6)', () => {
      const v = ctx.fields[`${prefix}_total`];
      return [v, v !== '' && v != null && Number(v) >= 3 ? 'Score of 3 or more: positive screen' : '', Number(v) >= 3];
    }));
}

function planTab(ctx) {
  const sixMinute = h('button.btn.btn-ghost.btn-sm', {
    type: 'button',
    onclick: () => {
      const v = ctx.fields.smwt_total;
      if (!v) return;
      document.getElementById('f_itp_6mwt_initial').value = v;
      ctx.set('itp_6mwt_initial', v);
    },
  });
  ctx.watch(() => {
    const v = ctx.fields.smwt_total;
    sixMinute.textContent = v ? `Use 6MWT result (${v} m)` : 'No 6MWT result yet';
    sixMinute.disabled = !v;
  });

  return h('div.tab',
    intro('Individualized Treatment Plan', 'Clinical summary at enrollment, with anxiety and depression screening.'),
    card(null, field(ctx, 'itp_cardiologist', 'Attending cardiologist')),
    h('div.two-col',
      h('div',
        card('Cardiac rehabilitation indication', h('p.muted', 'Check all that apply'), h('div.checks', INDICATIONS.map((t, i) => check(ctx, `itp_ind_${i + 1}`, t)))),
        card('Co-morbidities', h('p.muted', 'Check all that apply'), h('div.checks', COMORBIDITIES.map((t, i) => check(ctx, `itp_comorb_${i + 1}`, t))),
          grid(2, field(ctx, 'itp_smoker', 'Smoker'), field(ctx, 'itp_pack_years', 'If yes, pack years', { inputmode: 'decimal' })),
          field(ctx, 'itp_family_hx', 'Family history of cardiovascular disease?')),
        card('Complete diagnosis', field(ctx, 'itp_diagnosis', null, { multiline: true, rows: 3 }))),
      h('div',
        card('Initial physical examination',
          grid(3,
            field(ctx, 'itp_height', 'Height', { suffix: 'm', inputmode: 'decimal' }),
            field(ctx, 'itp_weight', 'Weight', { suffix: 'kg', inputmode: 'decimal' }),
            computed(ctx, 'BMI', () => [ctx.fields.itp_bmi || ''])),
          grid(2, bp(ctx, 'itp_bp', 'Blood pressure'), field(ctx, 'itp_hr', 'Heart rate', { suffix: 'bpm' })),
          field(ctx, 'itp_pe_findings', 'Significant physical examination findings', { multiline: true, rows: 3 })),
        card('6 minute walk test distance',
          gridTop(2,
            h('div', field(ctx, 'itp_6mwt_initial', 'Initial', { suffix: 'meters', inputmode: 'numeric' }), sixMinute),
            field(ctx, 'itp_6mwt_end', 'End of program', { suffix: 'meters', inputmode: 'numeric' }))),
        card(null, field(ctx, 'itp_thr', 'Target heart rate', { suffix: 'bpm' })))),
    h('div.two-col',
      screenCard(ctx, 'General Anxiety Disorder score (GAD-2)', 'gad2', GAD2),
      screenCard(ctx, 'Patient Health Questionnaire (PHQ-2)', 'phq2', PHQ2)),
  );
}

function sessionsTab(ctx) {
  const holder = h('div');
  const pills = h('div.pills', { role: 'tablist' });
  let active = ctx.state.session || firstOpenSession(ctx.fields);

  const refreshPills = () => {
    pills.replaceChildren(...Array.from({ length: SESSIONS }, (_, i) => {
      const n = i + 1;
      const k = sessionKey(n);
      const has = !!ctx.fields[`${k}_date`];
      return h('button.pill', {
        type: 'button', role: 'tab', 'aria-selected': String(n === active), class: has ? 'done' : null,
        onclick: () => { active = n; ctx.state.session = n; refreshPills(); show(); },
      }, h('span', `Session ${n}`), has ? h('small', shortDate(ctx.fields[`${k}_date`])) : null);
    }));
  };
  const show = () => holder.replaceChildren(sessionForm(ctx, active));
  ctx.watch(refreshPills);
  show();

  return h('div.tab',
    intro('Exercise Monitoring Sheet', 'One entry per session. A session counts as done once its date is filled in.'),
    pills, holder);
}

function firstOpenSession(f) {
  for (let i = 1; i <= SESSIONS; i++) if (!f[`${sessionKey(i)}_date`]) return i;
  return SESSIONS;
}

function shortDate(iso) {
  const [, m, d] = iso.split('-');
  return `${m}/${d}`;
}

function sessionForm(ctx, n) {
  const k = sessionKey(n);
  const vit = (ex, phase) => h('div.vit',
    bp(ctx, `${k}_${ex}_${phase}_bp`, 'BP'),
    grid(2, field(ctx, `${k}_${ex}_${phase}_hr`, 'HR', { suffix: 'bpm' }), field(ctx, `${k}_${ex}_${phase}_o2`, 'O2 sat')));
  const exercise = (ex, title, extras) => h('div.ex',
    h('div.ex-head', h('h4', title), h('div.ex-extras', extras)),
    h('div.ex-vitals',
      h('div', h('span.phase', 'Prior to start'), vit(ex, 'pre')),
      h('div', h('span.phase', 'After exercise'), vit(ex, 'post'))));

  const today = h('button.btn.btn-ghost.btn-sm', {
    type: 'button',
    onclick: () => { const v = todayIso(); document.getElementById(`f_${k}_date`).value = v; ctx.set(`${k}_date`, v); },
  }, 'Today');

  return h('div.session',
    card(`Session ${n}`, h('div.grid.session-top', { style: '--cols:3' },
      h('div.date-today', field(ctx, `${k}_date`, 'Date'), today),
      field(ctx, `${k}_weight`, 'Weight', { suffix: 'kg', inputmode: 'decimal' }),
      field(ctx, `${k}_therapist`, 'Cardiac Rehab Nurse / Physical Therapist'))),
    card('Exercise',
      exercise('cal', 'Calisthenics — upper & lower extremities', [field(ctx, `${k}_cal_sets`, 'Sets'), field(ctx, `${k}_cal_weights`, 'Weights')]),
      exercise('tm', 'Treadmill', [field(ctx, `${k}_tm_duration`, 'Duration', { suffix: 'min' }), field(ctx, `${k}_tm_speed`, 'Speed', { suffix: 'km/h' })]),
      exercise('bike', 'Bicycle', [field(ctx, `${k}_bike_duration`, 'Duration', { suffix: 'min' }), field(ctx, `${k}_bike_resistance`, 'Resistance')])),
    h('div.two-col',
      card('Remarks',
        field(ctx, `${k}_borg`, 'Borg scale (6–20)'),
        h('div.checks', check(ctx, `${k}_sym_chest`, 'Chest heaviness'), check(ctx, `${k}_sym_sob`, 'Shortness of breath'), check(ctx, `${k}_sym_dizzy`, 'Dizziness'), check(ctx, `${k}_sym_palp`, 'Palpitation'))),
      card('Discharge vitals',
        bp(ctx, `${k}_dc_bp`, 'Blood pressure'),
        grid(2, field(ctx, `${k}_dc_hr`, 'Heart rate', { suffix: 'bpm' }), field(ctx, `${k}_dc_o2`, 'O2 sat')))),
  );
}

// ---------- program status (app-only; not part of the Word template) ----------

export const STATUSES = [
  { id: 'active', label: 'In program' },
  { id: 'completed', label: 'Completed' },
  { id: 'dropped', label: 'Dropped out' },
];

// Staff can set the status; otherwise all 12 sessions dated means completed.
export function programStatus(f) {
  if (STATUSES.some((s) => s.id === f.program_status)) return f.program_status;
  return sessionsDone(f) === SESSIONS ? 'completed' : 'active';
}

export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label || id;

export function statusField(ctx) {
  const select = h('select.input', {
    id: 'f_program_status',
    onchange: (e) => ctx.set('program_status', e.target.value),
  }, STATUSES.map((s) => h('option', { value: s.id }, s.label)));
  ctx.watch(() => { select.value = programStatus(ctx.fields); });
  return h('label.field', { for: select.id }, h('span.label', 'Program status'), select);
}

export const DROPOUT_REASONS = [
  'Medical / health condition',
  'Financial',
  'Transportation / distance',
  'Work or schedule conflict',
  'Moved / relocated',
  'Lost to follow-up',
  'Personal / family reasons',
  'Other',
];

// Shown under the patient header only while the status is Dropped out.
export function dropoutFields(ctx) {
  const reason = h('select.input', {
    id: 'f_dropout_reason',
    onchange: (e) => ctx.set('dropout_reason', e.target.value),
  }, h('option', { value: '' }, '— Select a reason —'), DROPOUT_REASONS.map((r) => h('option', { value: r, selected: ctx.fields.dropout_reason === r }, r)));
  const details = h('input.input', {
    id: 'f_dropout_details', type: 'text', value: ctx.fields.dropout_details || '',
    placeholder: 'Details (optional)', oninput: (e) => ctx.set('dropout_details', e.target.value),
  });
  const row = h('div.dropout-row',
    h('label.field', { for: reason.id }, h('span.label', 'Dropout reason'), reason),
    h('label.field.grow', { for: details.id }, h('span.label', 'Details'), details));
  ctx.watch(() => { row.hidden = programStatus(ctx.fields) !== 'dropped'; });
  return row;
}

export const hasHypertension = (f) => f.itp_comorb_1 === true;
