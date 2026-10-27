import { h, todayIso } from './dom.js';
import { isoToUs } from './template.js';

const W = 600;
const H = 200;

// A finger/stylus signature box. value: { png, date } | undefined
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

  function refresh() {
    status.textContent = current?.png ? `Signed ${isoToUs(current.date) || ''}`.trim() : 'Sign inside the box';
    status.classList.toggle('is-signed', !!current?.png);
    clearBtn.disabled = !current?.png;
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
    ctx.clearRect(0, 0, W, H);
    current = null;
    date.value = '';
    refresh();
    onChange(undefined);
  });
  date.addEventListener('change', () => {
    if (!current) return;
    current = { ...current, date: date.value };
    refresh();
    onChange(current);
  });

  refresh();
  return h('div.sig',
    h('div.sig-head', h('span.label', label), status),
    h('div.sig-box', canvas, h('div.sig-line')),
    h('div.sig-foot', h('label.sig-date', h('span', 'Date signed'), date), clearBtn),
  );
}
