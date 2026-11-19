/** Small DOM helpers shared by the admin views. */
import { escapeHtml } from '../lib/publications.js';

export const esc = escapeHtml;

/** Tagged template that escapes interpolations unless wrapped with raw(). */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return new Raw(out);
}

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export function raw(s) {
  return new Raw(String(s ?? ''));
}

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(v);
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function prefersReducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Scroll an element into view, without animation when the user asked for less motion. */
export function scrollToEl(el, block = 'start') {
  el?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block });
}

let toastHost = null;
/** Non-blocking status message. kind: info | success | error */
export function toast(message, kind = 'info', timeout = kind === 'error' ? 8000 : 4200) {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = document.createElement('div');
    toastHost.className = 'adm-toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.append(toastHost);
  }
  const t = document.createElement('div');
  t.className = `adm-toast adm-toast-${kind}`;
  t.innerHTML = `<span>${esc(message)}</span><button type="button" aria-label="Dismiss message">&times;</button>`;
  t.querySelector('button').addEventListener('click', () => t.remove());
  toastHost.append(t);
  // Keep at most two messages so they never pile up over the page's buttons.
  while (toastHost.children.length > 2) toastHost.firstElementChild.remove();
  if (timeout) setTimeout(() => t.remove(), timeout);
}

let dialogSeq = 0;
/**
 * Accessible confirmation dialog. Resolves true when confirmed; Escape or
 * the cancel button resolve false. Focus returns to where it was.
 * @param {{title: string, body?: string, confirm?: string, cancel?: string, danger?: boolean}} o
 */
export function confirmDialog(o) {
  return new Promise((resolve) => {
    const id = `adm-dlg-${++dialogSeq}`;
    const opener = document.activeElement;
    const dlg = document.createElement('dialog');
    dlg.className = 'adm-dialog';
    dlg.setAttribute('aria-labelledby', `${id}-title`);
    if (o.body) dlg.setAttribute('aria-describedby', `${id}-body`);
    dlg.innerHTML = `<form method="dialog">
      <h2 id="${id}-title">${esc(o.title)}</h2>
      ${o.body ? `<p id="${id}-body">${esc(o.body)}</p>` : ''}
      <div class="adm-dialog-actions">
        <button value="cancel" class="adm-btn">${esc(o.cancel || 'Cancel')}</button>
        <button value="ok" class="adm-btn ${o.danger ? 'adm-btn-danger' : 'adm-btn-primary'}">${esc(o.confirm || 'OK')}</button>
      </div></form>`;
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
      if (opener?.isConnected && document.activeElement === document.body) opener.focus({ preventScroll: true });
    });
    dlg.showModal();
    dlg.querySelector(`button[value="${o.danger ? 'cancel' : 'ok'}"]`).focus();
  });
}

/**
 * Run a change to the stored data. Saving can fail (browser storage full or
 * blocked, or a key clash): show why and return false instead of failing silently.
 */
export function attempt(fn, what = 'Could not save the change') {
  try {
    fn();
    return true;
  } catch (err) {
    console.warn(err);
    toast(`${what}: ${err.message}`, 'error');
    return false;
  }
}

/** True while a modal dialog is open (keyboard shortcuts should wait). */
export function dialogIsOpen() {
  return !!document.querySelector('dialog[open]');
}

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function relativeTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Status pill for a publication. */
export function statusBadge(status) {
  const labels = { published: 'Published', edited: 'Edited', new: 'New', deleted: 'Deleted', renamed: 'Renamed' };
  return html`<span class="adm-badge adm-badge-${status}">${labels[status] || status}</span>`;
}
