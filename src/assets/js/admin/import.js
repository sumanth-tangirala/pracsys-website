/** Import BibTeX (or a JSON backup) with a review step before anything changes. */
import { TYPES } from '../lib/publications.js';
import { parseBibtexWithErrors } from '../lib/bibtex.js';
import { entriesEqual } from '../store.js';
import { html, raw, $, $$, toast, plural } from './ui.js';
import { KEY_PATTERN } from './model.js';

const normTitle = (t) => String(t || '').toLowerCase().replace(/[{}\\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function renderImport(main, ctx) {
  const { store } = ctx;
  let candidates = [];

  main.innerHTML = html`
    <div class="adm-page-head"><div><h1>Import BibTeX</h1>
      <p class="adm-sub">Paste entries from Google Scholar, DBLP, Overleaf or a teachPress export. You will review everything before it is added.</p></div></div>
    <section class="adm-card">
      <div class="adm-dropzone" tabindex="-1">
        <label class="adm-label" for="imp-text">BibTeX</label>
        <textarea id="imp-text" class="adm-code" rows="12" spellcheck="false" placeholder="@inproceedings{key,&#10;  title = {…},&#10;  author = {…},&#10;  booktitle = {…},&#10;  year = {2026}&#10;}"></textarea>
        <div class="adm-actions">
          <label class="adm-btn adm-file"><i class="fa fa-folder-open" aria-hidden="true"></i> Choose a .bib or .json file<input type="file" id="imp-file" accept=".bib,.bibtex,.txt,.json,application/json,text/plain"></label>
          <span class="adm-muted adm-small">…or drop a file onto the box.</span>
          <span class="adm-savebar-spacer"></span>
          <button type="button" class="adm-btn adm-btn-primary" data-act="preview">Review import</button>
        </div>
      </div>
      <div class="adm-row adm-mt">
        <div class="adm-field">
          <label class="adm-label" for="imp-tag">Add a tag to every imported entry (optional)</label>
          <input id="imp-tag" type="text" list="imp-tags" placeholder="e.g. Planning">
          <datalist id="imp-tags"></datalist>
        </div>
      </div>
    </section>
    <div id="imp-review"></div>`.toString();

  const tags = [...new Set(store.publications().flatMap((p) => p.tags))].sort();
  $('#imp-tags', main).innerHTML = tags.map((t) => `<option value="${t}">`).join('');

  const text = $('#imp-text', main);
  const file = $('#imp-file', main);
  const zone = $('.adm-dropzone', main);

  async function readFile(f) {
    if (f.size > 5e6) { toast('That file is larger than 5 MB.', 'error'); return; }
    text.value = await f.text();
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
      try {
        const data = JSON.parse(trimmed);
        const list = Array.isArray(data) ? data : data.entries;
        if (!Array.isArray(list)) throw new Error('No "entries" array found.');
        return { entries: list.filter((e) => e && e.key && e.fields), errors: [] };
      } catch (err) {
        return { entries: [], errors: [{ message: `JSON backup could not be read: ${err.message}` }] };
      }
    }
    return parseBibtexWithErrors(value);
  }

  function review() {
    const { entries, errors } = parseInput(text.value);
    const byTitle = new Map(store.entries().map((e) => [normTitle(e.fields.title), e.key]));
    const extraTag = $('#imp-tag', main).value.trim();
    const seen = new Set();
    candidates = entries.map((e) => {
      const fields = { ...e.fields };
      let type = String(fields.tppubtype || e.type || 'misc').toLowerCase();
      if (!TYPES[type]) type = 'misc';
      fields.tppubtype = type;
      fields.pubstate ||= 'published';
      if (!fields.year && fields.date) fields.year = String(fields.date).slice(0, 4);
      if (extraTag) {
        const t = String(fields.keywords || '').split(',').map((x) => x.trim()).filter(Boolean);
        if (!t.includes(extraTag)) t.push(extraTag);
        fields.keywords = t.join(', ');
      }
      const entry = { type, key: e.key, fields };
      const existing = store.get(e.key);
      let status = 'new';
      let note = '';
      if (!e.key || !KEY_PATTERN.test(e.key)) { status = 'invalid'; note = 'Missing or invalid citation key.'; }
      else if (seen.has(e.key)) { status = 'invalid'; note = 'Key appears twice in this import.'; }
      else if (!fields.title) { status = 'invalid'; note = 'No title.'; }
      else if (existing && entriesEqual(existing, entry)) status = 'same';
      else if (existing) status = 'update';
      else if (byTitle.has(normTitle(fields.title))) note = `Same title as existing “${byTitle.get(normTitle(fields.title))}”.`;
      seen.add(e.key);
      return { entry, status, note, checked: status === 'new' || status === 'update' };
    });
    draw(errors);
  }

  function draw(errors = []) {
    const out = $('#imp-review', main);
    if (!candidates.length && !errors.length) {
      out.innerHTML = html`<div class="adm-alert">No BibTeX entries found. Each entry starts with <code>@type{key,</code>.</div>`.toString();
      return;
    }
    const labels = { new: 'New', update: 'Updates existing', same: 'Already identical', invalid: 'Cannot import' };
    const n = candidates.filter((c) => c.checked).length;
    out.innerHTML = html`
      ${errors.length ? html`<div class="adm-alert adm-alert-error"><strong>${plural(errors.length, 'entry', 'entries')} could not be read:</strong><ul>${errors.map((e) => html`<li>${e.message}</li>`)}</ul></div>` : ''}
      ${candidates.length ? html`<section class="adm-card">
        <h2>Review ${plural(candidates.length, 'entry', 'entries')}</h2>
        <div class="adm-table-wrap"><table class="adm-table">
          <thead><tr><th scope="col"><span class="screen-reader-text">Import</span></th><th scope="col">Publication</th><th scope="col">Year</th><th scope="col">Type</th><th scope="col">Result</th></tr></thead>
          <tbody>${candidates.map((c, i) => html`<tr class="${c.status === 'invalid' || c.status === 'same' ? 'adm-row-muted' : ''}">
            <td><input type="checkbox" data-i="${i}" aria-label="Import ${c.entry.fields.title || c.entry.key}" ${c.checked ? raw('checked') : ''} ${c.status === 'invalid' || c.status === 'same' ? raw('disabled') : ''}></td>
            <td class="adm-cell-main"><span class="adm-row-title">${c.entry.fields.title || '(no title)'}</span><div class="adm-row-authors"><code>${c.entry.key}</code></div>${c.note ? html`<div class="adm-small adm-warn-text"><i class="fa fa-triangle-exclamation" aria-hidden="true"></i> ${c.note}</div>` : ''}</td>
            <td>${c.entry.fields.year || '—'}</td>
            <td>${TYPES[c.entry.type]?.[0] || c.entry.type}</td>
            <td><span class="adm-badge adm-badge-${c.status}">${labels[c.status]}</span></td>
          </tr>`)}</tbody></table></div>
        <div class="adm-actions adm-mt">
          <span class="adm-muted" id="imp-count">${plural(n, 'entry', 'entries')} selected</span>
          <span class="adm-savebar-spacer"></span>
          <button type="button" class="adm-btn adm-btn-primary" data-act="import" ${n ? '' : raw('disabled')}>Import ${plural(n, 'entry', 'entries')}</button>
        </div>
      </section>` : ''}`.toString();
  }

  main.addEventListener('change', (e) => {
    if (e.target.dataset.i === undefined) {
      if (e.target.id === 'imp-tag' && candidates.length) review();
      return;
    }
    candidates[Number(e.target.dataset.i)].checked = e.target.checked;
    const n = candidates.filter((c) => c.checked).length;
    $('#imp-count', main).textContent = `${plural(n, 'entry', 'entries')} selected`;
    const btn = $('[data-act="import"]', main);
    btn.disabled = !n;
    btn.textContent = `Import ${plural(n, 'entry', 'entries')}`;
  });

  main.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'preview') {
      if (!text.value.trim()) { toast('Paste BibTeX or choose a file first.', 'error'); text.focus(); return; }
      review();
      $('#imp-review', main).scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (act === 'import') {
      const chosen = candidates.filter((c) => c.checked);
      for (const c of chosen) store.upsert(c.entry, { user: ctx.user.username });
      toast(`Imported ${plural(chosen.length, 'entry', 'entries')}. Review them under Pending changes.`, 'success', 6000);
      ctx.navigate('/changes');
    }
  });
  void $$;
}
