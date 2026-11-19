/** Add / edit a single publication, with live preview and validation. */
import { TYPES, PUBSTATES, toPublication, renderPublication, splitNames, facets } from '../lib/publications.js';
import { parseBibtexWithErrors, serializeEntry } from '../lib/bibtex.js';
import { bindToggles } from '../publist.js';
import { siteBase } from '../store.js';
import { html, raw, $, $$, toast, confirmDialog, dialogIsOpen, debounce, statusBadge, attempt } from './ui.js';
import { FIELD_LABELS, FIELD_HELP, EXTRA_FIELDS, venueFields, requiredFields, suggestKey, validateEntry, appearsOn, knownAuthorSet, titleIndex } from './model.js';

const TEXTAREA_FIELDS = new Set(['booktitle', 'journal', 'note', 'howpublished', 'annote']);
/** Fields with their own controls; anything else with a value goes under "More fields". */
const CORE_FIELDS = new Set(['title', 'author', 'year', 'date', 'pubstate', 'keywords', 'abstract', 'url', 'doi', 'tppubtype']);
/** Warnings about content the user typed are shown next to the field right away. */
const CONTENT_WARNINGS = new Set(['author', 'url', 'doi', 'date', 'title']);

export function renderEditor(main, ctx, key, params) {
  const { store } = ctx;
  const isNew = key === null;
  const original = isNew ? null : store.get(key);
  if (!isNew && !original) {
    const deleted = store.statusOf(key) === 'deleted';
    main.innerHTML = html`<div class="adm-empty"><h1>Publication not found</h1>
      <p>${deleted ? html`<code>${key}</code> is marked for deletion. Restore it from <a href="#/changes">Pending changes</a> to edit it again.` : html`No publication has the key <code>${key}</code>. It may have been deleted or renamed.`}</p>
      <p><a class="adm-btn" href="#/publications">Back to publications</a></p></div>`.toString();
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
  let yearTouched = !isNew;
  let dateTouched = !isNew;
  let rawMode = false;
  let showErrors = false;
  let moreOpen = false;
  let summarySig = '';
  const addedFields = new Set();

  const allPubs = store.publications();
  // Keys of pending deletions stay reserved until the deletion is published.
  const existingKeys = new Set([...store.entries().map((e) => e.key), ...store.changes().filter((c) => c.op === 'delete').map((c) => c.key)]);
  const knownAuthors = knownAuthorSet(allPubs);
  const knownTitles = titleIndex(store.entries());
  const { tags: knownTags, tagCounts } = facets(allPubs);
  const projectTags = new Set(ctx.config.projects.flatMap((p) => p.filter.tags || []));
  if (isNew) entry.key = suggestKey(entry.fields, existingKeys);

  const markDirty = () => { ctx.guard = true; };

  function currentTags() {
    return String(entry.fields.keywords || '').split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  }

  function setTags(list) {
    const seen = new Set();
    entry.fields.keywords = list.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).join(', ');
  }

  /** aria-describedby value: optional help text plus the field's message slot. */
  const describedBy = (id, help) => raw(`aria-describedby="${help ? `${id}-help ` : ''}${id}-msg"`);

  function fieldInput(name, { required = false, wide = false } = {}) {
    const value = entry.fields[name] ?? '';
    const id = `f-${name}`;
    const help = FIELD_HELP[name];
    const control = TEXTAREA_FIELDS.has(name)
      ? html`<textarea id="${id}" data-field="${name}" rows="2" data-autosize ${describedBy(id, help)}>${value}</textarea>`
      : html`<input id="${id}" data-field="${name}" type="text" value="${value}" ${describedBy(id, help)} autocomplete="off">`;
    return html`<div class="adm-field ${wide ? 'adm-field-wide' : ''}" data-for="${name}">
      <label class="adm-label" for="${id}">${FIELD_LABELS[name] || name}${required ? html` <span class="adm-req" aria-hidden="true">*</span>` : ''}</label>
      ${control}
      ${help ? html`<span class="adm-help" id="${id}-help">${help}</span>` : ''}
      <span class="adm-field-msg" id="${id}-msg"></span>
    </div>`;
  }

  function otherFields() {
    const venue = new Set(venueFields(entry.type));
    const names = new Set(EXTRA_FIELDS);
    for (const [k, v] of Object.entries(entry.fields)) {
      if (String(v).trim() && !venue.has(k) && !CORE_FIELDS.has(k)) names.add(k);
    }
    for (const k of addedFields) names.add(k);
    return [...names];
  }

  function formHtml() {
    const req = requiredFields(entry.type);
    const authors = splitNames(entry.fields.author).join('\n');
    const tags = currentTags();
    const tagChoices = [...new Set([...knownTags, ...tags])];
    const status = isNew ? 'new' : store.statusOf(key);
    const extra = otherFields();
    const open = moreOpen || extra.some((f) => String(entry.fields[f] || '').trim());
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
              <p class="adm-muted adm-small" id="raw-bib-help">Edit the entry directly. Use <code>keywords</code> for tags and one link per line in <code>url</code>. Changing <code>@type</code> changes the publication type.</p>
              <textarea class="adm-code" id="raw-bib" rows="22" spellcheck="false" aria-label="BibTeX source" aria-describedby="raw-bib-help">${serializeEntry({ ...entry, fields: { ...entry.fields, tppubtype: entry.type } })}</textarea>
              <div class="adm-actions"><button type="button" class="adm-btn adm-btn-primary" data-act="apply-raw">Apply to form</button></div>
            </section>` : html`
          <section class="adm-card">
            <h2>Publication</h2>
            <div class="adm-row">
              <div class="adm-field" data-for="type">
                <label class="adm-label" for="f-type">Type <span class="adm-req" aria-hidden="true">*</span></label>
                <select id="f-type" data-entry="type" aria-describedby="f-type-msg">${Object.entries(TYPES).map(([t, [label]]) => html`<option value="${t}" ${t === entry.type ? raw('selected') : ''}>${label} (${t})</option>`)}</select>
                <span class="adm-field-msg" id="f-type-msg"></span>
              </div>
              <div class="adm-field" data-for="pubstate">
                <label class="adm-label" for="f-pubstate">Status</label>
                <select id="f-pubstate" data-field="pubstate" aria-describedby="f-pubstate-help">${Object.entries(PUBSTATES).map(([v, label]) => html`<option value="${v}" ${v === (entry.fields.pubstate || 'published').split(',')[0].trim().toLowerCase().replace(/\s+/g, '') ? raw('selected') : ''}>${label}</option>`)}</select>
                <span class="adm-help" id="f-pubstate-help">Anything but Published shows a label next to the title.</span>
              </div>
            </div>
            <div class="adm-field adm-field-wide" data-for="title">
              <label class="adm-label" for="f-title">Title <span class="adm-req" aria-hidden="true">*</span></label>
              <textarea id="f-title" data-field="title" rows="2" data-autosize required aria-describedby="f-title-help f-title-msg">${entry.fields.title || ''}</textarea>
              <span class="adm-help" id="f-title-help">LaTeX is fine, e.g. <code>{\\'e}</code> for é. Wrap words in braces to keep their capitals: <code>{PRM}</code>.</span>
              <span class="adm-field-msg" id="f-title-msg"></span>
            </div>
            <div class="adm-field adm-field-wide" data-for="author">
              <label class="adm-label" for="f-author">Authors${req.has('author') ? html` <span class="adm-req" aria-hidden="true">*</span>` : ''}</label>
              <textarea id="f-author" data-authors rows="3" data-autosize aria-describedby="f-author-help f-author-msg" spellcheck="false">${authors}</textarea>
              <span class="adm-help" id="f-author-help">One author per line, in order, written as on other papers (e.g. <code>K Bekris</code>).</span>
              <span class="adm-field-msg" id="f-author-msg"></span>
              <ul class="adm-fixes" id="f-author-fixes" aria-live="polite"></ul>
            </div>
            <div class="adm-row">
              <div class="adm-field" data-for="year">
                <label class="adm-label" for="f-year">Year <span class="adm-req" aria-hidden="true">*</span></label>
                <input id="f-year" data-field="year" type="text" inputmode="numeric" maxlength="4" value="${entry.fields.year || ''}" aria-describedby="f-year-msg">
                <span class="adm-field-msg" id="f-year-msg"></span>
              </div>
              <div class="adm-field" data-for="date">
                <label class="adm-label" for="f-date">Date</label>
                <input id="f-date" data-field="date" type="date" value="${entry.fields.date || ''}" aria-describedby="f-date-help f-date-msg">
                <span class="adm-help" id="f-date-help">Orders papers within a year (newest first).</span>
                <span class="adm-field-msg" id="f-date-msg"></span>
              </div>
            </div>
          </section>

          <section class="adm-card">
            <h2>Venue</h2>
            <div class="adm-grid-fields">
              ${venueFields(entry.type).map((f) => (f === 'editor'
                ? html`<div class="adm-field adm-field-wide" data-for="editor"><label class="adm-label" for="f-editor">Editors</label><textarea id="f-editor" data-names="editor" rows="2" data-autosize spellcheck="false" aria-describedby="f-editor-help f-editor-msg">${splitNames(entry.fields.editor).join('\n')}</textarea><span class="adm-help" id="f-editor-help">One per line.</span><span class="adm-field-msg" id="f-editor-msg"></span></div>`
                : fieldInput(f, { required: req.has(f), wide: ['booktitle', 'journal', 'school', 'institution', 'howpublished', 'issuetitle'].includes(f) })))}
            </div>
          </section>

          <section class="adm-card">
            <h2 id="tags-heading">Tags</h2>
            <p class="adm-muted adm-small" id="tags-help">Tags decide which project pages list this paper (◆ marks project tags).</p>
            <div class="adm-tag-picker" role="group" aria-labelledby="tags-heading" aria-describedby="tags-help">
              ${tagChoices.map((t) => html`<label class="adm-chip ${projectTags.has(t) ? 'adm-chip-project' : ''}"><input type="checkbox" data-tag="${t}" ${tags.includes(t) ? raw('checked') : ''}><span>${t}</span>${tagCounts.get(t) ? html`<span class="adm-chip-count">${tagCounts.get(t)}</span>` : ''}</label>`)}
            </div>
            <div class="adm-inline-add">
              <label class="screen-reader-text" for="new-tag">New tag</label>
              <input id="new-tag" type="text" placeholder="New tag…" autocomplete="off">
              <button type="button" class="adm-btn" data-act="add-tag">Add tag</button>
            </div>
            <span class="adm-field-msg" data-msg-for="keywords" id="tags-msg"></span>
          </section>

          <section class="adm-card">
            <h2>Links</h2>
            <div class="adm-field adm-field-wide" data-for="url">
              <label class="adm-label" for="f-url">Links</label>
              <textarea id="f-url" data-field="url" rows="3" data-autosize spellcheck="false" aria-describedby="f-url-help f-url-msg">${entry.fields.url || ''}</textarea>
              <span class="adm-help" id="f-url-help">One per line: arXiv, PDF, project page, video… Optionally add a label after a comma: <code>https://…, Project page</code>.</span>
              <span class="adm-field-msg" id="f-url-msg"></span>
            </div>
            ${fieldInput('doi', { wide: true })}
          </section>

          <section class="adm-card">
            <h2><label for="f-abstract">Abstract</label></h2>
            <div class="adm-field adm-field-wide" data-for="abstract">
              <textarea id="f-abstract" data-field="abstract" rows="8" aria-describedby="f-abstract-msg">${entry.fields.abstract || ''}</textarea>
              <span class="adm-field-msg" id="f-abstract-msg"></span>
            </div>
          </section>

          <details class="adm-card adm-details" ${open ? raw('open') : ''}>
            <summary><h2>More fields</h2></summary>
            <div class="adm-grid-fields">
              ${extra.map((f) => fieldInput(f, { wide: ['note', 'annote', 'crossref', 'image'].includes(f) }))}
            </div>
            <div class="adm-inline-add">
              <label class="screen-reader-text" for="new-field">Field name</label>
              <input id="new-field" type="text" placeholder="Other BibTeX field, e.g. month" autocomplete="off" spellcheck="false">
              <button type="button" class="adm-btn" data-act="add-field">Add field</button>
            </div>
          </details>

          <section class="adm-card">
            <h2>Citation key</h2>
            <div class="adm-field adm-field-wide" data-for="key">
              <label class="adm-label" for="f-key">Key <span class="adm-req" aria-hidden="true">*</span></label>
              <div class="adm-input-group">
                <input id="f-key" data-entry="key" type="text" value="${entry.key}" spellcheck="false" autocapitalize="none" aria-describedby="f-key-help f-key-msg">
                <button type="button" class="adm-btn" data-act="suggest-key">Suggest</button>
              </div>
              <span class="adm-help" id="f-key-help">Unique ID used in BibTeX, e.g. <code>bekris2024state</code>.${!isNew ? ' Changing it renames the entry.' : ''}</span>
              <span class="adm-field-msg" id="f-key-msg"></span>
            </div>
          </section>`}

          <div class="adm-savebar">
            <div class="adm-savebar-inner">
              ${!isNew ? html`<button type="button" class="adm-btn adm-btn-danger-ghost" data-act="delete"><i class="fa fa-trash-can" aria-hidden="true"></i> Delete</button>` : ''}
              ${!isNew && store.statusOf(key) === 'edited' ? html`<button type="button" class="adm-btn adm-btn-ghost" data-act="revert">Revert to live version</button>` : ''}
              <span class="adm-savebar-spacer"></span>
              <a class="adm-btn" href="#/publications">Cancel</a>
              ${isNew ? html`<button type="submit" class="adm-btn" data-act="save-another">Save &amp; add another</button>` : ''}
              <button type="submit" class="adm-btn adm-btn-primary" data-act="save" title="Save (Ctrl+S / ⌘S)">Save</button>
            </div>
          </div>
        </form>

        <aside class="adm-editor-side" aria-label="Preview and checks">
          <section class="adm-card adm-preview">
            <h2>Preview</h2>
            <div class="adm-preview-box tp-preview" id="adm-preview"></div>
          </section>
          <section class="adm-card adm-side-appears">
            <h2>Appears on</h2>
            <ul class="adm-appears" id="adm-appears"></ul>
          </section>
          <section class="adm-card adm-side-checks" id="adm-checks-card">
            <h2>Checks</h2>
            <ul class="adm-checks" id="adm-checks"></ul>
          </section>
        </aside>
      </div>`;
  }

  function autosize(t) {
    if (!t || !t.hasAttribute('data-autosize') || !t.offsetParent) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;
  }

  function draw() {
    main.innerHTML = formHtml().toString();
    bindToggles($('#adm-preview', main));
    $$('textarea[data-autosize]', main).forEach(autosize);
    summarySig = '';
    update();
  }

  const fieldLabel = (f) => (f === 'keywords' ? 'Tags' : FIELD_LABELS[f] || (f === 'key' ? 'Key' : f === 'type' ? 'Type' : f));

  function renderSummary(result, focus) {
    const summary = $('.adm-error-summary', main);
    if (!summary) return;
    const sig = result.errors.map((e) => e.message).join('|');
    if (!result.errors.length) {
      summary.hidden = true;
      summary.innerHTML = '';
      summarySig = '';
      return;
    }
    if (sig !== summarySig || summary.hidden) {
      summary.innerHTML = html`<strong>Please fix ${result.errors.length === 1 ? 'this' : 'these'} before saving:</strong><ul>${result.errors.map((er) => html`<li><a href="#f-${er.field}" data-focus="${er.field}">${er.message}</a></li>`)}</ul>`.toString();
      summary.hidden = false;
      summarySig = sig;
    }
    if (focus) {
      summary.scrollIntoView({ block: 'center' });
      summary.focus({ preventScroll: true });
    }
  }

  function update() {
    const pub = toPublication(entry);
    $('#adm-preview', main).innerHTML = renderPublication(pub, { showTags: true, tagHref: (t) => `${siteBase()}papers/?tag=${encodeURIComponent(t)}`, idPrefix: 'pv' });
    $('#adm-appears', main).innerHTML = appearsOn(entry, ctx.config)
      .map((p) => html`<li><a href="${siteBase()}${p.href}" target="_blank" rel="noopener">${p.label}</a></li>`).join('');
    const result = validateEntry(entry, { existingKeys, originalKey: isNew ? null : key, knownAuthors, knownTitles });
    $('#adm-checks', main).innerHTML = [...result.errors.map((e) => ({ ...e, level: 'error' })), ...result.warnings.map((w) => ({ ...w, level: 'warn' }))]
      .map((m) => html`<li class="adm-check-${m.level}"><i class="fa ${m.level === 'error' ? 'fa-circle-xmark' : 'fa-triangle-exclamation'}" aria-hidden="true"></i> <span><span class="screen-reader-text">${m.level === 'error' ? 'Error' : 'Warning'}: </span><strong>${fieldLabel(m.field)}:</strong> ${m.message}</span></li>`).join('')
      || '<li class="adm-check-ok"><i class="fa fa-circle-check" aria-hidden="true"></i> Looks good.</li>';
    if (rawMode) return result;

    // Inline messages: errors after a save attempt, warnings about typed content always.
    for (const el of $$('.adm-field-msg', main)) {
      el.textContent = '';
      el.className = 'adm-field-msg';
    }
    for (const el of $$('[aria-invalid]', main)) el.removeAttribute('aria-invalid');
    const place = (m, level) => {
      const holder = main.querySelector(`.adm-field[data-for="${m.field}"] .adm-field-msg, [data-msg-for="${m.field}"]`);
      if (!holder || holder.textContent) return;
      holder.textContent = m.message;
      holder.className = `adm-field-msg adm-msg-${level}`;
      if (level === 'error') main.querySelector(`.adm-field[data-for="${m.field}"] :is(input, textarea, select)`)?.setAttribute('aria-invalid', 'true');
    };
    if (showErrors) result.errors.forEach((m) => place(m, 'error'));
    result.warnings.filter((w) => w.field !== 'author' && (showErrors || CONTENT_WARNINGS.has(w.field))).forEach((m) => place(m, 'warn'));

    // Author spelling: one line per author, with a one-click fix when the usual spelling is known.
    const fixes = result.warnings.filter((w) => w.field === 'author' && w.fix);
    $('#f-author-fixes', main).innerHTML = fixes.map(({ fix, message }) => html`<li class="adm-msg-warn">
      <i class="fa fa-triangle-exclamation" aria-hidden="true"></i>
      <span>${fix.suggestion ? html`“${fix.raw}” is written “${fix.suggestion}” on other papers.` : message}</span>
      ${fix.suggestion ? html`<button type="button" class="adm-btn adm-btn-sm" data-act="fix-author" data-index="${fix.index}" data-name="${fix.suggestion}">Use “${fix.suggestion}”</button>` : ''}
    </li>`).join('');

    const summary = $('.adm-error-summary', main);
    if (showErrors && summary && !summary.hidden) renderSummary(result, false);
    return result;
  }

  const lazyUpdate = debounce(() => { if (main.isConnected) update(); }, 120);

  function maybeSuggestKey() {
    if (!isNew || keyTouched) return;
    entry.key = suggestKey(entry.fields, existingKeys);
    const k = $('#f-key', main);
    if (k) k.value = entry.key;
  }

  main.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'raw-bib') { markDirty(); return; }
    if (t.id === 'new-tag' || t.id === 'new-field') return;
    if (t.dataset.field) entry.fields[t.dataset.field] = t.value;
    else if (t.dataset.authors !== undefined) entry.fields.author = t.value.split('\n').map((s) => s.trim()).filter(Boolean).join(' and ');
    else if (t.dataset.names) entry.fields[t.dataset.names] = t.value.split('\n').map((s) => s.trim()).filter(Boolean).join(' and ');
    else if (t.dataset.entry === 'key') { entry.key = t.value.trim(); keyTouched = true; }
    else return;
    if (t.tagName === 'TEXTAREA') autosize(t);
    if (t.dataset.field === 'date') {
      dateTouched = true;
      // A new paper's year follows its date until the year is typed by hand.
      if (/^\d{4}-\d{2}-\d{2}$/.test(t.value) && (!yearTouched || !entry.fields.year)) {
        entry.fields.year = t.value.slice(0, 4);
        const y = $('#f-year', main);
        if (y) y.value = entry.fields.year;
      }
    }
    if (t.dataset.field === 'year') {
      yearTouched = true;
      // Drop the default (today's) date when the paper is from another year;
      // otherwise it would be sorted among this year's papers.
      if (!dateTouched && entry.fields.date && /^\d{4}$/.test(t.value) && !entry.fields.date.startsWith(t.value)) {
        entry.fields.date = '';
        const d = $('#f-date', main);
        if (d) d.value = '';
      }
    }
    if (['author', 'title', 'year', 'date'].includes(t.dataset.field) || t.dataset.authors !== undefined) maybeSuggestKey();
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

  // <details> toggles do not bubble; listen in the capture phase.
  main.addEventListener('toggle', (e) => {
    if (!e.target.matches?.('details.adm-details')) return;
    moreOpen = e.target.open;
    if (moreOpen) $$('textarea[data-autosize]', e.target).forEach(autosize);
  }, true);

  main.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (e.target.id === 'new-tag' || e.target.id === 'new-field') {
      e.preventDefault();
      main.querySelector(`[data-act="${e.target.id === 'new-tag' ? 'add-tag' : 'add-field'}"]`).click();
    } else if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
      // Enter in a one-line field should not save (or "save & add another") by surprise.
      e.preventDefault();
    }
  });

  // Ctrl/Cmd+S saves from anywhere on the page while the editor is open.
  const onShortcut = (e) => {
    if (!main.isConnected) { document.removeEventListener('keydown', onShortcut); return; }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!dialogIsOpen()) save(false);
    }
  };
  document.addEventListener('keydown', onShortcut);

  main.addEventListener('submit', (e) => {
    e.preventDefault();
    save(e.submitter?.dataset.act === 'save-another');
  });

  function focusField(f) {
    const el = main.querySelector(`.adm-field[data-for="${f}"] :is(input, textarea, select)`);
    if (!el) return;
    const details = el.closest('details');
    if (details && !details.open) details.open = true;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }

  main.addEventListener('click', async (e) => {
    const link = e.target.closest('[data-focus]');
    if (link) {
      e.preventDefault();
      focusField(link.dataset.focus);
      return;
    }
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    if (!act || act === 'save' || act === 'save-another') return;
    if (act === 'raw') {
      if (rawMode) {
        if (!applyRaw()) return;
        rawMode = false;
        draw();
        $('[data-act="raw"]', main)?.focus();
      } else {
        rawMode = true;
        draw();
        $('#raw-bib', main)?.focus();
      }
    } else if (act === 'apply-raw') {
      if (applyRaw()) {
        rawMode = false;
        draw();
        $('[data-act="raw"]', main)?.focus();
        toast('BibTeX applied to the form.', 'success');
      }
    } else if (act === 'add-tag') {
      const input = $('#new-tag', main);
      const typed = input.value.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
      if (!typed.length) { input.focus(); return; }
      // Reuse the existing spelling of a tag ("planning" → "Planning").
      const canonical = typed.map((t) => knownTags.find((k) => k.toLowerCase() === t.toLowerCase()) || t);
      setTags([...currentTags(), ...canonical]);
      markDirty();
      draw();
      $('#new-tag', main)?.focus();
    } else if (act === 'add-field') {
      const input = $('#new-field', main);
      const name = input.value.trim().toLowerCase();
      if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
        toast('Field names start with a letter and use only letters, numbers, - and _.', 'error');
        input.focus();
        return;
      }
      const onForm = main.querySelector(`.adm-field[data-for="${name}"]`) || ['keywords', 'tppubtype'].includes(name);
      if (onForm) {
        input.value = '';
        if (name === 'keywords') $('#new-tag', main)?.focus();
        else focusField(name);
        toast(`${FIELD_LABELS[name] || name} is already on the form.`, 'info');
        return;
      }
      addedFields.add(name);
      moreOpen = true;
      draw();
      $(`#f-${CSS.escape(name)}`, main)?.focus();
    } else if (act === 'fix-author') {
      const names = splitNames(entry.fields.author);
      names[Number(btn.dataset.index)] = btn.dataset.name;
      entry.fields.author = names.join(' and ');
      const ta = $('#f-author', main);
      ta.value = names.join('\n');
      autosize(ta);
      markDirty();
      maybeSuggestKey();
      update();
      ($('[data-act="fix-author"]', main) || ta).focus();
    } else if (act === 'suggest-key') {
      entry.key = suggestKey(entry.fields, new Set([...existingKeys].filter((k) => k !== key)));
      $('#f-key', main).value = entry.key;
      keyTouched = true;
      markDirty();
      update();
    } else if (act === 'delete') {
      const isLive = store.statusOf(key) !== 'new';
      const ok = await confirmDialog({
        title: 'Delete this publication?',
        body: isLive
          ? 'It will disappear from the site when you next publish. You can restore it from Pending changes until then.'
          : 'It has not been published yet, so it will be removed completely. This cannot be undone.',
        confirm: 'Delete',
        danger: true,
      });
      if (!ok || !attempt(() => store.remove(key, { user: ctx.user.username }), 'Could not delete')) return;
      ctx.guard = null;
      toast(isLive ? 'Publication deleted. Restore it from Pending changes before publishing if needed.' : 'Publication removed.', 'success');
      ctx.navigate('/publications');
    } else if (act === 'revert') {
      const ok = await confirmDialog({ title: 'Revert to the live version?', body: 'Your unpublished edits to this paper will be lost.', confirm: 'Revert', danger: true });
      if (!ok || !attempt(() => store.revert(key), 'Could not revert')) return;
      ctx.guard = null;
      entry = structuredClone(store.get(key));
      showErrors = false;
      draw();
      $('h1', main)?.focus();
      toast('Reverted to the live version.', 'success');
    }
  });

  function applyRaw() {
    const text = $('#raw-bib', main)?.value ?? '';
    const { entries, errors } = parseBibtexWithErrors(text);
    if (errors.length || entries.length !== 1) {
      toast(errors.length ? `This BibTeX has an error: ${errors[0].message}` : entries.length ? 'Keep exactly one entry here (one @type{key, …}).' : 'Paste exactly one BibTeX entry, starting with @type{key,', 'error');
      $('#raw-bib', main)?.focus();
      return false;
    }
    const parsed = entries[0];
    // Whichever of @type and tppubtype was edited wins.
    const tp = String(parsed.fields.tppubtype || '').toLowerCase();
    let type;
    if (TYPES[parsed.type] && parsed.type !== entry.type) type = parsed.type;
    else if (TYPES[tp]) type = tp;
    else if (TYPES[parsed.type]) type = parsed.type;
    else type = 'misc';
    entry = { type, key: parsed.key, fields: { ...parsed.fields, tppubtype: type } };
    keyTouched = true;
    yearTouched = true;
    dateTouched = true;
    markDirty();
    return true;
  }

  function save(addAnother) {
    if (rawMode) {
      if (!applyRaw()) return;
      rawMode = false;
      draw();
    }
    for (const [k, v] of Object.entries(entry.fields)) if (!String(v).trim()) delete entry.fields[k];
    entry.fields.tppubtype = entry.type;
    if (!entry.fields.pubstate) entry.fields.pubstate = 'published';
    showErrors = true;
    const result = update();
    if (result.errors.length) {
      renderSummary(result, true);
      return;
    }
    renderSummary(result, false);
    let saved;
    try {
      saved = store.upsert(entry, { previousKey: isNew ? null : key, user: ctx.user.username });
    } catch (err) {
      toast(`Could not save: ${err.message}`, 'error');
      return;
    }
    ctx.guard = null;
    const live = store.statusOf(saved.key) === 'published';
    const renamed = !isNew && saved.key !== key;
    toast(live ? 'Saved. It matches the live version, so there is nothing to publish.'
      : `Saved “${(saved.fields.title || saved.key).slice(0, 60)}”${renamed ? ` (key renamed to ${saved.key})` : ''}. It is in your pending changes.`, 'success', 6000);
    if (addAnother) ctx.navigate(`/publications/new?t=${Date.now()}`);
    else ctx.navigate(`/publications?q=${encodeURIComponent(saved.key)}`);
  }

  draw();
}
