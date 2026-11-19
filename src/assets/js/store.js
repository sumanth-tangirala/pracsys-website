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
import {
  OVERLAY_KEY, CHANGE_EVENT, siteBase, getStorage, emptyOverlay, sanitizeOverlay,
  readOverlay, writeOverlay, previewDisabled, setPreviewDisabled,
} from './overlay.js';

export { OVERLAY_KEY, CHANGE_EVENT, siteBase, readOverlay, previewDisabled, setPreviewDisabled };

/** `format` marker of files written by exportOverlay(). */
export const OVERLAY_FORMAT = 'pracsys-publications-overlay';

/** Normalised representation used to compare entries for equality. */
export function canonical(entry) {
  const fields = {};
  for (const k of Object.keys(entry.fields || {}).sort()) {
    const v = String(entry.fields[k] ?? '').trim();
    if (v !== '') fields[k.toLowerCase()] = v;
  }
  return JSON.stringify([String(entry.type || '').toLowerCase(), String(entry.key || '').trim(), fields]);
}

export function entriesEqual(a, b) {
  return !!a && !!b && canonical(a) === canonical(b);
}

let publishedPromise = null;

/**
 * Fetch the published set once per page load. `fresh` bypasses the browser
 * and CDN caches (GitHub Pages caches for 10 minutes), e.g. right after a
 * deploy. A failed request is not cached, so the next call retries.
 */
export function loadPublished({ fresh = false } = {}) {
  if (!publishedPromise || fresh) {
    const url = `${siteBase()}data/publications.json${fresh ? `?v=${Date.now()}` : ''}`;
    const promise = fetch(url, { cache: fresh ? 'no-cache' : 'default' })
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load publications (HTTP ${r.status})`);
        return r.json();
      })
      .then((data) => {
        if (!data || !Array.isArray(data.entries)) throw new Error('Could not load publications (unexpected data format)');
        return data;
      });
    publishedPromise = promise;
    promise.catch(() => {
      if (publishedPromise === promise) publishedPromise = null;
    });
  }
  return publishedPromise;
}

export class LocalOverlayStore {
  constructor() {
    this.published = null; // { generated, entries }
    this.overlay = readOverlay();
    this.listeners = new Set();
    if (typeof window !== 'undefined' && window.addEventListener) {
      // Another tab saved (key) or cleared all storage (key === null).
      window.addEventListener('storage', (e) => {
        if (e.key !== OVERLAY_KEY && e.key !== null) return;
        if (e.storageArea && e.storageArea !== getStorage()) return;
        this.overlay = readOverlay();
        this.emit();
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
    for (const fn of this.listeners) {
      try {
        fn(this);
      } catch (err) {
        console.error(err);
      }
    }
    if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    }
  }

  /** Write the current overlay (kept for callers of the old API). */
  save() {
    writeOverlay(this.overlay);
    this.emit();
  }

  /**
   * Apply a change to the overlay and persist it. Starts from the stored
   * overlay so edits saved meanwhile in another tab are not overwritten, and
   * leaves memory untouched when saving fails (e.g. storage full).
   */
  mutate(fn) {
    if (!getStorage()) throw new Error('This browser does not allow saving data (private mode or storage disabled).');
    const before = this.overlay;
    this.overlay = readOverlay();
    try {
      const result = fn(this.overlay);
      writeOverlay(this.overlay);
      this.emit();
      return result;
    } catch (err) {
      this.overlay = before;
      throw err;
    }
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
   * key the old key is removed (a rename); renaming onto a key that is in
   * use throws. Rename chains (A → B → C) keep pointing at the published
   * original, so reverting C restores A.
   */
  upsert(entry, { previousKey = null, user = null } = {}) {
    const clean = { type: String(entry.type || 'misc').toLowerCase(), key: String(entry.key ?? '').trim(), fields: {} };
    for (const [k, v] of Object.entries(entry.fields || {})) {
      const val = String(v ?? '').trim();
      if (val !== '') clean.fields[k.toLowerCase()] = val;
    }
    if (!clean.key) throw new Error('A citation key is required.');
    return this.mutate((ov) => {
      const changes = ov.changes;
      const at = new Date().toISOString();
      const published = this.publishedMap();
      ov.startedAgainst ??= this.publishedVersion;
      const renaming = !!previousKey && previousKey !== clean.key;
      // The published key this entry descends from through renames, if any.
      let origin = changes[clean.key]?.renamedFrom ?? null;
      if (renaming) {
        if (this.has(clean.key)) throw new Error(`Another publication already uses the key “${clean.key}”.`);
        const prev = changes[previousKey];
        origin = (prev?.op === 'upsert' && prev.renamedFrom) || (published.has(previousKey) ? previousKey : null);
        if (published.has(previousKey)) changes[previousKey] = { op: 'delete', at, user, renamedTo: clean.key };
        else delete changes[previousKey];
        if (origin && origin !== previousKey && changes[origin]?.op === 'delete') {
          changes[origin] = { ...changes[origin], renamedTo: clean.key };
        }
      }
      if (origin === clean.key) origin = null; // renamed back to where it started
      const base = published.get(clean.key);
      if (base && entriesEqual(base, clean)) delete changes[clean.key];
      else changes[clean.key] = { op: 'upsert', at, user, entry: clean, ...(origin ? { renamedFrom: origin } : {}) };
      return clean;
    });
  }

  remove(key, { user = null } = {}) {
    this.mutate((ov) => {
      const changes = ov.changes;
      const prev = changes[key];
      // Deleting a renamed entry: the original stays deleted, without a dangling "renamed to".
      const src = prev?.renamedFrom ? changes[prev.renamedFrom] : null;
      if (src?.op === 'delete' && src.renamedTo === key) {
        const { renamedTo, ...rest } = src;
        changes[prev.renamedFrom] = rest;
      }
      if (this.publishedMap().has(key)) changes[key] = { op: 'delete', at: new Date().toISOString(), user };
      else delete changes[key];
    });
  }

  /** Undo the local change for one key (restores the published version). */
  revert(key) {
    this.mutate((ov) => {
      const changes = ov.changes;
      const c = changes[key];
      delete changes[key];
      if (c?.renamedFrom && changes[c.renamedFrom]?.renamedTo === key) delete changes[c.renamedFrom];
      if (c?.renamedTo && changes[c.renamedTo]?.renamedFrom === key) delete changes[c.renamedTo];
    });
  }

  discardAll() {
    this.mutate((ov) => {
      ov.changes = emptyOverlay().changes;
      ov.startedAgainst = null;
    });
  }

  /**
   * Drop overlay changes that are already part of the published set (for
   * example after the exported .bib was committed and the site rebuilt).
   * Returns the number of changes removed.
   */
  prune() {
    const published = this.publishedMap();
    const stale = (c, key) => {
      const live = published.get(key);
      return (c.op === 'upsert' && live && entriesEqual(live, c.entry)) || (c.op === 'delete' && !live);
    };
    if (!Object.entries(this.overlay.changes).some(([k, c]) => stale(c, k))) return 0;
    return this.mutate((ov) => {
      let removed = 0;
      for (const [key, c] of Object.entries(ov.changes)) {
        if (stale(c, key)) {
          delete ov.changes[key];
          removed++;
        }
      }
      return removed;
    });
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

  /**
   * Full BibTeX file for the merged set, newest first (teachPress order).
   * `onlyChanged` limits it to new and edited entries.
   */
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

  /**
   * The pending changes themselves (edits, additions, deletions and
   * renames) as JSON, to move them to another browser with importOverlay().
   */
  exportOverlay() {
    return JSON.stringify({
      format: OVERLAY_FORMAT,
      version: 1,
      exported: new Date().toISOString(),
      startedAgainst: this.overlay.startedAgainst,
      changes: this.overlay.changes,
    }, null, 2);
  }

  /**
   * Load pending changes written by exportOverlay() (or a raw overlay).
   * With merge (default) imported changes replace local ones for the same
   * keys and other local changes are kept; with merge: false the local
   * overlay is replaced. Throws on invalid input; returns counts.
   */
  importOverlay(json, { merge = true } = {}) {
    let data = json;
    if (typeof json === 'string') {
      try {
        data = JSON.parse(json);
      } catch {
        throw new Error('This file is not a pending-changes export (invalid JSON).');
      }
    }
    if (data && typeof data === 'object' && data.format !== undefined && data.format !== OVERLAY_FORMAT) {
      throw new Error('This file is not a pending-changes export.');
    }
    const incoming = sanitizeOverlay(data);
    if (!incoming) throw new Error('This file is not a pending-changes export.');
    const offered = Object.keys(data.changes).length;
    return this.mutate((ov) => {
      if (!merge) {
        ov.changes = emptyOverlay().changes;
        ov.startedAgainst = null;
      }
      let added = 0;
      let replaced = 0;
      for (const [key, c] of Object.entries(incoming.changes)) {
        if (key in ov.changes) replaced++;
        else added++;
        ov.changes[key] = c;
      }
      ov.startedAgainst ??= incoming.startedAgainst;
      return { added, replaced, skipped: offered - added - replaced };
    });
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
