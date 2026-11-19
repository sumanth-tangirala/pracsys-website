/**
 * Dependency-free helpers for the local "pending changes" overlay.
 *
 * site.js loads this on every page (for the preview banner), so it must not
 * import the BibTeX parser or the renderer. store.js re-exports everything
 * here for existing callers.
 */

export const OVERLAY_KEY = 'pracsys.publications.overlay.v1';
export const CHANGE_EVENT = 'pracsys:publications-changed';
const PREVIEW_OFF_KEY = 'pracsys.preview.off';

/** Site base path with a trailing slash ("/" or "/pracsys-website/"). */
export function siteBase() {
  const b = (typeof window !== 'undefined' && typeof window.PRACSYS_BASE === 'string' && window.PRACSYS_BASE) || '/';
  return b.endsWith('/') ? b : `${b}/`;
}

/**
 * window.localStorage / sessionStorage, or null when unavailable. Merely
 * touching the property throws in some privacy modes.
 */
export function getStorage(kind = 'localStorage') {
  try {
    return (typeof window !== 'undefined' && window[kind]) || null;
  } catch {
    return null;
  }
}

export function emptyOverlay() {
  return { version: 1, startedAgainst: null, changes: Object.create(null) };
}

const str = (v) => (typeof v === 'string' && v ? v : null);

/**
 * Validate an overlay object (from storage or an imported file). Returns a
 * clean copy, dropping malformed change records, or null when the shape is
 * not an overlay at all. `changes` has no prototype so keys such as
 * "__proto__" or "constructor" are ordinary keys.
 */
export function sanitizeOverlay(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return null;
  const src = raw.changes;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  const out = emptyOverlay();
  out.startedAgainst = str(raw.startedAgainst);
  for (const key of Object.keys(src)) {
    const c = src[key];
    if (!key.trim() || !c || typeof c !== 'object') continue;
    const meta = { at: str(c.at), user: str(c.user) };
    if (c.op === 'delete') {
      out.changes[key] = { op: 'delete', ...meta, ...(str(c.renamedTo) ? { renamedTo: c.renamedTo } : {}) };
    } else if (c.op === 'upsert' && c.entry && typeof c.entry === 'object'
      && c.entry.fields && typeof c.entry.fields === 'object' && !Array.isArray(c.entry.fields)) {
      const fields = {};
      for (const [k, v] of Object.entries(c.entry.fields)) {
        if (v === null || v === undefined || typeof v === 'object' || k === '__proto__') continue;
        const val = String(v);
        if (val.trim() !== '') fields[k.toLowerCase()] = val;
      }
      const type = String(c.entry.type || 'misc').toLowerCase().replace(/[^a-z]/g, '') || 'misc';
      out.changes[key] = {
        op: 'upsert',
        ...meta,
        entry: { type, key, fields },
        ...(str(c.renamedFrom) ? { renamedFrom: c.renamedFrom } : {}),
      };
    }
  }
  return out;
}

/** Read the overlay; an unreadable or corrupted value reads as empty. */
export function readOverlay() {
  try {
    const raw = getStorage()?.getItem(OVERLAY_KEY);
    return (raw && sanitizeOverlay(JSON.parse(raw))) || emptyOverlay();
  } catch {
    return emptyOverlay();
  }
}

/** Persist the overlay. Throws an Error with a user-facing message on failure. */
export function writeOverlay(overlay) {
  const ls = getStorage();
  if (!ls) throw new Error('This browser does not allow saving data (private mode or storage disabled).');
  try {
    if (Object.keys(overlay.changes).length === 0) ls.removeItem(OVERLAY_KEY);
    else ls.setItem(OVERLAY_KEY, JSON.stringify(overlay));
  } catch (err) {
    const full = err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22);
    throw new Error(full
      ? 'Browser storage is full. Export your pending changes, then discard some to free space.'
      : `Could not save to browser storage: ${err?.message || err}`, { cause: err });
  }
}

/** Number of pending changes saved in this browser. */
export function pendingChangeCount() {
  return Object.keys(readOverlay().changes).length;
}

export function previewDisabled() {
  try {
    return getStorage('sessionStorage')?.getItem(PREVIEW_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPreviewDisabled(off) {
  try {
    const ss = getStorage('sessionStorage');
    if (!ss) return;
    if (off) ss.setItem(PREVIEW_OFF_KEY, '1');
    else ss.removeItem(PREVIEW_OFF_KEY);
  } catch { /* preview toggle is best effort */ }
}
