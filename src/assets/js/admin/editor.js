/** Add / edit a single publication, with live preview and validation. */
import { TYPES, PUBSTATES, toPublication, renderPublication, splitNames, facets } from '../lib/publications.js';
import { parseBibtexWithErrors, serializeEntry } from '../lib/bibtex.js';
import { bindToggles } from '../publist.js';
import { siteBase } from '../store.js';
import { html, raw, $, $$, toast, confirmDialog, debounce, statusBadge } from './ui.js';
import { FIELD_LABELS, FIELD_HELP, MANAGED_FIELDS, EXTRA_FIELDS, venueFields, requiredFields, suggestKey, validateEntry, appearsOn, knownAuthorSet } from './model.js';

const TEXTAREA_FIELDS = new Set(['booktitle', 'journal', 'note', 'howpublished']);

export function renderEditor(main, ctx, key, params) {
  const { store } = ctx;
  const isNew = key === null;
  let original = isNew ? null : store.get(key);
  if (!isNew && !original) {
    main.innerHTML = html`<div class="adm-empty"><h1>Publication not found</h1><p>No publication has the key <code>${key}</code>. It may have been deleted or renamed.</p><p><a class="adm-btn" href="#/publications">Back to publications</a></p></div>`.toString();
    return;
  }

  const from = isNew && params.get('from') ? store.get(params.get('from')) : null;
  const year = String(new Date().getFullYear());
  let entry = original
    ? structuredClone(original)
    : from
      ? { type: from.type, key: '', fields: { ...from.fields, title: `${from.fields.title || ''} (copy)` } }
      : { type: 'inproceedings', key: '', fields: { year, date: new Date().toISOString().slice(0, 10), pubstate: 'published' } };
  let keyTouched = !isNew;
  let rawMode = false;
  let showErrors = false;
  let dirty = false;

  const allPubs = store.publications();
  const existingKeys = new Set(store.entries().map((e) => e.key));
  const knownAuthors = knownAuthorSet(allPubs);
  const { tags: knownTags, tagCounts } = facets(allPubs);
  const projectTags = new Set(ctx.config.projects.flatMap((p) => p.filter.tags || []));
  if (isNew) entry.key = suggestKey(entry.fields, existingKeys);

  const markDirty = () => {
    dirty = true;
    ctx.guard = true;
  };

  function currentTags() {
    return String(entry.fields.keywords || '').split(',').map((t) => t.trim()).filter(Boolean);
  }

  function setTags(list) {
    entry.fields.keywords = [...new Set(list)].join(', ');
  }

  function fieldInput(name, { required = false, wide = false } = {}) {
    const value = entry.fields[name] ?? '';
    const id = `f-${name}`;
    const help = FIELD_HELP[name];
    const control = TEXTAREA_FIELDS.has(name)
      ? html`<textarea id="${id}" data-field="${name}" rows="2" ${help ? raw(`aria-describedby="${id}-help"`) : ''}>${value}</textarea>`
      : html`<input id="${id}" data-field="${name}" type="text" value="${value}" ${help ? raw(`aria-describedby="${id}-help"`) : ''} autocomplete="off">`;
    return html`<div class="adm-field ${wide ? 'adm-field-wide' : ''}" data-for="${name}">
      <label class="adm-label" for="${id}">${FIELD_LABELS[name] || name}${required ? html` <span class="adm-req" aria-hidden="true">*</span>` : ''}</label>
      ${control}
      ${help ? html`<span class="adm-help" id="${id}-help">${help}</span>` : ''}
      <span class="adm-field-msg" aria-live="polite"></span>
    </div>`;
  }

  function otherFields() {
    const shown = new Set([...MANAGED_FIELDS].filter((f) => !venueFields(entry.type).includes(f) && !['note'].includes(f)));
    const venue = new Set(venueFields(entry.type));
    const names = new Set(EXTRA_FIELDS);
    for (const [k, v] of Object.entries(entry.fields)) {
      if (String(v).trim() && !venue.has(k) && !['title', 'author', 'year', 'date', 'pubstate', 'keywords', 'abstract', 'url', 'doi', 'tppubtype'].includes(k)) names.add(k);
    }
    void shown;
    return [...names];
  }

  function formHtml() {
    const req = requiredFields(entry.type);
    const authors = splitNames(entry.fields.author).join('\n');
    const tags = currentTags();
    const tagChoices = [...new Set([...knownTags, ...tags])];
    const status = isNew ? 'new' : store.statusOf(key);
    return html`
      <div class="adm-page-head">
        <div>
          <p class="adm-crumb"><a href="#/publications">Publications</a> /</p>
          <h1>${isNew ? (from ? 'Duplicate publication' : 'Add publication') : 'Edit publication'}</h1>
          ${!isNew ? html`<p class="adm-sub">${statusBadge(status)} <code>${key}</code></p>` : ''}
        </div>
        <div class="adm-head-actions">
          <button type="button" class="adm-btn adm-btn-ghost" data-act="raw" aria-pressed="${rawMode}"><i class="fa fa-code" aria-hidden="true"></i> ${rawMode ? 'Back to form' : 'Edit as BibTeX'}</button>
        </div>
      </div>
      <div class="adm-alert adm-alert-error adm-error-summary" role="alert" tabindex="-1" hidden></div>
      <div class="adm-editor">
        <form class="adm-form adm-editor-form" novalidate autocomplete="off">
          ${rawMode ? html`
            <section class="adm-card">
              <h2>BibTeX source</h2>
              <p class="adm-muted adm-small">Edit the entry directly. Use <code>keywords</code> for tags and one link per line in <code>url</code>.</p>
              <textarea class="adm-code" id="raw-bib" rows="22" spellcheck="false" aria-label="BibTeX source">${serializeEntry(entry)}</textarea>
              <div class="adm-actions"><button type="button" class="adm-btn adm-btn-primary" data-act="apply-raw">Apply to form</button></div>
            </section>` : html`
          <section class="adm-card">
            <h2>Publication</h2>
            <div class="adm-row">
              <div class="adm-field" data-for="type">
                <label class="adm-label" for="f-type">Type <span class="adm-req" aria-hidden="true">*</span></label>
                <select id="f-type" data-entry="type">${Object.entries(TYPES).map(([t, [label]]) => html`<option value="${t}" ${t === entry.type ? raw('selected') : ''}>${label} (${t})</option>`)}</select>
                <span class="adm-field-msg"></span>
              </div>
              <div class="adm-field" data-for="pubstate">
                <label class="adm-label" for="f-pubstate">Status</label>
                <select id="f-pubstate" data-field="pubstate">${Object.entries(PUBSTATES).map(([v, label]) => html`<option value="${v}" ${v === (entry.fields.pubstate || 'published').split(',')[0].trim().toLowerCase() ? raw('selected') : ''}>${label}</option>`)}</select>
                <span class="adm-help">Anything but Published shows a label next to the title.</span>
              </div>
            </div>
            <div class="adm-field adm-field-wide" data-for="title">
              <label class="adm-label" for="f-title">Title <span class="adm-req" aria-hidden="true">*</span></label>
              <textarea id="f-title" data-field="title" rows="2" required>${entry.fields.title || ''}</textarea>
              <span class="adm-field-msg"></span>
            </div>
            <div class="adm-field adm-field-wide" data-for="author">
              <label class="adm-label" for="f-author">Authors${req.has('author') ? html` <span class="adm-req" aria-hidden="true">*</span>` : ''}</label>
              <textarea id="f-author" data-authors rows="${Math.max(3, Math.min(10, authors.split('\n').length + 1))}" aria-describedby="f-author-help" spellcheck="false">${authors}</textarea>
              <span class="adm-help" id="f-author-help">One author per line, in order, written as on other papers (e.g. <code>K Bekris</code>).</span>
              <span class="adm-field-msg"></span>
            </div>
            <div class="adm-row">
              <div class="adm-field" data-for="year">
                <label class="adm-label" for="f-year">Year <span class="adm-req" aria-hidden="true">*</span></label>
                <input id="f-year" data-field="year" type="text" inputmode="numeric" maxlength="4" value="${entry.fields.year || ''}">
                <span class="adm-field-msg"></span>
              </div>
              <div class="adm-field" data-for="date">
                <label class="adm-label" for="f-date">Date</label>
                <input id="f-date" data-field="date" type="date" value="${entry.fields.date || ''}" aria-describedby="f-date-help">
                <span class="adm-help" id="f-date-help">Orders papers within a year (newest first).</span>
                <span class="adm-field-msg"></span>
              </div>
            </div>
          </section>

          <section class="adm-card">
            <h2>Venue</h2>
            <div class="adm-grid-fields">
              ${venueFields(entry.type).map((f) => (f === 'editor'
                ? html`<div class="adm-field adm-field-wide" data-for="editor"><label class="adm-label" for="f-editor">Editors</label><textarea id="f-editor" data-names="editor" rows="2" spellcheck="false">${splitNames(entry.fields.editor).join('\n')}</textarea><span class="adm-help">One per line.</span><span class="adm-field-msg"></span></div>`
                : fieldInput(f, { required: req.has(f), wide: ['booktitle', 'journal', 'school', 'institution', 'howpublished', 'issuetitle'].includes(f) })))}
            </div>
          </section>

          <section class="adm-card">
            <h2>Tags</h2>
            <p class="adm-muted adm-small" id="tags-help">Tags decide which project pages list this paper.</p>
            <div class="adm-tag-picker" role="group" aria-describedby="tags-help">
              ${tagChoices.map((t) => html`<label class="adm-chip ${projectTags.has(t) ? 'adm-chip-project' : ''}"><input type="checkbox" data-tag="${t}" ${tags.includes(t) ? raw('checked') : ''}><span>${t}</span>${tagCounts.get(t) ? html`<span class="adm-chip-count">${tagCounts.get(t)}</span>` : ''}</label>`)}
            </div>
            <div class="adm-inline-add">
              <label class="screen-reader-text" for="new-tag">New tag</label>
              <input id="new-tag" type="text" placeholder="New tag…">
              <button type="button" class="adm-btn adm-btn-sm" data-act="add-tag">Add tag</button>
            </div>
            <span class="adm-field-msg" data-msg-for="keywords"></span>
          </section>

          <section class="adm-card">
            <h2>Links</h2>
            <div class="adm-field adm-field-wide" data-for="url">
              <label class="adm-label" for="f-url">Links</label>
              <textarea id="f-url" data-field="url" rows="3" spellcheck="false" aria-describedby="f-url-help">${entry.fields.url || ''}</textarea>
              <span class="adm-help" id="f-url-help">One per line: arXiv, PDF, project page, video… Optionally add a label after a comma: <code>https://…, Project page</code>.</span>
              <span class="adm-field-msg"></span>
            </div>
            ${fieldInput('doi', { wide: true })}
          </section>

          <section class="adm-card">
            <h2>Abstract</h2>
            <div class="adm-field adm-field-wide" data-for="abstract">
              <label class="screen-reader-text" for="f-abstract">Abstract</label>
              <textarea id="f-abstract" data-field="abstract" rows="8">${entry.fields.abstract || ''}</textarea>
              <span class="adm-field-msg"></span>
            </div>
          </section>

          <details class="adm-card adm-details" ${otherFields().some((f) => entry.fields[f]) ? raw('open') : ''}>
            <summary><h2>More fields</h2></summary>
            <div class="adm-grid-fields">
              ${otherFields().map((f) => fieldInput(f, { wide: ['note', 'annote', 'crossref', 'image'].includes(f) }))}
            </div>
            <div class="adm-inline-add">
              <label class="screen-reader-text" for="new-field">Field name</label>
              <input id="new-field" type="text" placeholder="Other BibTeX field, e.g. month">
              <button type="button" class="adm-btn adm-btn-sm" data-act="add-field">Add field</button>
            </div>
          </details>

          <section class="adm-card">
            <h2>Citation key</h2>
            <div class="adm-field adm-field-wide" data-for="key">
              <label class="adm-label" for="f-key">Key <span class="adm-req" aria-hidden="true">*</span></label>
              <div class="adm-input-group">
                <input id="f-key" data-entry="key" type="text" value="${entry.key}" spellcheck="false" aria-describedby="f-key-help">
                <button type="button" class="adm-btn" data-act="suggest-key">Suggest</button>
              </div>
              <span class="adm-help" id="f-key-help">Unique ID used in BibTeX, e.g. <code>bekris2024state</code>.${!isNew ? ' Changing it renames the entry.' : ''}</span>
              <span class="adm-field-msg"></span>
            </div>
          </section>`}

          <div class="adm-savebar">
            <div class="adm-savebar-inner">
              ${!isNew ? html`<button type="button" class="adm-btn adm-btn-danger-ghost" data-act="delete"><i class="fa fa-trash-can" aria-hidden="true"></i> Delete</button>` : ''}
              ${!isNew && store.statusOf(key) === 'edited' ? html`<button type="button" class="adm-btn adm-btn-ghost" data-act="revert">Revert to live version</button>` : ''}
              <span class="adm-savebar-spacer"></span>
              <a class="adm-btn" href="#/publications">Cancel</a>
              ${isNew ? html`<button type="submit" class="adm-btn" data-act="save-another">Save &amp; add another</button>` : ''}
              <button type="submit" class="adm-btn adm-btn-primary" data-act="save">Save</button>
            </div>
          </div>
        </form>

        <aside class="adm-editor-side" aria-label="Preview">
          <section class="adm-card adm-preview">
            <h2>Preview</h2>
            <div class="adm-preview-box tp-preview" id="adm-preview"></div>
          </section>
          <section class="adm-card">
            <h2>Appears on</h2>
            <ul class="adm-appears" id="adm-appears"></ul>
          </section>
          <section class="adm-card" id="adm-checks-card">
            <h2>Checks</h2>
            <ul class="adm-checks" id="adm-checks"></ul>
          </section>
        </aside>
      </div>`;
  }

  function draw() {
    main.innerHTML = formHtml().toString();
    bindToggles($('#adm-preview', main));
    update();
  }

  function update() {
    const pub = toPublication(entry);
    $('#adm-preview', main).innerHTML = renderPublication(pub, { showTags: true, tagHref: (t) => `${siteBase()}papers/?tag=${encodeURIComponent(t)}`, idPrefix: 'pv' });
    $('#adm-appears', main).innerHTML = appearsOn(entry, ctx.config)
      .map((p) => html`<li><a href="${siteBase()}${p.href}" target="_blank" rel="noopener">${p.label}</a></li>`).join('');
    const result = validateEntry(entry, { existingKeys, originalKey: isNew ? null : key, knownAuthors });
    $('#adm-checks', main).innerHTML = [...result.errors.map((e) => ({ ...e, level: 'error' })), ...result.warnings.map((w) => ({ ...w, level: 'warn' }))]
      .map((m) => html`<li class="adm-check-${m.level}"><i class="fa ${m.level === 'error' ? 'fa-circle-xmark' : 'fa-triangle-exclamation'}" aria-hidden="true"></i> <span><strong>${m.field === 'keywords' ? 'Tags' : FIELD_LABELS[m.field] || (m.field === 'key' ? 'Key' : m.field === 'type' ? 'Type' : m.field)}:</strong> ${m.message}</span></li>`).join('')
      || '<li class="adm-check-ok"><i class="fa fa-circle-check" aria-hidden="true"></i> Looks good.</li>';
    // Inline field messages: errors only after a save attempt, warnings always.
    for (const el of $$('.adm-field-msg', main)) {
      el.textContent = '';
      el.className = 'adm-field-msg';
    }
    for (const el of $$('.adm-field[aria-invalid], [aria-invalid]', main)) el.removeAttribute('aria-invalid');
    const place = (m, level) => {
      const holder = main.querySelector(`.adm-field[data-for="${m.field}"] .adm-field-msg, [data-msg-for="${m.field}"]`);
      if (!holder || holder.textContent) return;
      holder.textContent = m.message;
      holder.className = `adm-field-msg adm-msg-${level}`;
      if (level === 'error') main.querySelector(`.adm-field[data-for="${m.field}"] :is(input, textarea, select)`)?.setAttribute('aria-invalid', 'true');
    };
    if (showErrors) result.errors.forEach((m) => place(m, 'error'));
    result.warnings.filter((w) => ['author', 'url', 'doi', 'date'].includes(w.field)).forEach((m) => place(m, 'warn'));
    return result;
  }

  const lazyUpdate = debounce(update, 120);

  main.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'raw-bib') { markDirty(); return; }
    if (t.id === 'new-tag' || t.id === 'new-field') return;
    if (t.dataset.field) entry.fields[t.dataset.field] = t.value;
    else if (t.dataset.authors !== undefined) entry.fields.author = t.value.split('\n').map((s) => s.trim()).filter(Boolean).join(' and ');
    else if (t.dataset.names) entry.fields[t.dataset.names] = t.value.split('\n').map((s) => s.trim()).filter(Boolean).join(' and ');
    else if (t.dataset.entry === 'key') { entry.key = t.value.trim(); keyTouched = true; }
    else return;
    if (isNew && !keyTouched && ['author', 'title', 'year'].some((f) => t.dataset.field === f || (f === 'author' && t.dataset.authors !== undefined))) {
      entry.key = suggestKey(entry.fields, existingKeys);
      const k = $('#f-key', main);
      if (k) k.value = entry.key;
    }
    if (t.dataset.field === 'date' && t.value && !entry.fields.year) {
      entry.fields.year = t.value.slice(0, 4);
      const y = $('#f-year', main);
      if (y) y.value = entry.fields.year;
    }
    markDirty();
    lazyUpdate();
  });

  main.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.entry === 'type') {
      entry.type = t.value;
      entry.fields.tppubtype = t.value;
      markDirty();
      draw();
      $('#f-type', main)?.focus();
    } else if (t.dataset.tag) {
      const tags = currentTags().filter((x) => x !== t.dataset.tag);
      if (t.checked) tags.push(t.dataset.tag);
      setTags(tags);
      markDirty();
      update();
    }
  });

  main.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.id === 'new-tag' || e.target.id === 'new-field')) {
      e.preventDefault();
      main.querySelector(`[data-act="${e.target.id === 'new-tag' ? 'add-tag' : 'add-field'}"]`).click();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save(false);
    }
  });

  main.addEventListener('submit', (e) => {
    e.preventDefault();
    save(e.submitter?.dataset.act === 'save-another');
  });

  main.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || act === 'save' || act === 'save-another') return;
    if (act === 'raw') {
      if (rawMode && !applyRaw()) return;
      rawMode = !rawMode;
      draw();
    } else if (act === 'apply-raw') {
      if (applyRaw()) {
        rawMode = false;
        draw();
        toast('BibTeX applied to the form.', 'success');
      }
    } else if (act === 'add-tag') {
      const input = $('#new-tag', main);
      const tag = input.value.trim().replace(/,/g, '');
      if (!tag) { input.focus(); return; }
      setTags([...currentTags(), tag]);
      markDirty();
      draw();
      $('#new-tag', main)?.focus();
    } else if (act === 'add-field') {
      const input = $('#new-field', main);
      const name = input.value.trim().toLowerCase();
      if (!/^[a-z][a-z0-9_-]*$/.test(name)) { toast('Field names use letters, numbers, - and _.', 'error'); input.focus(); return; }
      if (!(name in entry.fields)) entry.fields[name] = ' ';
      draw();
      $(`#f-${CSS.escape(name)}`, main)?.focus();
    } else if (act === 'suggest-key') {
      entry.key = suggestKey(entry.fields, new Set([...existingKeys].filter((k) => k !== key)));
      $('#f-key', main).value = entry.key;
      keyTouched = true;
      markDirty();
      update();
    } else if (act === 'delete') {
      const ok = await confirmDialog({
        title: 'Delete this publication?',
        body: 'It will disappear from the site when you next publish. You can restore it from Pending changes until then.',
        confirm: 'Delete',
        danger: true,
      });
      if (!ok) return;
      store.remove(key, { user: ctx.user.username });
      ctx.guard = null;
      toast('Publication deleted.', 'success');
      ctx.navigate('/publications');
    } else if (act === 'revert') {
      const ok = await confirmDialog({ title: 'Revert to the live version?', body: 'Your unpublished edits to this paper will be lost.', confirm: 'Revert', danger: true });
      if (!ok) return;
      store.revert(key);
      ctx.guard = null;
      original = store.get(key);
      entry = structuredClone(original);
      dirty = false;
      draw();
      toast('Reverted.', 'success');
    }
  });

  function applyRaw() {
    const text = $('#raw-bib', main)?.value ?? '';
    const { entries, errors } = parseBibtexWithErrors(text);
    if (errors.length || entries.length !== 1) {
      toast(errors[0]?.message || 'Paste exactly one BibTeX entry.', 'error', 6000);
      return false;
    }
    const parsed = entries[0];
    entry = { type: TYPES[parsed.fields.tppubtype] ? parsed.fields.tppubtype : (TYPES[parsed.type] ? parsed.type : 'misc'), key: parsed.key, fields: parsed.fields };
    keyTouched = true;
    markDirty();
    return true;
  }

  function save(addAnother) {
    if (rawMode && !applyRaw()) return;
    // Trim whitespace-only placeholder fields.
    for (const [k, v] of Object.entries(entry.fields)) if (!String(v).trim()) delete entry.fields[k];
    entry.fields.tppubtype = entry.type;
    if (!entry.fields.pubstate) entry.fields.pubstate = 'published';
    if (rawMode) { rawMode = false; draw(); }
    showErrors = true;
    const result = update();
    const summary = $('.adm-error-summary', main);
    if (result.errors.length) {
      summary.innerHTML = html`<strong>Please fix ${result.errors.length === 1 ? 'this' : 'these'} before saving:</strong><ul>${result.errors.map((er) => html`<li><a href="#" data-focus="${er.field}">${er.message}</a></li>`)}</ul>`.toString();
      summary.hidden = false;
      summary.focus();
      summary.querySelectorAll('[data-focus]').forEach((a) => a.addEventListener('click', (ev) => {
        ev.preventDefault();
        const f = a.dataset.focus;
        main.querySelector(`.adm-field[data-for="${f}"] :is(input, textarea, select)`)?.focus();
      }));
      return;
    }
    summary.hidden = true;
    const saved = store.upsert(entry, { previousKey: isNew ? null : key, user: ctx.user.username });
    dirty = false;
    ctx.guard = null;
    const live = store.statusOf(saved.key) === 'published';
    toast(live ? 'No differences from the live version.' : `Saved “${(saved.fields.title || saved.key).slice(0, 60)}”. It is in your pending changes.`, 'success', 6000);
    if (addAnother) {
      ctx.navigate(`/publications/new?t=${Date.now()}`);
    } else {
      ctx.navigate(`/publications?q=${encodeURIComponent(saved.key)}`);
    }
  }

  void dirty;
  draw();
}
