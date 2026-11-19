/** Import BibTeX (or a pending-changes / JSON backup file) with a review step before anything changes. */
import { TYPES, splitNames, parseName, displayName } from '../lib/publications.js';
import { parseBibtexWithErrors } from '../lib/bibtex.js';
import { entriesEqual, OVERLAY_FORMAT } from '../store.js';
import { html, raw, $, toast, plural, debounce, scrollToEl } from './ui.js';
import { KEY_PATTERN, FIELD_LABELS, labStyleNames, authorSuggestions, knownAuthorSet, normalizeTitle, titleIndex } from './model.js';

const STATUS_LABELS = { new: 'New', update: 'Updates existing', same: 'Already identical', invalid: 'Cannot import', delete: 'Deletes', rename: 'Renames' };

export function renderImport(main, ctx) {
  const { store } = ctx;
  const knownAuthors = knownAuthorSet(store.publications());
  const knownTags = [...new Set(store.publications().flatMap((p) => p.tags))].sort();
  /** Last review: { mode: 'bib' | 'overlay', entries, errors, overlay } */
  let source = null;
  let candidates = [];

  main.innerHTML = html`
    <div class="adm-page-head"><div><h1>Import BibTeX</h1>
      <p class="adm-sub">Paste entries from Google Scholar, DBLP, Overleaf or a teachPress export. You will review everything before it is added.</p></div></div>
    <section class="adm-card">
      <div class="adm-dropzone">
        <label class="adm-label" for="imp-text">BibTeX</label>
        <textarea id="imp-text" class="adm-code" rows="12" spellcheck="false" aria-describedby="imp-text-help" placeholder="@inproceedings{key,&#10;  title = {…},&#10;  author = {…},&#10;  booktitle = {…},&#10;  year = {2026}&#10;}"></textarea>
        <span class="adm-help" id="imp-text-help">You can also load a <code>.bib</code> file, or a pending-changes <code>.json</code> file from Export on another computer.</span>
        <div class="adm-actions">
          <label class="adm-btn adm-file"><i class="fa fa-folder-open" aria-hidden="true"></i> Choose a .bib or .json file<input type="file" id="imp-file" accept=".bib,.bibtex,.txt,.json,application/json,text/plain"></label>
          <span class="adm-muted adm-small adm-drop-hint">…or drop a file onto the box.</span>
          <span class="adm-savebar-spacer"></span>
          <button type="button" class="adm-btn adm-btn-primary" data-act="preview">Review import</button>
        </div>
      </div>
      <fieldset class="adm-options adm-mt">
        <legend class="adm-label">Options</legend>
        <label class="adm-check"><input type="checkbox" id="imp-lab-names" checked> Write author names as initial + last name (e.g. Kostas E. Bekris → K Bekris)</label>
        <div class="adm-field adm-field-narrow">
          <label class="adm-label" for="imp-tag">Add a tag to every imported entry (optional)</label>
          <input id="imp-tag" type="text" list="imp-tags" placeholder="e.g. Planning" autocomplete="off">
          <datalist id="imp-tags">${knownTags.map((t) => html`<option value="${t}">`)}</datalist>
        </div>
      </fieldset>
    </section>
    <div id="imp-review"></div>`.toString();

  const text = $('#imp-text', main);
  const file = $('#imp-file', main);
  const zone = $('.adm-dropzone', main);

  async function readFile(f) {
    if (f.size > 5e6) { toast('That file is larger than 5 MB.', 'error'); return; }
    text.value = await f.text();
    file.value = ''; // so choosing the same file again still triggers a change
    review();
  }
  file.addEventListener('change', () => file.files[0] && readFile(file.files[0]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-drag'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-drag');
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  function parseInput(value) {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let data;
      try {
        data = JSON.parse(trimmed);
      } catch (err) {
        return { mode: 'bib', entries: [], errors: [{ message: `This JSON file could not be read: ${err.message}` }] };
      }
      if (data && !Array.isArray(data) && (data.format === OVERLAY_FORMAT || (data.version === 1 && data.changes && typeof data.changes === 'object'))) {
        return { mode: 'overlay', overlay: data, entries: [], errors: [] };
      }
      const list = Array.isArray(data) ? data : data?.entries;
      if (!Array.isArray(list)) return { mode: 'bib', entries: [], errors: [{ message: 'This JSON file is not a publications backup or a pending-changes file.' }] };
      return { mode: 'bib', entries: list.filter((e) => e && e.key && e.fields && typeof e.fields === 'object'), errors: [] };
    }
    return { mode: 'bib', ...parseBibtexWithErrors(value) };
  }

  /** Candidates for a BibTeX (or full JSON backup) import. Keeps earlier check-box choices. */
  function bibCandidates() {
    const prev = new Map(candidates.map((c) => [c.id, c.checked]));
    const byTitle = titleIndex(store.entries());
    const typedTag = $('#imp-tag', main).value.trim().replace(/[,;]/g, '');
    const extraTag = knownTags.find((t) => t.toLowerCase() === typedTag.toLowerCase()) || typedTag;
    const labNames = $('#imp-lab-names', main).checked;
    const seenKeys = new Set();
    const seenTitles = new Map();
    return source.entries.map((e, i) => {
      const fields = {};
      for (const [k, v] of Object.entries(e.fields)) fields[k.toLowerCase()] = String(v ?? '');
      let type = String(fields.tppubtype || e.type || 'misc').toLowerCase();
      if (!TYPES[type]) type = TYPES[String(e.type || '').toLowerCase()] ? String(e.type).toLowerCase() : 'misc';
      fields.tppubtype = type;
      fields.pubstate ||= 'published';
      if (!fields.year && fields.date) fields.year = String(fields.date).slice(0, 4);
      const originalAuthors = fields.author || '';
      if (labNames) {
        for (const f of ['author', 'editor']) if (fields[f]) fields[f] = labStyleNames(fields[f], knownAuthors);
      }
      if (extraTag) {
        const t = String(fields.keywords || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
        if (!t.some((x) => x.toLowerCase() === extraTag.toLowerCase())) t.push(extraTag);
        fields.keywords = t.join(', ');
      }
      const key = String(e.key || '').trim();
      const existing = store.get(key);
      const notes = [];
      // An update keeps fields the import does not mention (Scholar/DBLP entries
      // have no abstract, tags or links) and only changes the ones it gives.
      let merged = fields;
      if (existing) {
        // Scholar says @inproceedings where teachPress used conference: keep the existing type.
        if (!e.fields.tppubtype) type = existing.type;
        merged = { ...existing.fields, ...fields, tppubtype: type };
        if (extraTag || fields.keywords) {
          const tags = [...String(existing.fields.keywords || '').split(/[,;]/), ...String(fields.keywords || '').split(/[,;]/)].map((x) => x.trim()).filter(Boolean);
          const seen = new Set();
          merged.keywords = tags.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).join(', ');
        }
        if (!e.fields.tppubtype && !e.fields.pubstate) merged.pubstate = existing.fields.pubstate || merged.pubstate;
      }
      const entry = { type, key, fields: merged };
      let status = 'new';
      let selected = true;
      const title = normalizeTitle(fields.title);
      if (!key || !KEY_PATTERN.test(key)) { status = 'invalid'; notes.push('Missing or invalid citation key (letters, numbers and _ - : . + / only).'); }
      else if (seenKeys.has(key)) { status = 'invalid'; notes.push('This key appears twice in the import; only the first one is used.'); }
      else if (!String(fields.title || '').trim()) { status = 'invalid'; notes.push('No title.'); }
      else if (existing && entriesEqual(existing, entry)) status = 'same';
      else if (existing) {
        status = 'update';
        const changed = Object.keys(merged).filter((k) => k !== 'tppubtype' && String(merged[k]).trim() !== String(existing.fields[k] ?? '').trim());
        if (type !== existing.type) changed.unshift('type');
        notes.push(`Changes ${changed.map((k) => (k === 'type' ? 'Type' : FIELD_LABELS[k] || k)).join(', ')}; other fields are kept.`);
      }
      else if (byTitle.has(title)) { notes.push(`Probably already listed as “${byTitle.get(title)}” (same title), so it is not selected.`); selected = false; }
      else if (seenTitles.has(title)) { notes.push(`Same title as “${seenTitles.get(title)}” earlier in this import, so it is not selected.`); selected = false; }
      else if (store.statusOf(key) === 'deleted') notes.push('This key belongs to a publication you deleted; importing restores it with these details.');
      if (status !== 'invalid' && status !== 'same') {
        for (const s of authorSuggestions(splitNames(fields.author), knownAuthors)) {
          notes.push(`“${s.raw}”: other papers write ${s.known.map((k) => `“${k}”`).join(' or ')}. Check the spelling after importing.`);
        }
      }
      if (key) seenKeys.add(key);
      if (title && !seenTitles.has(title)) seenTitles.set(title, key);
      const id = `${i}:${key}`;
      const importable = status === 'new' || status === 'update';
      const authorsChanged = labNames && originalAuthors && originalAuthors !== fields.author;
      return { id, entry, status, notes, authorsChanged, importable, checked: importable && (prev.has(id) ? prev.get(id) : selected) };
    });
  }

  /** Candidates for a pending-changes (overlay) file: one row per change, renames as one row. */
  function overlayCandidates() {
    const prev = new Map(candidates.map((c) => [c.id, c.checked]));
    const published = store.publishedMap();
    const changes = source.overlay.changes || {};
    const rows = [];
    for (const [key, c] of Object.entries(changes)) {
      if (!c || typeof c !== 'object') continue;
      if (c.op === 'delete' && c.renamedTo && changes[c.renamedTo]?.renamedFrom === key) continue; // shown with its rename
      const keys = [key];
      let status;
      let title = key;
      if (c.op === 'upsert' && c.entry?.fields) {
        title = c.entry.fields.title || key;
        if (c.renamedFrom && changes[c.renamedFrom]?.renamedTo === key) {
          status = 'rename';
          keys.push(c.renamedFrom);
        } else status = published.has(key) ? 'update' : 'new';
      } else if (c.op === 'delete') {
        status = 'delete';
        title = published.get(key)?.fields.title || key;
      } else continue;
      const notes = [];
      if (status === 'rename') notes.push(`Renames ${c.renamedFrom} → ${key}.`);
      if (status === 'delete' && !published.has(key)) notes.push('Not on the live site any more; nothing to delete.');
      if (keys.some((k) => store.overlay.changes[k])) notes.push('Replaces a pending change you already have for this publication.');
      const id = keys.join('|');
      const importable = !(status === 'delete' && !published.has(key));
      rows.push({
        id, keys, status, notes, importable,
        entry: { key, type: c.entry?.type || '', fields: { title, year: c.entry?.fields?.year || published.get(key)?.fields.year || '' } },
        checked: importable && (prev.has(id) ? prev.get(id) : true),
      });
    }
    return rows;
  }

  function compute() {
    candidates = source.mode === 'overlay' ? overlayCandidates() : bibCandidates();
  }

  function review() {
    candidates = [];
    source = parseInput(text.value);
    compute();
    draw();
  }

  const selectedCount = () => candidates.filter((c) => c.checked).length;
  const noun = () => (source?.mode === 'overlay' ? ['change', 'changes'] : ['entry', 'entries']);

  function rowHtml(c) {
    const authors = source.mode === 'overlay' ? '' : splitNames(c.entry.fields.author).map((n) => displayName(parseName(n)).replace(/^(.*), (.*)$/, '$2 $1')).join(', ');
    return html`<tr class="${c.importable ? '' : 'adm-row-muted'}">
      <td class="adm-cell-check"><label class="adm-hit"><input type="checkbox" data-id="${c.id}" aria-label="Import ${c.entry.fields.title || c.entry.key}" ${c.checked ? raw('checked') : ''} ${c.importable ? '' : raw('disabled')}></label></td>
      <td class="adm-cell-main"><span class="adm-row-title">${c.entry.fields.title || '(no title)'}</span>
        ${authors ? html`<div class="adm-row-authors">${authors}${c.authorsChanged ? html` <span class="adm-small">(names rewritten)</span>` : ''}</div>` : ''}
        <div class="adm-row-authors"><code>${c.entry.key}</code></div>
        ${c.notes.map((n) => html`<div class="adm-small adm-warn-text"><i class="fa fa-triangle-exclamation" aria-hidden="true"></i> ${n}</div>`)}</td>
      <td class="adm-cell-year">${c.entry.fields.year || '—'}</td>
      ${source.mode === 'overlay' ? '' : html`<td class="adm-cell-type">${TYPES[c.entry.type]?.[0] || c.entry.type}</td>`}
      <td><span class="adm-badge adm-badge-${c.status}">${STATUS_LABELS[c.status]}</span></td>
    </tr>`;
  }

  function rowsHtml() {
    // A full backup holds every publication; do not list hundreds of unchanged ones.
    const same = candidates.filter((c) => c.status === 'same');
    const shown = same.length > 5 ? candidates.filter((c) => c.status !== 'same') : candidates;
    const head = html`<thead><tr><th scope="col"><span class="screen-reader-text">Import</span></th><th scope="col">Publication</th><th scope="col">Year</th>${source.mode === 'overlay' ? '' : html`<th scope="col">Type</th>`}<th scope="col">Result</th></tr></thead>`;
    return html`
      ${shown.length ? html`<div class="adm-table-wrap"><table class="adm-table adm-import-table">${head}<tbody>${shown.map(rowHtml)}</tbody></table></div>` : ''}
      ${same.length > 5 ? html`<p class="adm-muted adm-mt">${plural(same.length, 'entry is', 'entries are')} already identical to the list here and will be skipped.</p>` : ''}`;
  }

  function updateCount() {
    const n = selectedCount();
    const [one, many] = noun();
    $('#imp-count', main).textContent = `${plural(n, one, many)} selected`;
    const btn = $('[data-act="import"]', main);
    btn.disabled = !n;
    btn.textContent = `Import ${plural(n, one, many)}`;
  }

  function draw() {
    const out = $('#imp-review', main);
    const errors = source.errors || [];
    // Name style and extra tag only apply to BibTeX entries, not to a pending-changes file.
    $('.adm-options', main).disabled = source.mode === 'overlay';
    if (!candidates.length && !errors.length) {
      out.innerHTML = html`<div class="adm-alert" role="status">${source.mode === 'overlay' ? 'This pending-changes file is empty.' : raw('No BibTeX entries found. Each entry starts with <code>@type{key,</code>.')}</div>`.toString();
      return;
    }
    const [one, many] = noun();
    out.innerHTML = html`
      ${errors.length ? html`<div class="adm-alert adm-alert-error" role="alert"><strong>${plural(errors.length, 'entry', 'entries')} could not be read and will be skipped:</strong><ul>${errors.map((e) => html`<li>${e.message}</li>`)}</ul></div>` : ''}
      ${candidates.length ? html`<section class="adm-card" aria-labelledby="imp-review-title">
        <h2 id="imp-review-title" tabindex="-1">Review ${plural(candidates.length, one, many)}</h2>
        ${source.mode === 'overlay' ? html`<p class="adm-muted">Pending changes from another browser. They are added to your own pending changes; nothing goes live until you publish.</p>` : ''}
        <div id="imp-rows">${rowsHtml()}</div>
        <div class="adm-actions adm-mt">
          <span class="adm-muted" id="imp-count" aria-live="polite"></span>
          <span class="adm-savebar-spacer"></span>
          <button type="button" class="adm-btn adm-btn-primary" data-act="import"></button>
        </div>
      </section>` : ''}`.toString();
    if (candidates.length) updateCount();
  }

  /** Options changed: recompute rows in place (the Import button stays put). */
  const refreshRows = () => {
    if (!main.isConnected || !source || source.mode !== 'bib' || !candidates.length) return;
    compute();
    $('#imp-rows', main).innerHTML = rowsHtml().toString();
    updateCount();
  };
  const refreshRowsSoon = debounce(refreshRows, 250);

  main.addEventListener('input', (e) => {
    if (e.target.id === 'imp-tag') refreshRowsSoon();
  });

  main.addEventListener('change', (e) => {
    if (e.target.id === 'imp-lab-names') { refreshRows(); return; }
    const id = e.target.dataset.id;
    if (id === undefined) return;
    const c = candidates.find((x) => x.id === id);
    if (c) c.checked = e.target.checked;
    updateCount();
  });

  main.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'preview') {
      if (!text.value.trim()) { toast('Paste BibTeX or choose a file first.', 'error'); text.focus(); return; }
      review();
      const target = $('#imp-review-title', main) || $('#imp-review .adm-alert', main);
      scrollToEl(target);
      target?.focus?.({ preventScroll: true });
    } else if (act === 'import') {
      if (source.mode === 'overlay') importOverlayRows();
      else importEntries();
    }
  });

  function importEntries() {
    compute(); // pick up an option typed just before clicking
    const chosen = candidates.filter((c) => c.checked);
    if (!chosen.length) return;
    let done = 0;
    try {
      for (const c of chosen) {
        store.upsert(c.entry, { user: ctx.user.username });
        done++;
      }
    } catch (err) {
      toast(`Stopped after ${plural(done, 'entry', 'entries')}: ${err.message}`, 'error');
      if (!done) return;
    }
    toast(`Imported ${plural(done, 'entry', 'entries')}. Review them under Pending changes.`, 'success', 6000);
    ctx.navigate('/changes');
  }

  function importOverlayRows() {
    const keys = new Set(candidates.filter((c) => c.checked).flatMap((c) => c.keys));
    if (!keys.size) return;
    const all = source.overlay.changes;
    const picked = Object.fromEntries(Object.entries(all).filter(([k]) => keys.has(k)));
    try {
      const r = store.importOverlay({ ...source.overlay, changes: picked }, { merge: true });
      toast(`Loaded ${plural(r.added + r.replaced, 'pending change')}${r.replaced ? ` (${r.replaced} replaced your own)` : ''}.`, 'success', 6000);
      ctx.navigate('/changes');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}
