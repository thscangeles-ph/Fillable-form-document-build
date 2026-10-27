// Installable-app support: service worker, "Install app" button, persistent storage.
import { h } from './dom.js';

let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initInstall(toast) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Ask the browser not to clear patient records when the device runs low on space.
  navigator.storage?.persist?.().catch(() => {});

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
    toast('App installed — open it from the home screen');
  });
}

// A button that appears only when the app can be installed on this device.
export function installButton() {
  const btn = h('button.btn.btn-ghost', { type: 'button', onclick: install }, 'Install app');
  const update = () => { btn.hidden = isStandalone() || !(deferredPrompt || isIos()); };
  listeners.add(update);
  update();
  return btn;
}

async function install() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null;
    notify();
    return;
  }
  // iPad / iPhone Safari has no install prompt; show the steps instead.
  const dialog = h('dialog.dialog',
    h('h3', 'Install on iPad'),
    h('ol',
      h('li', 'Open this page in Safari.'),
      h('li', 'Tap the Share button (square with an arrow).'),
      h('li', 'Choose “Add to Home Screen”, then tap Add.')),
    h('form', { method: 'dialog' }, h('button.btn.btn-primary', 'OK')));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
}
