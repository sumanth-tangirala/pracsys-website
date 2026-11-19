import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBibtex, serializeBibtex } from '../src/assets/js/lib/bibtex.js';
import {
  LocalOverlayStore, loadPublished, readOverlay, OVERLAY_KEY, CHANGE_EVENT, entriesEqual,
} from '../src/assets/js/store.js';
import { pendingChangeCount, previewDisabled, setPreviewDisabled, siteBase } from '../src/assets/js/overlay.js';

class MemStorage {
  constructor() { this.map = new Map(); this.quota = Infinity; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    const s = String(v);
    if (s.length > this.quota) {
      const err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.map.set(k, s);
  }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

let ls;
function freshWindow() {
  ls = new MemStorage();
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: ls,
    sessionStorage: new MemStorage(),
    PRACSYS_BASE: '/pracsys-website/',
  });
}

const PUBLISHED = {
  generated: '2026-01-01T00:00:00Z',
  entries: [
    { type: 'article', key: 'new2024', fields: { title: 'Newest', author: 'A B', year: '2024', date: '2024-05-01' } },
    { type: 'conference', key: 'Dobson:2017aa', fields: { title: 'Middle', author: 'C D', year: '2017', date: '2017-01-01' } },
    { type: 'misc', key: 'old2001', fields: { title: 'Oldest', year: '2001' } },
  ],
};

function makeStore(published = PUBLISHED) {
  const s = new LocalOverlayStore();
  s.published = structuredClone(published);
  return s;
}
const keysOf = (s) => s.entries().map((e) => e.key);
const changeKeys = (s) => Object.keys(s.overlay.changes).sort();

beforeEach(freshWindow);

test('upsert / edit / no-op edit / remove', () => {
  const s = makeStore();
  s.upsert({ type: 'misc', key: ' brand-new ', fields: { title: ' New paper ', year: '2025', empty: '  ', Note: 'x' } });
  assert.equal(s.statusOf('brand-new'), 'new');
  assert.deepEqual(s.get('brand-new').fields, { title: 'New paper', year: '2025', note: 'x' });
  assert.deepEqual(keysOf(s), ['new2024', 'Dobson:2017aa', 'old2001', 'brand-new']);

  s.upsert({ ...PUBLISHED.entries[1], fields: { ...PUBLISHED.entries[1].fields, title: 'Edited' } });
  assert.equal(s.statusOf('Dobson:2017aa'), 'edited');
  // Saving the published content again removes the pending change.
  s.upsert(PUBLISHED.entries[1]);
  assert.equal(s.statusOf('Dobson:2017aa'), 'published');

  s.remove('old2001');
  assert.equal(s.statusOf('old2001'), 'deleted');
  assert.equal(s.get('old2001'), null);
  s.remove('brand-new');
  assert.deepEqual(changeKeys(s), ['old2001']);
  // Persisted.
  assert.deepEqual(Object.keys(readOverlay().changes), ['old2001']);
  s.revert('old2001');
  assert.equal(ls.getItem(OVERLAY_KEY), null, 'empty overlay is removed from storage');
});

test('rename keeps a revertable link to the published original', () => {
  const s = makeStore();
  const x = s.get('Dobson:2017aa');
  s.upsert({ ...x, key: 'dobson2017' }, { previousKey: 'Dobson:2017aa' });
  assert.equal(s.overlay.changes['Dobson:2017aa'].renamedTo, 'dobson2017');
  assert.equal(s.overlay.changes.dobson2017.renamedFrom, 'Dobson:2017aa');
  assert.deepEqual(keysOf(s), ['new2024', 'old2001', 'dobson2017']);

  // Editing the renamed entry keeps the link.
  s.upsert({ ...s.get('dobson2017'), fields: { ...x.fields, title: 'Changed' } }, { previousKey: 'dobson2017' });
  assert.equal(s.overlay.changes.dobson2017.renamedFrom, 'Dobson:2017aa');

  // Rename again: the chain still points at the original.
  s.upsert({ ...s.get('dobson2017'), key: 'dobson-mrs' }, { previousKey: 'dobson2017' });
  assert.deepEqual(changeKeys(s), ['Dobson:2017aa', 'dobson-mrs']);
  assert.equal(s.overlay.changes['Dobson:2017aa'].renamedTo, 'dobson-mrs');
  assert.equal(s.overlay.changes['dobson-mrs'].renamedFrom, 'Dobson:2017aa');

  s.revert('dobson-mrs');
  assert.deepEqual(changeKeys(s), []);
  assert.equal(s.statusOf('Dobson:2017aa'), 'published');
});

test('renaming back to the original key with the original content leaves no change', () => {
  const s = makeStore();
  const x = s.get('new2024');
  s.upsert({ ...x, key: 'tmp' }, { previousKey: 'new2024' });
  s.upsert({ ...x, key: 'new2024' }, { previousKey: 'tmp' });
  assert.deepEqual(changeKeys(s), []);
});

test('renaming onto a key in use is refused and changes nothing', () => {
  const s = makeStore();
  const before = ls.getItem(OVERLAY_KEY);
  assert.throws(() => s.upsert({ ...s.get('new2024'), key: 'old2001' }, { previousKey: 'new2024' }), /already uses the key/);
  assert.deepEqual(changeKeys(s), []);
  assert.equal(ls.getItem(OVERLAY_KEY), before);
});

test('deleting a renamed entry does not leave a dangling "renamed to"', () => {
  const s = makeStore();
  s.upsert({ ...s.get('old2001'), key: 'old-renamed' }, { previousKey: 'old2001' });
  s.remove('old-renamed');
  assert.deepEqual(changeKeys(s), ['old2001']);
  assert.equal(s.overlay.changes.old2001.op, 'delete');
  assert.equal(s.overlay.changes.old2001.renamedTo, undefined);
});

test('prune drops changes that are live; keeps the rest', () => {
  const s = makeStore();
  s.upsert({ type: 'misc', key: 'added', fields: { title: 'A', year: '2020' } });
  s.upsert({ ...s.get('new2024'), key: 'renamed' }, { previousKey: 'new2024' });
  s.upsert({ type: 'misc', key: 'pending', fields: { title: 'P', year: '2020' } });
  // The site is rebuilt from an export that contains "added" and the rename only.
  const live = s.entries().filter((e) => e.key !== 'pending');
  s.published = { generated: 'v2', entries: live };
  assert.equal(s.prune(), 3);
  assert.deepEqual(changeKeys(s), ['pending']);
  assert.equal(s.prune(), 0);
});

test('exportBibtex: newest first, full or only changed', () => {
  const s = makeStore();
  s.upsert({ type: 'misc', key: 'mid', fields: { title: 'Mid', year: '2020', date: '2020-01-01' } });
  s.remove('old2001');
  const full = parseBibtex(s.exportBibtex());
  assert.deepEqual(full.map((e) => e.key), ['new2024', 'mid', 'Dobson:2017aa']);
  assert.deepEqual(parseBibtex(s.exportBibtex({ onlyChanged: true })).map((e) => e.key), ['mid']);
  assert.match(s.exportBibtex(), /^% PRACSYS Lab publications\n/);
});

test('exportBibtex of the real data without changes reproduces data/publications.bib entries in order', () => {
  const entries = parseBibtex(readFileSync(new URL('../data/publications.bib', import.meta.url), 'utf8'));
  const s = makeStore({ generated: 'x', entries });
  const exported = s.exportBibtex();
  assert.deepEqual(parseBibtex(exported), entries);
  assert.equal(exported.slice(exported.indexOf('@')), serializeBibtex(entries));
});

test('corrupted or malformed storage reads as empty, valid records survive', () => {
  ls.setItem(OVERLAY_KEY, '{not json');
  assert.deepEqual(Object.keys(readOverlay().changes), []);
  ls.setItem(OVERLAY_KEY, JSON.stringify({ version: 1, changes: [] }));
  assert.deepEqual(Object.keys(readOverlay().changes), []);
  ls.setItem(OVERLAY_KEY, JSON.stringify({
    version: 1,
    changes: {
      good: { op: 'upsert', at: 'x', entry: { type: 'misc', key: 'good', fields: { title: 'G', n: 3, o: { x: 1 } } } },
      noEntry: { op: 'upsert' },
      badFields: { op: 'upsert', entry: { fields: 'x' } },
      nullish: null,
      weird: { op: 'frobnicate' },
      gone: { op: 'delete' },
      __proto__: { op: 'delete' },
    },
  }));
  const s = makeStore();
  assert.deepEqual(changeKeys(s), ['gone', 'good']);
  assert.deepEqual(s.get('good').fields, { title: 'G', n: '3' });
  assert.doesNotThrow(() => s.publications());
  assert.equal(pendingChangeCount(), 2);
});

test('keys like "__proto__" and "constructor" are ordinary keys', () => {
  const s = makeStore();
  s.upsert({ type: 'misc', key: '__proto__', fields: { title: 'P' } });
  s.upsert({ type: 'misc', key: 'constructor', fields: { title: 'C' } });
  assert.deepEqual(changeKeys(makeStore()), ['__proto__', 'constructor']);
  assert.equal(s.statusOf('toString'), 'published');
});

test('localStorage unavailable: reads are empty, writes fail clearly without changing memory', () => {
  const denied = { get() { throw new Error('SecurityError'); } };
  globalThis.window = Object.defineProperties(new EventTarget(), { localStorage: denied, sessionStorage: denied });
  assert.deepEqual(Object.keys(readOverlay().changes), []);
  assert.equal(previewDisabled(), false);
  assert.doesNotThrow(() => setPreviewDisabled(true));
  const s = makeStore();
  assert.throws(() => s.upsert({ type: 'misc', key: 'k', fields: { title: 'T' } }), /does not allow saving/);
  assert.deepEqual(changeKeys(s), []);
  assert.deepEqual(keysOf(s), ['new2024', 'Dobson:2017aa', 'old2001']);
});

test('storage full: the edit is rejected and nothing half-saved', () => {
  const s = makeStore();
  s.upsert({ type: 'misc', key: 'small', fields: { title: 'S' } });
  const saved = ls.getItem(OVERLAY_KEY);
  ls.quota = saved.length + 10;
  assert.throws(() => s.upsert({ type: 'misc', key: 'big', fields: { title: 'x'.repeat(500) } }), /storage is full/);
  assert.deepEqual(changeKeys(s), ['small']);
  assert.equal(ls.getItem(OVERLAY_KEY), saved);
});

test('cross-tab: storage events refresh the overlay; edits from two tabs merge', () => {
  const a = makeStore();
  const b = makeStore();
  let notified = 0;
  let events = 0;
  b.onChange(() => notified++);
  window.addEventListener(CHANGE_EVENT, () => events++);

  a.upsert({ type: 'misc', key: 'fromA', fields: { title: 'A' } });
  // b has not seen the storage event yet; its own save must not drop A's edit.
  b.upsert({ type: 'misc', key: 'fromB', fields: { title: 'B' } });
  assert.deepEqual(Object.keys(readOverlay().changes).sort(), ['fromA', 'fromB']);

  ls.removeItem(OVERLAY_KEY);
  const ev = new Event('storage');
  ev.key = null; // localStorage.clear() in another tab
  ev.storageArea = ls;
  window.dispatchEvent(ev);
  assert.deepEqual(changeKeys(b), []);
  assert.ok(notified >= 2 && events >= 3);
});

test('exportOverlay / importOverlay move edits, deletions and renames', () => {
  const a = makeStore();
  a.upsert({ type: 'misc', key: 'added', fields: { title: 'A' } });
  a.remove('old2001');
  a.upsert({ ...a.get('new2024'), key: 'renamed' }, { previousKey: 'new2024' });
  const file = a.exportOverlay();
  assert.equal(JSON.parse(file).format, 'pracsys-publications-overlay');

  freshWindow(); // "another computer"
  const b = makeStore();
  b.upsert({ type: 'misc', key: 'local', fields: { title: 'L' } });
  b.upsert({ type: 'misc', key: 'added', fields: { title: 'older local version' } });
  const result = b.importOverlay(file);
  assert.deepEqual(result, { added: 3, replaced: 1, skipped: 0 });
  assert.deepEqual(changeKeys(b), ['added', 'local', 'new2024', 'old2001', 'renamed']);
  assert.equal(b.get('added').fields.title, 'A');
  assert.equal(b.statusOf('old2001'), 'deleted');
  b.revert('renamed');
  assert.equal(b.statusOf('new2024'), 'published');

  const c = makeStore();
  c.importOverlay(file, { merge: false });
  assert.deepEqual(changeKeys(c), ['added', 'new2024', 'old2001', 'renamed']);

  // A raw overlay object is accepted too; junk is refused without touching the overlay.
  assert.equal(c.importOverlay({ version: 1, changes: { x: { op: 'delete' }, bad: 7 } }).skipped, 1);
  for (const junk of ['nope', '{"format":"other","version":1,"changes":{}}', '{"version":2,"changes":{}}', '[]', 'null']) {
    const before = JSON.stringify(c.overlay);
    assert.throws(() => c.importOverlay(junk), /not a pending-changes export/, junk);
    assert.equal(JSON.stringify(c.overlay), before);
  }
});

test('entriesEqual ignores field order, case and blank fields', () => {
  assert.ok(entriesEqual(
    { type: 'Misc', key: 'k ', fields: { b: '2', a: ' 1 ', c: '' } },
    { type: 'misc', key: 'k', fields: { A: '1', b: '2' } },
  ));
  assert.ok(!entriesEqual({ type: 'misc', key: 'k', fields: {} }, null));
});

test('loadPublished: base path, fresh requests bust caches, failures are retried', async () => {
  const calls = [];
  let fail = true;
  globalThis.fetch = async (url, init) => {
    calls.push([url, init.cache]);
    if (fail) return { ok: false, status: 503 };
    return { ok: true, json: async () => PUBLISHED };
  };
  assert.equal(siteBase(), '/pracsys-website/');
  await assert.rejects(loadPublished(), /HTTP 503/);
  fail = false;
  assert.equal((await loadPublished()).entries.length, 3, 'a failed load is not cached');
  await loadPublished();
  assert.equal(calls.length, 2, 'a successful load is cached');
  await loadPublished({ fresh: true });
  assert.equal(calls[0][0], '/pracsys-website/data/publications.json');
  assert.match(calls[2][0], /^\/pracsys-website\/data\/publications\.json\?v=\d+$/);
  assert.equal(calls[2][1], 'no-cache');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ nope: true }) });
  await assert.rejects(loadPublished({ fresh: true }), /unexpected data format/);
  delete globalThis.fetch;
});
