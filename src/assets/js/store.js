/**
 * Publication store.
 *
 * There is no server: the published set lives in /data/publications.json
 * (built from data/publications.bib). Edits made in the admin editor are kept
 * as an *overlay* in this browser's localStorage and layered on top of the
 * published set, so the public pages can preview them before they are
 * exported and committed.
 *
 * To plug in a real backend later, replace `LocalOverlayStore` with an
 * implementation that exposes the same methods (load, entries, upsert,
 * remove, revert, discardAll, changes) and talks to an API instead.
 */
import { serializeBibtex } from './lib/bibtex.js';
import { publicationsFromEntries, sortPublications, toPublication } from './lib/publications.js';

export const OVERLAY_KEY = 'pracsys.publications.overlay.v1';
const PREVIEW_OFF_KEY = 'pracsys.preview.off';
export const CHANGE_EVENT = 'pracsys:publications-changed';

export function siteBase() {
  const b = (typeof window !== 'undefined' && window.PRACSYS_BASE) || '/';
  return b.endsWith('/') ? b : `${b}/`;
}

function safeStorage(kind = 'localStorage') {
  try {
    const s = window[kind];
    const probe = '__pracsys_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Read the overlay without loading anything else (used for the preview banner). */
export function readOverlay() {
  const ls = safeStorage();
  if (!ls) return emptyOverlay();
  try {
    const raw = JSON.parse(ls.getItem(OVERLAY_KEY) || 'null');
    if (raw && raw.version === 1 && raw.changes && typeof raw.changes === 'object') return raw;
  } catch { /* fall through */ }
  return emptyOverlay();
}

function emptyOverlay() {
  return { version: 1, startedAgainst: null, changes: {} };
}

export function previewDisabled() {
  return safeStorage('sessionStorage')?.getItem(PREVIEW_OFF_KEY) === '1';
}

export function setPreviewDisabled(off) {
  const ss = safeStorage('sessionStorage');
  if (!ss) return;
  if (off) ss.setItem(PREVIEW_OFF_KEY, '1');
  else ss.removeItem(PREVIEW_OFF_KEY);
}

/** Normalised representation used to compare entries for equality. */
export function canonical(entry) {
  const fields = {};
  for (const k of Object.keys(entry.fields || {}).sort()) {
    const v = String(entry.fields[k] ?? '').trim();
    if (v !== '') fields[k] = v;
  }
  return JSON.stringify([String(entry.type || '').toLowerCase(), String(entry.key || '').trim(), fields]);
}

export function entriesEqual(a, b) {
  return !!a && !!b && canonical(a) === canonical(b);
}

let publishedPromise = null;

/** Fetch the published set once per page load. */
export function loadPublished({ fresh = false } = {}) {
  if (!publishedPromise || fresh) {
    publishedPromise = fetch(`${siteBase()}data/publications.json`, { cache: fresh ? 'no-cache' : 'default' })
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load publications (HTTP ${r.status})`);
        return r.json();
      });
  }
  return publishedPromise;
}

export class LocalOverlayStore {
  constructor() {
    this.published = null; // { generated, entries }
    this.overlay = readOverlay();
    this.listeners = new Set();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === OVERLAY_KEY) {
          this.overlay = readOverlay();
          this.emit();
        }
      });
    }
  }

  async load(options) {
    this.published = await loadPublished(options);
    this.overlay = readOverlay();
    return this;
  }

  get publishedVersion() {
    return this.published?.generated || null;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }

  save() {
    const ls = safeStorage();
    if (!ls) throw new Error('This browser does not allow saving data (private mode or storage disabled).');
    if (Object.keys(this.overlay.changes).length === 0) ls.removeItem(OVERLAY_KEY);
    else ls.setItem(OVERLAY_KEY, JSON.stringify(this.overlay));
    this.emit();
  }

  /** Published entries indexed by key. */
  publishedMap() {
    return new Map((this.published?.entries || []).map((e) => [e.key, e]));
  }

  /** Published set with the local overlay applied. */
  entries({ includeOverlay = true } = {}) {
    const base = this.published?.entries || [];
    if (!includeOverlay) return base.map(clone);
    const changes = this.overlay.changes;
    const out = [];
    const seen = new Set();
    for (const e of base) {
      const c = changes[e.key];
      seen.add(e.key);
      if (!c) out.push(clone(e));
      else if (c.op === 'upsert') out.push(clone(c.entry));
      // op === 'delete' → dropped
    }
    for (const [key, c] of Object.entries(changes)) {
      if (!seen.has(key) && c.op === 'upsert') out.push(clone(c.entry));
    }
    return out;
  }

  publications(options) {
    return publicationsFromEntries(this.entries(options));
  }

  get(key) {
    const c = this.overlay.changes[key];
    if (c) return c.op === 'upsert' ? clone(c.entry) : null;
    const e = this.publishedMap().get(key);
    return e ? clone(e) : null;
  }

  has(key) {
    return this.get(key) !== null;
  }

  /** Status of a key relative to the published set. */
  statusOf(key) {
    const c = this.overlay.changes[key];
    if (!c) return 'published';
    if (c.op === 'delete') return 'deleted';
    return this.publishedMap().has(key) ? 'edited' : 'new';
  }

  /**
   * Create or update an entry. When `previousKey` differs from the entry's
   * key the old key is removed (a rename).
   */
  upsert(entry, { previousKey = null, user = null } = {}) {
    const clean = { type: String(entry.type).toLowerCase(), key: String(entry.key).trim(), fields: {} };
    for (const [k, v] of Object.entries(entry.fields || {})) {
      const val = String(v ?? '').trim();
      if (val !== '') clean.fields[k.toLowerCase()] = val;
    }
    const at = new Date().toISOString();
    const published = this.publishedMap();
    this.overlay.startedAgainst ??= this.publishedVersion;
    if (previousKey && previousKey !== clean.key) {
      if (published.has(previousKey)) {
        this.overlay.changes[previousKey] = { op: 'delete', at, user, renamedTo: clean.key };
      } else {
        delete this.overlay.changes[previousKey];
      }
    }
    const base = published.get(clean.key);
    if (base && entriesEqual(base, clean)) delete this.overlay.changes[clean.key];
    else this.overlay.changes[clean.key] = { op: 'upsert', at, user, entry: clean, ...(previousKey && previousKey !== clean.key ? { renamedFrom: previousKey } : {}) };
    this.save();
    return clean;
  }

  remove(key, { user = null } = {}) {
    const published = this.publishedMap();
    if (published.has(key)) {
      this.overlay.changes[key] = { op: 'delete', at: new Date().toISOString(), user };
    } else {
      delete this.overlay.changes[key];
    }
    this.save();
  }

  /** Undo the local change for one key (restores the published version). */
  revert(key) {
    const c = this.overlay.changes[key];
    delete this.overlay.changes[key];
    if (c?.renamedFrom && this.overlay.changes[c.renamedFrom]?.renamedTo === key) {
      delete this.overlay.changes[c.renamedFrom];
    }
    if (c?.renamedTo && this.overlay.changes[c.renamedTo]?.renamedFrom === key) {
      delete this.overlay.changes[c.renamedTo];
    }
    this.save();
  }

  discardAll() {
    this.overlay = emptyOverlay();
    this.save();
  }

  /**
   * Drop overlay changes that are already part of the published set (for
   * example after the exported .bib was committed and the site rebuilt).
   * Returns the number of changes removed.
   */
  prune() {
    const published = this.publishedMap();
    let removed = 0;
    for (const [key, c] of Object.entries(this.overlay.changes)) {
      const live = published.get(key);
      if ((c.op === 'upsert' && live && entriesEqual(live, c.entry)) || (c.op === 'delete' && !live)) {
        delete this.overlay.changes[key];
        removed++;
      }
    }
    if (removed) this.save();
    return removed;
  }

  /** List of pending changes with before/after entries. */
  changes() {
    const published = this.publishedMap();
    return Object.entries(this.overlay.changes)
      .map(([key, c]) => ({
        key,
        op: c.op,
        status: c.op === 'delete' ? 'deleted' : (published.has(key) ? 'edited' : 'new'),
        at: c.at,
        user: c.user,
        renamedFrom: c.renamedFrom,
        renamedTo: c.renamedTo,
        before: published.get(key) || null,
        after: c.op === 'upsert' ? c.entry : null,
      }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  get changeCount() {
    return Object.keys(this.overlay.changes).length;
  }

  /** Full BibTeX file for the merged set, newest first (teachPress order). */
  exportBibtex({ onlyChanged = false } = {}) {
    let entries = this.entries();
    if (onlyChanged) {
      const keys = new Set(this.changes().filter((c) => c.after).map((c) => c.key));
      entries = entries.filter((e) => keys.has(e.key));
    }
    const ordered = sortPublications(entries.map((e, i) => toPublication(e, i)))
      .map((p) => entries[p.order]);
    const header = `% PRACSYS Lab publications\n% Exported ${new Date().toISOString()} from the website's publication editor.\n% Encoding: UTF-8`;
    return serializeBibtex(ordered, header);
  }

  exportJson() {
    return JSON.stringify({ exported: new Date().toISOString(), entries: this.entries() }, null, 2);
  }
}

function clone(e) {
  return { type: e.type, key: e.key, fields: { ...e.fields } };
}

let shared = null;
/** One store per page. */
export function getStore() {
  shared ??= new LocalOverlayStore();
  return shared;
}
