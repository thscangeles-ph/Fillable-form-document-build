import { h, todayIso } from './dom.js';
import { isoToUs } from './template.js';

const W = 600;
const H = 200;

// A finger/stylus signature box. value: { png, date, final?, finalizedAt? } | undefined
// Once finalized, the signature is locked and can no longer be redrawn or cleared.
export function signaturePad({ label, value, onChange }) {
  const canvas = h('canvas.sig-canvas', { width: W * 2, height: H * 2, 'aria-label': `${label} signature pad` });
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111';

  let current = value ? { ...value } : null;
  let drawing = false;
  let last = null;
  let dirty = false;

  const status = h('span.sig-status');
  const date = h('input.input', { type: 'date', value: current?.date || '' });
  const clearBtn = h('button.btn.btn-ghost.btn-sm', { type: 'button' }, 'Clear');
  const finalizeBtn = h('button.btn.btn-primary.btn-sm', { type: 'button' }, 'Finalize signature');
  const lockNote = h('span.sig-lock');
  const box = h('div.sig-box', canvas, h('div.sig-line'));

  const locked = () => !!current?.final;

  function refresh() {
    if (locked()) {
      status.textContent = `Finalized ${isoToUs(current.date) || ''}`.trim();
    } else {
      status.textContent = current?.png ? `Saved, not finalized · ${isoToUs(current.date) || ''}` : 'Sign inside the box';
    }
    status.classList.toggle('is-signed', !!current?.png);
    status.classList.toggle('is-final', locked());
    box.classList.toggle('locked', locked());
    clearBtn.hidden = locked();
    clearBtn.disabled = !current?.png;
    finalizeBtn.hidden = locked() || !current?.png;
    date.disabled = locked();
    lockNote.textContent = locked() ? '🔒 Locked — this signature can no longer be changed' : '';
  }

  if (current?.png) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, W, H);
    img.src = current.png;
  }

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (locked()) return;
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    last = pos(e);
    ctx.lineWidth = e.pointerType === 'pen' ? 1.5 + 2 * (e.pressure || 0.5) : 2.6;
    ctx.beginPath();
    ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    dirty = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    if (!dirty) return;
    dirty = false;
    current = { png: canvas.toDataURL('image/png'), date: date.value || todayIso() };
    date.value = current.date;
    refresh();
    onChange(current);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  clearBtn.addEventListener('click', () => {
    if (locked()) return;
    ctx.clearRect(0, 0, W, H);
    current = null;
    date.value = '';
    refresh();
    onChange(undefined);
  });
  finalizeBtn.addEventListener('click', () => {
    if (!current?.png || locked()) return;
    if (!confirm(`Finalize the ${label.toLowerCase()} signature? After this it cannot be redrawn, cleared or re-dated.`)) return;
    current = { ...current, final: true, finalizedAt: new Date().toISOString() };
    refresh();
    onChange(current);
  });
  date.addEventListener('change', () => {
    if (!current || locked()) return;
    current = { ...current, date: date.value };
    refresh();
    onChange(current);
  });

  refresh();
  return h('div.sig',
    h('div.sig-head', h('span.label', label), status),
    box,
    h('div.sig-foot', h('label.sig-date', h('span', 'Date signed'), date), h('div.actions', clearBtn, finalizeBtn)),
    lockNote,
  );
}
