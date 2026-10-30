// Builds the patient's forms as a PDF on the device with pdfmake, laid out like the
// Word template: clinic header and patient line on every page, page numbers, the same
// forms in the same order. Nothing leaves the device.
/* global pdfMake */
import { isoToUs, matchOption, loadTemplate } from './template.js';
import {
  CONSENT, SAFETY_NOTE, DASI_QUESTIONS, DASI_WEIGHTS, INDICATIONS, COMORBIDITIES, GAD2, PHQ2,
  SESSIONS, sessionKey, lapLength, heartShieldPage, SYMPTOMS, WALK_INITIAL, WALK_END,
} from './forms.js';

const GOLD = '#C9971C';
const GOLD_TEXT = '#8A6510';
const HEADER_FILL = '#F3E7C6';
const MUTED = '#666666';
const PAGE_W = 595.28;
const MARGIN_X = 38;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

// ---------- loading (pdfmake and fonts are only fetched the first time a PDF is made) ----------

let ready = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

async function fileBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function loadPdfTools() {
  ready ||= (async () => {
    if (!window.pdfMake) await loadScript('vendor/pdfmake.min.js');
    const [regular, bold, italic, logo] = await Promise.all([
      fileBase64('assets/fonts/Arimo-Regular.ttf'),
      fileBase64('assets/fonts/Arimo-Bold.ttf'),
      fileBase64('assets/fonts/Arimo-Italic.ttf'),
      fileBase64('assets/logo.png'),
    ]);
    pdfMake.vfs = { 'Arimo-Regular.ttf': regular, 'Arimo-Bold.ttf': bold, 'Arimo-Italic.ttf': italic };
    pdfMake.fonts = { Arimo: { normal: 'Arimo-Regular.ttf', bold: 'Arimo-Bold.ttf', italics: 'Arimo-Italic.ttf', bolditalics: 'Arimo-Bold.ttf' } };
    return { logo: `data:image/png;base64,${logo}` };
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

// ---------- small building blocks ----------

const LAYOUT = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => '#000000',
  vLineColor: () => '#000000',
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 2.5,
  paddingBottom: () => 2.5,
};

const title = (text, first = false) => ({ text, bold: true, fontSize: 15, alignment: 'center', margin: [0, 2, 0, 10], pageBreak: first ? undefined : 'before' });
const label = (text) => ({ text, bold: true });
const head = (text) => ({ text, bold: true, fillColor: HEADER_FILL });
// A row of "Label: value" pairs.
const line = (pairs, opts = {}) => ({
  text: pairs.flatMap(([l, v], i) => [i ? '      ' : '', { text: `${l}: `, bold: opts.boldLabels !== false }, v || '']),
  margin: [0, 0, 0, 5],
});
// ☐ / ☒ drawn as vectors (Arimo has no ballot-box glyphs).
const box = (checked, size = 7.5) => ({
  width: size + 5,
  canvas: [
    { type: 'rect', x: 0, y: 1.5, w: size, h: size, lineWidth: 0.6, lineColor: '#000000' },
    ...(checked ? [
      { type: 'line', x1: 1.2, y1: 2.7, x2: size - 1.2, y2: size + 0.3, lineWidth: 0.8 },
      { type: 'line', x1: size - 1.2, y1: 2.7, x2: 1.2, y2: size + 0.3, lineWidth: 0.8 },
    ] : []),
  ],
});
const checkRow = (checked, text, fontSize) => ({ columns: [box(checked), { text, fontSize }], columnGap: 2, margin: [8, 0, 0, 2] });
const radio = (on) => ({ text: on ? '●' : '○', fontSize: 10 });

function signatureLine(text, sig, width = CONTENT_W) {
  const image = sig?.png ? { image: sig.png, height: 32, width: 96 } : { text: ' ', margin: [0, 20, 0, 0] };
  return {
    margin: [0, 14, 0, 4],
    stack: [
      { columns: [
        { text, width: 'auto', margin: [0, 22, 6, 0] },
        { width: 110, stack: [image] },
        { text: sig?.date ? isoToUs(sig.date) : '', width: '*', margin: [10, 22, 0, 0] },
      ] },
      { canvas: [{ type: 'line', x1: 0, y1: 1, x2: width, y2: 1, lineWidth: 0.6 }] },
    ],
  };
}

// ---------- the document ----------

/** patient: the stored record ({ fields, signatures }). Returns a PDF Blob. */
export async function buildPdf(patient) {
  const [{ logo }, schema] = await Promise.all([loadPdfTools(), loadTemplate()]);
  const f = patient.fields;
  const sig = patient.signatures || {};

  // A field as the Word file would show it: dates as MM/DD/YYYY, dropdowns as their list text.
  const v = (tag, blank = '') => {
    const raw = f[tag];
    if (raw === undefined || raw === null || raw === '') return blank;
    const info = schema[tag];
    if (info?.kind === 'date') return isoToUs(raw);
    if (info?.kind === 'dropdown') return matchOption(info.options, raw) ?? String(raw);
    return String(raw);
  };
  const bp = (prefix) => `${v(`${prefix}_sys`)} / ${v(`${prefix}_dia`)}`;
  const blank = '______________';

  const content = [
    ...consentPages(f, sig, v, blank),
    ...dasiPage(f, sig, v),
    ...walkPage(f, v, bp, WALK_INITIAL, '6 Minute Walk Test Results', 'pt_date'),
    ...planPage(f, v, bp),
    ...sessionPages(f, v, bp),
    ...heartShieldPages(f),
    ...walkPage(f, v, bp, WALK_END, '6 Minute Walk Test Results — End of Program', `${WALK_END}_date`),
  ];

  const patientLine = [['Patient', f.pt_name], ['Age', f.pt_age], ['Enrolled', isoToUs(f.pt_date)]].filter(([, x]) => x);
  const doc = {
    pageSize: 'A4',
    pageMargins: [MARGIN_X, 112, MARGIN_X, 46],
    info: { title: `${f.pt_name || 'Patient'} - THSC Cardiac Rehabilitation Program`, author: 'The Heart Specialists Clinic and Diagnostic Center' },
    defaultStyle: { font: 'Arimo', fontSize: 9.5, lineHeight: 1.12 },
    header: () => ({
      margin: [MARGIN_X, 20, MARGIN_X, 0],
      stack: [
        { columns: [
          { image: logo, width: 38 },
          { width: '*', margin: [6, 24, 0, 0], stack: [
            { text: 'The Heart Specialists Clinic and Diagnostic Center', bold: true, fontSize: 15.5 },
            { canvas: [{ type: 'line', x1: 0, y1: 2, x2: CONTENT_W - 44, y2: 2, lineWidth: 1.4, lineColor: GOLD }] },
          ] },
        ] },
        { text: 'CARDIAC REHABILITATION PROGRAM', bold: true, color: GOLD_TEXT, fontSize: 10.5, alignment: 'center', margin: [0, 4, 0, 0] },
        patientLine.length && f.pt_name ? {
          text: patientLine.flatMap(([l, x], i) => [i ? '      ' : '', { text: `${l}: `, bold: true }, x]),
          fontSize: 8.5, alignment: 'center', margin: [0, 2, 0, 1],
        } : null,
        f.pt_name ? { canvas: [{ type: 'line', x1: 0, y1: 1, x2: CONTENT_W, y2: 1, lineWidth: 0.5, lineColor: '#BFBFBF' }] } : null,
      ].filter(Boolean),
    }),
    footer: (page, pages) => ({
      margin: [MARGIN_X, 18, MARGIN_X, 0],
      columns: [
        { text: 'THSC Cardiac Rehabilitation Program', fontSize: 7.5, color: MUTED },
        { text: `Page ${page} of ${pages}`, fontSize: 7.5, color: MUTED, alignment: 'right' },
      ],
    }),
    content,
  };

  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(doc, { form: LAYOUT }).getBlob(resolve);
    } catch (err) {
      reject(err);
    }
  });
}

// ---------- forms ----------

function consentPages(f, sig, v, blank) {
  const out = [
    title('Informed Consent for Participation', true),
    line([['NAME', v('pt_name')], ['Age', v('pt_age')], ['Birthday', v('pt_birthday')]], { boldLabels: false }),
    { ...line([['DATE', v('pt_date')], ['Sex', v('pt_sex')]], { boldLabels: false }), margin: [0, 0, 0, 10] },
  ];
  const para = (children) => ({ text: children, alignment: 'justify', margin: [0, 0, 0, 6], fontSize: 9 });
  CONSENT.forEach(([heading, body, lists], i) => {
    out.push(para([{ text: heading, bold: true }, ' ', body]));
    if (lists) {
      for (const [k, items] of Object.entries(lists)) {
        out.push({ text: k, bold: true, fontSize: 9, margin: [20, 0, 0, 2] });
        out.push({ ul: items, fontSize: 9, margin: [34, 0, 0, 4] });
      }
    }
    if (i === 4) {
      // Section 5 ends with the program schedule, as on the paper form.
      out.push({ stack: [
        { text: ['I understand that I will regularly attend classes on ', { text: v('attend_days', blank), bold: !!f.attend_days }, '.'] },
        { text: ['My program will be ', v('program_weeks', '____'), ' weeks long. My start date is ', v('start_date', blank), ' and my estimated end date is ', v('end_date', blank), '. I know that classes will begin at 9:00am to 12:00nn.'], margin: [0, 4, 0, 0] },
        { text: SAFETY_NOTE, alignment: 'justify', margin: [0, 4, 0, 0] },
      ], fontSize: 9, margin: [20, 2, 0, 8] });
    }
  });
  out.push(
    signatureLine('Date and Signature of Participant', sig.participant),
    { text: ['Name of Participant (Print) ', v('pt_name')], margin: [0, 6, 0, 0] },
    signatureLine('Date and Signature of Witness', sig.witness),
  );
  return out;
}

function dasiPage(f, sig, v) {
  const rows = DASI_QUESTIONS.map((q, i) => {
    const n = i + 1;
    return [
      { text: String(n), alignment: 'center' },
      q,
      { columns: [{ ...radio(f[`dasi_yes_${n}`] === true), width: 12 }, { text: DASI_WEIGHTS[i].toFixed(2) }], alignment: 'center' },
      { columns: [{ ...radio(f[`dasi_no_${n}`] === true), width: 12 }, { text: '0' }] },
    ];
  });
  const total = (text, value) => [{ text, bold: true, colSpan: 2 }, {}, { text: value, colSpan: 2, alignment: 'center' }, {}];
  return [
    title('Duke Activity Status Index (DASI)'),
    { ...line([['Name', v('pt_name')], ['Age', v('pt_age')], ['Date', v('pt_date')]]), bold: true },
    { text: "The Duke Activity Status Index (DASI) is a self-administered questionnaire that measures a patient's functional capacity. It can be used to get a rough estimate of a patient's peak oxygen uptake.", margin: [0, 2, 0, 3] },
    { text: 'Instructions: Click the circle under Yes or No for each question.', bold: true, margin: [0, 0, 0, 5] },
    {
      layout: 'form',
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [30, '*', 62, 46],
        body: [
          [head('Item'), head('Activity'), { ...head('Yes'), alignment: 'center' }, { ...head('No'), alignment: 'center' }],
          ...rows,
          total('Total Score (DASI) =', v('dasi_total')),
          total('Estimated peak VO2 = 0.43 x (DASI) + 9.6 =', v('dasi_vo2')),
          total('METs = (peak VO2 / 3.5) =', v('dasi_mets')),
        ],
      },
    },
    signatureLine('Patient Signature:', sig.dasi, 300),
    { ...line([['Completed by', v('dasi_completed_by')], ['Relationship to patient', v('dasi_relationship')]], { boldLabels: false }), margin: [0, 8, 0, 0] },
    { text: '(if patient unable to complete)', italics: true, fontSize: 8, margin: [0, 0, 0, 12] },
    { text: 'Reference: Hlatky MA, Boineau RE, et al. A brief self-administered questionnaire to determine functional capacity (The Duke Activity Status Index). Am J Cardiol. 1989; 64:651-654.', fontSize: 7.5, color: MUTED },
  ];
}

// p: 'smwt' (at enrollment) or 'smwte' (end of program); dateTag: the date printed beside the name.
function walkPage(f, v, bp, p, heading, dateTag) {
  const row = (name, base, end) => [name, { text: base, alignment: 'center' }, { text: end, alignment: 'center' }];
  return [
    title(heading),
    line([['Name', v('pt_name')], ['Date', v(dateTag)]], { boldLabels: false }),
    { ...line([['Age', v('pt_age')], ['Sex', v('pt_sex')], ['Height', v(`${p}_height`)], ['Weight', v(`${p}_weight`)]], { boldLabels: false }), margin: [0, 0, 0, 12] },
    {
      layout: 'form',
      table: {
        widths: ['*', '*', '*'],
        body: [
          [head(''), { ...head('Baseline'), alignment: 'center' }, { ...head('End of Test'), alignment: 'center' }],
          row('Blood Pressure', bp(`${p}_bp_baseline`), bp(`${p}_bp_end`)),
          row('Heart rate', v(`${p}_hr_baseline`), v(`${p}_hr_end`)),
          row('O2 Saturation', v(`${p}_o2_baseline`), v(`${p}_o2_end`)),
        ].map((r) => r.map((c) => (typeof c === 'string' ? { text: c, margin: [0, 4, 0, 4] } : { ...c, margin: [0, 4, 0, 4] }))),
      },
      margin: [0, 0, 0, 16],
    },
    line([['Stopped or paused before 6 minutes?', v(`${p}_stopped`)], ['If yes, reason?', v(`${p}_stop_reason`)]], { boldLabels: false }),
    { ...line([['Other symptoms at end of test?', v(`${p}_symptoms`)]], { boldLabels: false }), margin: [0, 0, 0, 12] },
    { text: ['Number of laps: ', v(`${p}_laps`), `  (x ${lapLength(f, p)} meters)`], margin: [0, 0, 0, 5] },
    { text: ['Final partial lap: ', v(`${p}_partial`), '  (meters)'], margin: [0, 0, 0, 8] },
    { text: ['Total distance walked in 6 minutes: ', { text: v(`${p}_total`), bold: false }, '  meters'], bold: true },
  ];
}

function screenTable(f, prefix, heading, questions) {
  const choice = (q, c) => ({ ...radio(f[`${prefix}_q${q}_${c}`] === true), alignment: 'center' });
  return [
    { text: heading, bold: true, margin: [0, 0, 0, 2] },
    { text: 'Over the last 2 weeks, how often have you been bothered by the following? Not at all (0), Several days (1), More than half the days (2), Nearly every day (3)', fontSize: 7.5, margin: [0, 0, 0, 4] },
    {
      layout: 'form',
      table: {
        widths: ['*', 13, 13, 13, 13],
        body: [
          [head(''), ...[0, 1, 2, 3].map((n) => ({ ...head(String(n)), alignment: 'center' }))],
          ...questions.map((q, i) => [{ text: `${i + 1}. ${q}`, bold: true, fontSize: 8 }, ...[0, 1, 2, 3].map((c) => choice(i + 1, c))]),
          [{ text: 'Total score (0-6):', bold: true, fontSize: 8 }, { text: f[`${prefix}_total`] ?? '', colSpan: 4, alignment: 'center' }, {}, {}, {}],
        ],
      },
      margin: [0, 0, 0, 16],
    },
  ];
}

function planPage(f, v, bp) {
  const small = 8.8;
  const left = [
    { text: [{ text: 'Cardiac Rehabilitation Indication: ', bold: true }, { text: 'check all that apply', italics: true }], fontSize: small, margin: [0, 0, 0, 3] },
    ...INDICATIONS.map((t, i) => checkRow(f[`itp_ind_${i + 1}`] === true, t, small)),
    { text: [{ text: 'Co-Morbidities: ', bold: true }, { text: 'check all that apply', italics: true }], fontSize: small, margin: [0, 6, 0, 3] },
    ...COMORBIDITIES.map((t, i) => checkRow(f[`itp_comorb_${i + 1}`] === true, t, small)),
    { text: ['Smoker: ', v('itp_smoker'), '      If yes, pack years: ', v('itp_pack_years')], fontSize: small, margin: [0, 6, 0, 3] },
    { text: ['Family History of cardiovascular disease? ', v('itp_family_hx')], fontSize: small, margin: [0, 0, 0, 10] },
    { text: 'Complete Diagnosis:', bold: true, fontSize: small },
    { text: v('itp_diagnosis'), fontSize: small, margin: [0, 0, 0, 10] },
    { text: 'Initial Physical Examination:', bold: true, fontSize: small, margin: [0, 0, 0, 2] },
    { text: ['Height ', v('itp_height'), ' m   Weight ', v('itp_weight'), ' kg   BMI ', v('itp_bmi')], fontSize: small, margin: [0, 0, 0, 2] },
    { text: ['Blood Pressure ', bp('itp_bp'), ' mmHg   Heart Rate ', v('itp_hr'), ' bpm'], fontSize: small, margin: [0, 0, 0, 2] },
    { text: 'Significant Physical Examination findings:', fontSize: small },
    { text: v('itp_pe_findings'), fontSize: small, margin: [0, 0, 0, 10] },
    { text: '6 Minute Walk Test Distance:', bold: true, fontSize: small, margin: [0, 0, 0, 2] },
    { text: [label('Initial: '), v('itp_6mwt_initial'), label(' meters')], fontSize: small, margin: [0, 0, 0, 2] },
    { text: [label('End of Program: '), v('itp_6mwt_end'), label(' meters')], fontSize: small, margin: [0, 0, 0, 6] },
    { text: [label('Target Heart Rate: '), v('itp_thr'), label(' bpm')], fontSize: small },
  ];
  return [
    title('Individualized Treatment Plan'),
    line([['Name', v('pt_name')], ['Age', v('pt_age')], ['Sex', v('pt_sex')]], { boldLabels: false }),
    line([['Date enrolled', v('pt_date')], ['Birthday', v('pt_birthday')]], { boldLabels: false }),
    { ...line([['Attending Cardiologist', v('itp_cardiologist')]], { boldLabels: false }), margin: [0, 0, 0, 10] },
    { columns: [
      { width: 280, stack: left },
      { width: '*', stack: [
        ...screenTable(f, 'gad2', 'GENERAL ANXIETY DISORDER SCORE (GAD-2)', GAD2),
        ...screenTable(f, 'phq2', 'PATIENT HEALTH QUESTIONNAIRE (PHQ-2)', PHQ2),
      ] },
    ], columnGap: 18 },
  ];
}

function sessionPages(f, v, bp) {
  const cell = (lines) => ({ stack: lines.map((l) => (typeof l === 'string' || Array.isArray(l) ? { text: l || ' ' } : l)), fontSize: 8.3 });
  const rows = Array.from({ length: SESSIONS }, (_, i) => {
    const k = sessionKey(i + 1);
    const note = {
      colSpan: 5,
      text: [{ text: `Nurse's Note (Session # ${i + 1}): `, bold: true }, v(`${k}_nurse_note`)],
      fontSize: 8.3,
    };
    const vit = (ex, phase) => [`BP  ${bp(`${k}_${ex}_${phase}_bp`)}`, `HR  ${v(`${k}_${ex}_${phase}_hr`)}`, `O2 sat  ${v(`${k}_${ex}_${phase}_o2`)}`];
    const vitals = (phase) => cell([...vit('cal', phase), '', '', ...vit('tm', phase), ...vit('bike', phase)]);
    return [[
      cell([
        f[`${k}_date`] ? v(`${k}_date`) : { text: 'Date', italics: true, color: '#999999' },
        '',
        { text: `Session # ${i + 1}`, bold: true },
        'Weight (kgs):',
        v(`${k}_weight`),
      ]),
      cell([
        { text: 'Calisthenics:', bold: true }, 'Upper & Lower', 'Extremities', `Sets: ${v(`${k}_cal_sets`)}`, `Weights: ${v(`${k}_cal_weights`)}`,
        { text: 'Treadmill:', bold: true }, `Duration: ${v(`${k}_tm_duration`)}`, `Speed (km/h): ${v(`${k}_tm_speed`)}`,
        { text: 'Bicycle:', bold: true }, `Duration: ${v(`${k}_bike_duration`)}`, `Resistance: ${v(`${k}_bike_resistance`)}`,
      ]),
      vitals('pre'),
      vitals('post'),
      cell([
        `Borg scale: ${v(`${k}_borg`)}`,
        '',
        checkRow(f[`${k}_sym_none`] === true, 'No signs and symptoms', 8.3),
        ...SYMPTOMS.map(([id, text]) => checkRow(f[`${k}_sym_${id}`] === true, text, 8.3)),
        '',
        'Discharge Vitals:',
        `BP  ${bp(`${k}_dc_bp`)}`,
        `HR  ${v(`${k}_dc_hr`)}`,
        `O2 sat  ${v(`${k}_dc_o2`)}`,
        '',
        'Cardiac Rehab Nurse/',
        `Physical Therapist: ${v(`${k}_therapist`)}`,
      ]),
    ], [note, {}, {}, {}, {}]];
  }).flat();
  const th = (t) => ({ ...head(t), alignment: 'center', fontSize: 8.3 });
  return [
    title('Exercise Monitoring Sheet'),
    { text: ['Patient Name: ', v('pt_name')], margin: [0, 0, 0, 8] },
    {
      layout: { ...LAYOUT, paddingTop: () => 5, paddingBottom: () => 5 },
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [64, 98, 86, 86, '*'],
        body: [[th('Date'), th('Exercise'), th('Vital signs\nprior to start'), th('Vital signs\nafter exercise'), th('Remarks')], ...rows],
      },
    },
  ];
}

function heartShieldPages(f) {
  const page = heartShieldPage(f);
  if (!page) return [];
  return [
    title(page.title),
    { text: page.subtitle, fontSize: 8.5, color: MUTED, alignment: 'center', margin: [0, -6, 0, 10] },
    ...page.info.map((pairs) => line(pairs)),
    ...page.groups.map((g) => ({
      layout: 'form',
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: ['*', 80],
        body: [[head(g.heading), { ...head('Answer'), alignment: 'center' }], ...g.rows.map(([q, a]) => [q, { text: a, alignment: 'center' }])],
      },
      margin: [0, 6, 0, 4],
    })),
    { text: 'Screening outcome', bold: true, fontSize: 11, margin: [0, 12, 0, 4] },
    {
      layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 3 : 0), vLineColor: () => GOLD, paddingLeft: () => 8, paddingTop: () => 4, paddingBottom: () => 4 },
      table: { widths: ['*'], body: [[{ stack: [{ text: page.outcome.title, bold: true, fontSize: 11 }, page.outcome.detail ? { text: page.outcome.detail } : ''], fillColor: HEADER_FILL }]] },
    },
    { text: page.note, italics: true, fontSize: 8, color: MUTED, margin: [0, 12, 0, 0] },
  ];
}
