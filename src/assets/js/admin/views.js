/** Admin views: dashboard, publication list, pending changes, export, account, help. */
import { TYPES, facets, filterPublications, toPublication, sortPublications, escapeHtml } from '../lib/publications.js';
import { serializeEntry } from '../lib/bibtex.js';
import { siteBase } from '../store.js';
import { html, raw, $, toast, confirmDialog, download, copyText, relativeTime, plural, statusBadge, debounce, attempt } from './ui.js';
import { dataIssues, FIELD_LABELS } from './model.js';
import { changePassword, hasLocalPasswordOverride, loadUsers } from './auth.js';

const PAGE_SIZE = 25;

function editHref(key) {
  return `#/publications/edit/${encodeURIComponent(key)}`;
}

function githubLinks(config) {
  const repo = `https://github.com/${config.repo}`;
  return {
    repo,
    upload: `${repo}/upload/${config.branch}/data`,
    edit: `${repo}/edit/${config.branch}/data/publications.bib`,
    actions: `${repo}/actions`,
    usersFile: `${repo}/edit/${config.branch}/src/admin/users.json`,
  };
}

/**
 * Pending changes as the user thinks of them: a rename of a published paper
 * is one "renamed" item (old key → new key) instead of a deletion plus a
 * new entry.
 */
export function pendingItems(store) {
  const changes = store.changes();
  const byKey = new Map(changes.map((c) => [c.key, c]));
  const items = [];
  for (const c of changes) {
    if (c.status === 'deleted' && c.renamedTo && byKey.get(c.renamedTo)?.renamedFrom === c.key) continue;
    const from = c.renamedFrom && byKey.get(c.renamedFrom);
    if (c.after && from?.status === 'deleted' && from.renamedTo === c.key) {
      items.push({ ...c, status: 'renamed', before: from.before });
    } else {
      items.push(c);
    }
  }
  return items;
}

const groupOf = (status) => (status === 'renamed' ? 'edited' : status);

function countText(items) {
  const n = { new: 0, edited: 0, deleted: 0 };
  for (const c of items) n[groupOf(c.status)]++;
  const parts = [];
  if (n.new) parts.push(`${n.new} new`);
  if (n.edited) parts.push(`${n.edited} edited`);
  if (n.deleted) parts.push(`${n.deleted} deleted`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || '';
}

// ------------------------------------------------------------------ dashboard

export function renderDashboard(main, ctx) {
  const { store, user, config } = ctx;
  const changes = pendingItems(store);
  const issues = dataIssues(store.entries());
  const gh = githubLinks(config);
  const firstName = user.name.split(' ')[0];

  main.innerHTML = html`
    <div class="adm-page-head">
      <div>
        <h1>Welcome, ${firstName}</h1>
        <p class="adm-sub">Manage the publications shown on the Papers page, project pages and member pages.</p>
      </div>
      <div class="adm-head-actions">
        <a class="adm-btn adm-btn-primary" href="#/publications/new"><i class="fa fa-plus" aria-hidden="true"></i> Add publication</a>
      </div>
    </div>

    <div class="adm-grid-2">
      <section class="adm-card">
        <h2>How publishing works</h2>
        <ol class="adm-steps">
          <li><strong>Edit</strong> — add, edit or import papers here. Changes are saved in this browser, and the public pages show them to you as a preview.</li>
          <li><strong>Export</strong> — download the updated <code>publications.bib</code> from <a href="#/export">Export &amp; publish</a>.</li>
          <li><strong>Publish</strong> — upload that file to the <a href="${gh.upload}" target="_blank" rel="noopener">data/ folder on GitHub</a>. The site rebuilds in about two minutes, and pending changes clear themselves.</li>
        </ol>
        ${changes.length
          ? html`<p class="adm-callout"><i class="fa fa-circle-exclamation" aria-hidden="true"></i> <span>${plural(changes.length, 'change')} not published yet. <a href="#/export">Export &amp; publish</a></span></p>`
          : html`<p class="adm-callout adm-callout-ok"><i class="fa fa-circle-check" aria-hidden="true"></i> Everything here matches the live site.</p>`}
      </section>

      <section class="adm-card">
        <h2>Recent changes</h2>
        ${changes.length ? html`<ul class="adm-mini-list">${changes.slice(0, 6).map((c) => html`
          <li>${statusBadge(c.status)} <a href="${c.status === 'deleted' ? '#/changes' : editHref(c.key)}">${(c.after || c.before)?.fields.title || c.key}</a><span class="adm-muted"> · ${relativeTime(c.at)}</span></li>`)}</ul>
          <p><a href="#/changes">Review all pending changes &rarr;</a></p>`
          : html`<p class="adm-muted">No pending changes. <a href="#/publications/new">Add a publication</a> or <a href="#/import">import BibTeX</a>.</p>`}
      </section>
    </div>

    <section class="adm-card" id="issues">
      <h2>Data checks <span class="adm-muted">(${issues.length})</span></h2>
      ${issues.length ? html`
        <p class="adm-muted">Things that may display oddly on the site. Fix them by editing the publication.</p>
        <ul class="adm-issues">${issues.slice(0, 40).map((i) => html`<li><a href="${editHref(i.key)}">${i.label}</a> <span class="adm-muted">— ${i.message}</span></li>`)}</ul>
        ${issues.length > 40 ? html`<p class="adm-muted">…and ${issues.length - 40} more.</p>` : ''}`
        : html`<p class="adm-muted">No problems found.</p>`}
    </section>`.toString();
}

// ----------------------------------------------------------------------- list

export function renderList(main, ctx, params) {
  const { store } = ctx;
  const state = {
    q: params.get('q') || '',
    type: params.get('type') || '',
    year: params.get('year') || '',
    tag: params.get('tag') || '',
    status: params.get('status') || '',
    sort: params.get('sort') || 'date',
    page: Math.max(1, parseInt(params.get('page') || '1', 10) || 1),
  };

  /** Live publications plus deleted ones (so they can be restored), newest first. */
  const collect = () => {
    const items = pendingItems(store);
    const status = new Map(items.map((c) => [c.key, c.status]));
    const changedAt = new Map(items.map((c) => [c.key, c.at]));
    const deleted = items.filter((c) => c.status === 'deleted' && c.before).map((c) => c.before);
    const pubs = sortPublications([...store.entries(), ...deleted].map((e, i) => toPublication(e, i)));
    return { pubs, status, changedAt, live: pubs.length - deleted.length };
  };

  main.innerHTML = html`
    <div class="adm-page-head">
      <div><h1>Publications</h1><p class="adm-sub" id="adm-list-summary" tabindex="-1"></p></div>
      <div class="adm-head-actions">
        <a class="adm-btn" href="#/import"><i class="fa fa-file-import" aria-hidden="true"></i> Import BibTeX</a>
        <a class="adm-btn adm-btn-primary" href="#/publications/new"><i class="fa fa-plus" aria-hidden="true"></i> Add publication</a>
      </div>
    </div>
    <form class="adm-toolbar" role="search" aria-label="Filter publications">
      <label class="adm-search"><i class="fa fa-magnifying-glass" aria-hidden="true"></i><span class="screen-reader-text">Search publications</span>
        <input type="search" name="q" placeholder="Search title, author, venue, key…" value="${state.q}" autocomplete="off"></label>
      <label><span class="screen-reader-text">Type</span><select name="type"></select></label>
      <label><span class="screen-reader-text">Year</span><select name="year"></select></label>
      <label><span class="screen-reader-text">Tag</span><select name="tag"></select></label>
      <label><span class="screen-reader-text">Status</span><select name="status">
        <option value="">Any status</option><option value="changed">Changed (not published)</option><option value="new">New</option><option value="edited">Edited or renamed</option><option value="deleted">Deleted</option>
      </select></label>
      <label><span class="screen-reader-text">Sort</span><select name="sort">
        <option value="date">Newest first</option><option value="date-asc">Oldest first</option><option value="title">Title A–Z</option><option value="changed">Recently changed</option>
      </select></label>
    </form>
    <div id="adm-list"></div>`.toString();

  const form = $('.adm-toolbar', main);
  form.elements.status.value = state.status;
  form.elements.sort.value = state.sort;
  form.addEventListener('submit', (e) => e.preventDefault());

  const fillSelects = (pubs) => {
    const f = facets(pubs);
    const fill = (name, values, label, fmt = (v) => v) => {
      form.elements[name].innerHTML = `<option value="">${label}</option>${values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(fmt(v))}</option>`).join('')}`;
      form.elements[name].value = state[name];
    };
    fill('type', f.types, 'All types', (t) => TYPES[t][1]);
    fill('year', f.years.map(String), 'All years', (y) => (y === '0' ? 'Undated' : y));
    fill('tag', f.tags, 'All tags', (t) => `${t} (${f.tagCounts.get(t)})`);
  };

  const syncHash = () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v && !(k === 'page' && v === 1) && !(k === 'sort' && v === 'date')) p.set(k, v);
    const qs = p.toString();
    history.replaceState(history.state, '', `#/publications${qs ? `?${qs}` : ''}`);
  };

  const draw = () => {
    const { pubs, status, changedAt, live } = collect();
    fillSelects(pubs.filter((p) => status.get(p.key) !== 'deleted'));
    const statusOf = (p) => status.get(p.key) || 'published';
    let rows = filterPublications(pubs, { q: state.q, type: state.type, year: state.year, tag: state.tag });
    if (state.status === 'changed') rows = rows.filter((p) => statusOf(p) !== 'published');
    else if (state.status === 'edited') rows = rows.filter((p) => ['edited', 'renamed'].includes(statusOf(p)));
    else if (state.status) rows = rows.filter((p) => statusOf(p) === state.status);
    else rows = rows.filter((p) => statusOf(p) !== 'deleted');
    if (state.sort === 'title') rows.sort((a, b) => a.title.localeCompare(b.title));
    else if (state.sort === 'date-asc') rows.reverse();
    else if (state.sort === 'changed') rows.sort((a, b) => String(changedAt.get(b.key) || '').localeCompare(String(changedAt.get(a.key) || '')));

    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const slice = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    const filtered = state.q || state.type || state.year || state.tag || state.status;
    $('#adm-list-summary', main).innerHTML = filtered
      ? html`${rows.length} of ${plural(live, 'publication')} match. <button type="button" class="adm-link-btn" data-act="clear">Show all</button>`.toString()
      : html`${plural(rows.length, 'publication')}. Click a title to edit it.`.toString();

    $('#adm-list', main).innerHTML = rows.length ? html`
      <div class="adm-table-wrap">
      <table class="adm-table adm-pub-table">
        <thead><tr><th scope="col">Publication</th><th scope="col">Year</th><th scope="col">Type</th><th scope="col">Tags</th><th scope="col"><span class="screen-reader-text">Status and actions</span></th></tr></thead>
        <tbody>${slice.map((p) => {
          const st = statusOf(p);
          return html`<tr class="adm-row-${st}">
            <td class="adm-cell-main">
              ${st === 'deleted' ? html`<span class="adm-row-title">${p.title}</span>` : html`<a class="adm-row-title" href="${editHref(p.key)}">${p.title}</a>`}
              <div class="adm-row-authors">${p.authorText}</div>
              <div class="adm-row-venue">${p.text.booktitle || p.text.journal || p.text.school || p.text.institution || ''}</div>
            </td>
            <td class="adm-cell-year">${p.pubstate === 'forthcoming' ? 'Forthc.' : (p.year || '—')}</td>
            <td class="adm-cell-type">${TYPES[p.type]?.[0] || p.type}</td>
            <td class="adm-cell-tags">${p.tags.map((t) => html`<span class="adm-tag">${t}</span>`)}</td>
            <td class="adm-cell-actions">
              ${st !== 'published' ? statusBadge(st) : ''}
              ${st === 'deleted'
                ? html`<button type="button" class="adm-btn adm-btn-sm" data-act="restore" data-key="${p.key}" aria-label="Restore ${p.title}">Restore</button>`
                : html`<a class="adm-btn adm-btn-sm" href="${editHref(p.key)}" aria-label="Edit ${p.title}">Edit</a>
                  <button type="button" class="adm-btn adm-btn-sm adm-btn-icon" data-act="duplicate" data-key="${p.key}" title="Duplicate" aria-label="Duplicate ${p.title}"><i class="fa fa-copy" aria-hidden="true"></i></button>
                  <button type="button" class="adm-btn adm-btn-sm adm-btn-icon adm-btn-danger-ghost" data-act="delete" data-key="${p.key}" title="Delete" aria-label="Delete ${p.title}"><i class="fa fa-trash-can" aria-hidden="true"></i></button>`}
            </td></tr>`;
        })}</tbody>
      </table></div>
      ${pages > 1 ? html`<nav class="adm-pager" aria-label="Pages">
        <button type="button" class="adm-btn adm-btn-sm" data-page="${state.page - 1}" data-dir="prev" ${state.page <= 1 ? raw('disabled') : ''}>&larr; Previous</button>
        <span aria-live="polite">Page ${state.page} of ${pages}</span>
        <button type="button" class="adm-btn adm-btn-sm" data-page="${state.page + 1}" data-dir="next" ${state.page >= pages ? raw('disabled') : ''}>Next &rarr;</button>
      </nav>` : ''}`.toString()
      : html`<div class="adm-empty"><p>No publications match these filters.</p><button type="button" class="adm-btn" data-act="clear">Clear filters</button></div>`.toString();
  };

  const onSearch = debounce((value) => {
    state.q = value.trim();
    state.page = 1;
    syncHash();
    draw();
  }, 180);
  form.addEventListener('input', (e) => {
    if (e.target.name === 'q') onSearch(e.target.value);
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'q' || !(e.target.name in state)) return;
    state[e.target.name] = e.target.value;
    state.page = 1;
    syncHash();
    draw();
  });
  main.addEventListener('click', async (e) => {
    const pageBtn = e.target.closest('[data-page]');
    if (pageBtn) {
      const dir = pageBtn.dataset.dir;
      state.page = Number(pageBtn.dataset.page);
      syncHash();
      draw();
      main.scrollIntoView();
      // Keep keyboard focus on the pager instead of dropping it to the page.
      const same = $(`.adm-pager [data-dir="${dir}"]`, main);
      (same && !same.disabled ? same : $('.adm-pager button:not([disabled])', main))?.focus({ preventScroll: true });
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const key = btn.dataset.key;
    if (btn.dataset.act === 'clear') {
      Object.assign(state, { q: '', type: '', year: '', tag: '', status: '', page: 1 });
      form.elements.q.value = '';
      form.elements.status.value = '';
      syncHash();
      draw();
      form.elements.q.focus();
    } else if (btn.dataset.act === 'duplicate') {
      ctx.navigate(`/publications/new?from=${encodeURIComponent(key)}`);
    } else if (btn.dataset.act === 'delete') {
      const entry = store.get(key);
      const isLive = store.statusOf(key) !== 'new';
      const ok = await confirmDialog({
        title: 'Delete this publication?',
        body: isLive
          ? `“${entry?.fields.title || key}” will be removed from the site when you next publish. You can restore it until then.`
          : `“${entry?.fields.title || key}” has not been published yet, so it will be removed completely. This cannot be undone.`,
        confirm: 'Delete',
        danger: true,
      });
      if (!ok || !attempt(() => store.remove(key, { user: ctx.user.username }), 'Could not delete')) return;
      toast(isLive ? 'Publication deleted. Restore it any time before publishing (Status: Deleted).' : 'Publication removed.', 'success');
      draw();
      $('#adm-list-summary', main).focus();
    } else if (btn.dataset.act === 'restore') {
      if (!attempt(() => store.revert(key), 'Could not restore')) return;
      toast('Publication restored.', 'success');
      draw();
      $('#adm-list-summary', main).focus();
    }
  });
  draw();
}

// -------------------------------------------------------------------- changes

function fieldDiff(before, after) {
  const keys = [...new Set([...Object.keys(before?.fields || {}), ...Object.keys(after?.fields || {})])];
  const rows = [];
  if (before && after && before.type !== after.type) rows.push({ field: 'Type', from: TYPES[before.type]?.[0] || before.type, to: TYPES[after.type]?.[0] || after.type });
  if (before && after && before.key !== after.key) rows.push({ field: 'Citation key', from: before.key, to: after.key });
  for (const k of keys) {
    if (k === 'tppubtype' && before && after && before.type !== after.type) continue;
    const a = String(before?.fields[k] ?? '').trim();
    const b = String(after?.fields[k] ?? '').trim();
    if (a !== b) rows.push({ field: FIELD_LABELS[k] || k, from: a, to: b });
  }
  return rows;
}

/** A diff cell; long values (abstracts) start collapsed. */
function diffValue(v) {
  if (!v) return raw('<em>empty</em>');
  if (v.length <= 240) return v;
  return html`<details class="adm-diff-more"><summary>${v.slice(0, 160).trimEnd()}… <span class="adm-muted">(show all)</span></summary>${v}</details>`;
}

export function renderChanges(main, ctx) {
  const { store } = ctx;
  const draw = () => {
    const items = pendingItems(store);
    const groups = [
      ['new', 'New publications'],
      ['edited', 'Edited publications'],
      ['deleted', 'Deleted publications'],
    ];
    main.innerHTML = html`
      <div class="adm-page-head">
        <div><h1>Pending changes</h1>
        <p class="adm-sub" id="changes-summary" tabindex="-1">${items.length ? `${plural(items.length, 'change')} saved in this browser and not yet on the live site.` : 'Nothing waiting to be published.'}</p></div>
        <div class="adm-head-actions">
          ${items.length ? html`<button type="button" class="adm-btn adm-btn-danger-ghost" data-act="discard-all">Discard all</button>
          <a class="adm-btn adm-btn-primary" href="#/export"><i class="fa fa-cloud-arrow-up" aria-hidden="true"></i> Export &amp; publish</a>` : ''}
        </div>
      </div>
      ${items.length ? '' : html`<div class="adm-empty"><i class="fa fa-circle-check adm-empty-icon" aria-hidden="true"></i><p>Your browser has no unpublished edits.</p><p><a class="adm-btn" href="#/publications">Go to publications</a></p></div>`}
      ${groups.map(([group, title]) => {
        const list = items.filter((c) => groupOf(c.status) === group);
        if (!list.length) return '';
        return html`<section class="adm-card"><h2>${title} <span class="adm-muted">(${list.length})</span></h2>
          <ul class="adm-change-list">${list.map((c) => {
            const entry = c.after || c.before;
            const diff = group === 'edited' ? fieldDiff(c.before, c.after) : [];
            const label = c.status === 'new' ? 'Remove' : c.status === 'deleted' ? 'Restore' : c.status === 'renamed' ? 'Undo' : 'Revert';
            return html`<li class="adm-change">
              <div class="adm-change-head">
                <div>
                  ${statusBadge(c.status)}
                  ${c.status === 'deleted' ? html`<strong>${entry.fields.title || c.key}</strong>` : html`<a href="${editHref(c.key)}"><strong>${entry.fields.title || c.key}</strong></a>`}
                  <div class="adm-muted adm-small">${c.status === 'renamed' ? html`<code>${c.renamedFrom}</code> → <code>${c.key}</code>` : html`<code>${c.key}</code>`} · ${relativeTime(c.at)}${c.user ? ` by ${c.user}` : ''}</div>
                </div>
                <button type="button" class="adm-btn adm-btn-sm" data-act="revert" data-key="${c.key}" data-status="${c.status}" aria-label="${label}: ${entry.fields.title || c.key}">${label}</button>
              </div>
              ${diff.length ? html`<div class="adm-diff-wrap"><table class="adm-diff"><thead><tr><th scope="col">Field</th><th scope="col">Live site</th><th scope="col">Your version</th></tr></thead><tbody>${diff.map((d) => html`<tr><th scope="row">${d.field}</th><td class="adm-diff-old">${diffValue(d.from)}</td><td class="adm-diff-new">${diffValue(d.to)}</td></tr>`)}</tbody></table></div>` : ''}
              ${c.status === 'new' ? html`<details><summary>BibTeX</summary><pre class="adm-pre">${serializeEntry(c.after)}</pre></details>` : ''}
            </li>`;
          })}</ul></section>`;
      })}`.toString();
  };
  main.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'revert') {
      const { key, status } = btn.dataset;
      const title = (store.get(key) || {}).fields?.title || key;
      if (status !== 'deleted') {
        const texts = {
          new: ['Remove this new publication?', `“${title}” has not been published, so it will be gone for good.`, 'Remove'],
          edited: ['Revert to the live version?', `Your unpublished edits to “${title}” will be lost.`, 'Revert'],
          renamed: ['Undo the rename and edits?', `“${title}” goes back to its live version and key. Your edits to it will be lost.`, 'Undo'],
        }[status] || ['Undo this change?', '', 'Undo'];
        const ok = await confirmDialog({ title: texts[0], body: texts[1], confirm: texts[2], danger: true });
        if (!ok) return;
      }
      if (!attempt(() => store.revert(key), 'Could not undo the change')) return;
      toast(status === 'deleted' ? 'Publication restored.' : 'Change undone.', 'success');
      draw();
      $('#changes-summary', main).focus();
    } else if (btn.dataset.act === 'discard-all') {
      const ok = await confirmDialog({
        title: 'Discard all pending changes?',
        body: `This removes ${plural(store.changeCount, 'unpublished change')} from this browser. It cannot be undone. Export a backup first if you might need them.`,
        confirm: 'Discard all',
        danger: true,
      });
      if (!ok || !attempt(() => store.discardAll(), 'Could not discard the changes')) return;
      toast('All pending changes discarded.', 'success');
      draw();
      $('h1', main).focus();
    }
  });
  draw();
}

// --------------------------------------------------------------------- export

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => { setTimeout(resolve, ms); })]);

export function renderExport(main, ctx) {
  const { store, config } = ctx;
  const gh = githubLinks(config);
  const canTransfer = typeof store.exportOverlay === 'function';

  const summaryText = () => {
    const items = pendingItems(store);
    return items.length
      ? `${countText(items)} ${items.length === 1 ? 'publication' : 'publications'} will go live.`
      : 'There are no pending changes, but you can still download the current list.';
  };

  main.innerHTML = html`
    <div class="adm-page-head"><div><h1>Export &amp; publish</h1>
      <p class="adm-sub" id="exp-summary">${summaryText()}</p></div></div>
    <div id="exp-fresh" role="status"></div>

    <section class="adm-card adm-publish">
      <h2><span class="adm-step-num">1</span> Download the updated BibTeX file</h2>
      <p>This is the complete list (<span id="exp-total">${store.entries().length}</span> publications) including your changes, in the same format teachPress uses.</p>
      <div class="adm-actions">
        <button type="button" class="adm-btn adm-btn-primary" data-act="bib"><i class="fa fa-download" aria-hidden="true"></i> Download publications.bib</button>
        <button type="button" class="adm-btn" data-act="copy"><i class="fa fa-copy" aria-hidden="true"></i> Copy to clipboard</button>
      </div>
    </section>

    <section class="adm-card adm-publish">
      <h2><span class="adm-step-num">2</span> Upload it to GitHub</h2>
      <p>Open the <a href="${gh.upload}" target="_blank" rel="noopener">upload page for the <code>data/</code> folder</a>, drop in <code>publications.bib</code>, and press <strong>Commit changes</strong>. GitHub replaces the old file. You need write access to <a href="${gh.repo}" target="_blank" rel="noopener">${config.repo}</a>.</p>
      <p class="adm-callout"><i class="fa fa-triangle-exclamation" aria-hidden="true"></i> <span>The file must be named exactly <code>publications.bib</code>. If your browser saved it as <code>publications (1).bib</code> or similar, rename it before uploading — otherwise GitHub adds it as a separate file that the site ignores.</span></p>
      <div class="adm-actions adm-mt">
        <a class="adm-btn adm-btn-primary" href="${gh.upload}" target="_blank" rel="noopener"><i class="fab fa-github" aria-hidden="true"></i> Open GitHub upload page</a>
        <a class="adm-btn" href="${gh.edit}" target="_blank" rel="noopener">Or paste into the file editor</a>
      </div>
    </section>

    <section class="adm-card adm-publish">
      <h2><span class="adm-step-num">3</span> Wait for the site to rebuild</h2>
      <p>A <a href="${gh.actions}" target="_blank" rel="noopener">GitHub Action</a> checks the file and redeploys the site, usually within two minutes. If the file has a syntax error, the deploy stops and the live site stays as it was. When you come back here, published changes clear from your pending list automatically.</p>
    </section>

    <section class="adm-card">
      <h2>Other downloads</h2>
      <div class="adm-actions">
        <button type="button" class="adm-btn" data-act="changed">Only new &amp; edited entries (.bib)</button>
        <button type="button" class="adm-btn" data-act="json">${canTransfer ? 'Download pending changes (.json)' : 'Backup of everything (.json)'}</button>
      </div>
      <p class="adm-muted adm-small">${canTransfer
        ? 'The pending-changes file holds your unpublished additions, edits, renames and deletions. Load it on another computer with Import to continue there.'
        : 'The JSON backup can be loaded again from Import, for example to move your pending edits to another computer.'}</p>
    </section>`.toString();

  const refreshUi = () => {
    if (!main.isConnected) return;
    $('#exp-summary', main).textContent = summaryText();
    $('#exp-total', main).textContent = store.entries().length;
    $('[data-act="changed"]', main).disabled = !store.changes().some((c) => c.after);
  };
  refreshUi();

  /** Re-read the live list so the download includes anything published meanwhile. */
  let lastCheck = 0;
  const refresh = async () => {
    const box = $('#exp-fresh', main);
    try {
      await store.load({ fresh: true });
      lastCheck = Date.now();
      let pruned = 0;
      attempt(() => { pruned = store.prune(); }, 'Could not tidy up published changes');
      if (pruned) toast(`${plural(pruned, 'pending change')} ${pruned === 1 ? 'is' : 'are'} already live and ${pruned === 1 ? 'was' : 'were'} cleared.`, 'success', 7000);
      const started = store.overlay.startedAgainst;
      const now = store.publishedVersion;
      box.innerHTML = started && now && started !== now
        ? html`<p class="adm-alert"><i class="fa fa-circle-info" aria-hidden="true"></i> The live publication list was updated (${new Date(now).toLocaleString()}) after you started editing. Your download is built from that newest list plus your changes, so anything published in the meantime is kept.</p>`.toString()
        : '';
    } catch {
      box.innerHTML = html`<p class="adm-alert adm-alert-error"><i class="fa fa-wifi" aria-hidden="true"></i> Could not check the live site for newer changes (are you offline?). The download uses the list loaded earlier.</p>`.toString();
    }
    refreshUi();
  };
  refresh();
  const beforeDownload = () => (Date.now() - lastCheck > 15000 ? withTimeout(refresh(), 3500) : null);

  main.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    if (!act) return;
    if (act === 'bib' || act === 'copy' || act === 'changed') {
      btn.disabled = true;
      await beforeDownload();
      btn.disabled = false;
    }
    if (act === 'bib') {
      download('publications.bib', store.exportBibtex(), 'application/x-bibtex');
      toast('publications.bib downloaded. Next: upload it on GitHub (check the file name).', 'success', 7000);
    } else if (act === 'copy') {
      toast(await copyText(store.exportBibtex()) ? 'BibTeX copied to the clipboard.' : 'Could not copy. Use the download button instead.', 'info');
    } else if (act === 'changed') {
      download('publications-changes.bib', store.exportBibtex({ onlyChanged: true }), 'application/x-bibtex');
    } else if (act === 'json') {
      const day = new Date().toISOString().slice(0, 10);
      if (canTransfer) download(`pracsys-pending-changes-${day}.json`, store.exportOverlay(), 'application/json');
      else download(`pracsys-publications-${day}.json`, store.exportJson(), 'application/json');
    }
    refreshUi();
  });
}

// -------------------------------------------------------------------- account

export async function renderAccount(main, ctx) {
  const { user, config } = ctx;
  const gh = githubLinks(config);
  const users = await loadUsers().catch(() => []);
  main.innerHTML = html`
    <div class="adm-page-head"><div><h1>Account</h1><p class="adm-sub">Signed in as <strong>${user.name}</strong> (${user.username}) until ${new Date(user.expiresAt).toLocaleString()}.</p></div></div>
    <div class="adm-grid-2">
      <section class="adm-card">
        <h2>Change password</h2>
        <form class="adm-form" id="pw-form" novalidate>
          <div class="adm-alert adm-alert-error" role="alert" hidden></div>
          <label class="adm-field"><span class="adm-label">Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
          <label class="adm-field"><span class="adm-label">New password</span><input type="password" name="next" autocomplete="new-password" minlength="8" required aria-describedby="pw-next-help"><span class="adm-help" id="pw-next-help">At least 8 characters.</span></label>
          <label class="adm-field"><span class="adm-label">Repeat new password</span><input type="password" name="again" autocomplete="new-password" required></label>
          <button class="adm-btn adm-btn-primary" type="submit">Update password</button>
        </form>
        <div id="pw-result" hidden>
          <p class="adm-callout adm-callout-ok"><i class="fa fa-circle-check" aria-hidden="true"></i> <span>Password changed. Use the new password the next time you sign in on this browser.</span></p>
          <p>To use it on other computers too, replace your entry in <a href="${gh.usersFile}" target="_blank" rel="noopener"><code>src/admin/users.json</code></a> with:</p>
          <pre class="adm-pre" id="pw-json"></pre>
          <button type="button" class="adm-btn adm-btn-sm" id="pw-copy"><i class="fa fa-copy" aria-hidden="true"></i> Copy</button>
        </div>
        ${hasLocalPasswordOverride(user.username) ? html`<p class="adm-muted adm-small">This browser uses a locally changed password for your account.</p>` : ''}
      </section>
      <section class="adm-card">
        <h2>Editors</h2>
        <ul class="adm-mini-list">${users.map((u) => html`<li><i class="fa fa-user" aria-hidden="true"></i> ${u.name} <span class="adm-muted">(${u.username}, ${u.role})</span></li>`)}</ul>
        <p class="adm-muted adm-small">Add an editor with <code>node scripts/hash-password.mjs &lt;username&gt; "Full Name"</code> and commit <code>src/admin/users.json</code>.</p>
        <h2 class="adm-mt">This browser</h2>
        <p>${plural(ctx.store.changeCount, 'pending change')} stored locally.</p>
        <p class="adm-muted adm-small">Sign-in is checked in the browser because the site has no server. It keeps the editor out of casual view; it does not protect data, and nothing reaches the live site until the BibTeX file is committed on GitHub.</p>
      </section>
    </div>`.toString();

  const form = $('#pw-form', main);
  const alert = $('.adm-alert', form);
  const submit = $('button[type="submit"]', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    alert.hidden = true;
    const { current, next, again } = form.elements;
    const fail = (msg, field) => {
      alert.textContent = msg;
      alert.hidden = false;
      field?.focus();
    };
    if (!current.value) return fail('Enter your current password.', current);
    if (next.value.length < 8) return fail('Use at least 8 characters for the new password.', next);
    if (next.value !== again.value) return fail('The new passwords do not match.', again);
    submit.disabled = true;
    submit.textContent = 'Updating…';
    try {
      const record = await changePassword(current.value, next.value);
      form.reset();
      $('#pw-json', main).textContent = JSON.stringify(record, null, 2);
      $('#pw-result', main).hidden = false;
      toast('Password updated in this browser.', 'success');
    } catch (err) {
      fail(err.message, /current/i.test(err.message) ? current : next);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Update password';
    }
  });
  main.addEventListener('click', async (e) => {
    if (e.target.closest('#pw-copy')) toast(await copyText($('#pw-json', main).textContent) ? 'Copied.' : 'Copy failed.', 'info');
  });
}

// ----------------------------------------------------------------------- help

export function renderHelp(main, ctx) {
  const gh = githubLinks(ctx.config);
  const tags = ctx.config.projects.filter((p) => p.filter.tags).map((p) => html`<li><span class="adm-tag">${p.filter.tags.join(', ')}</span> → <a href="${siteBase()}projects/${p.slug}/" target="_blank" rel="noopener">${p.title}</a> project page</li>`);
  main.innerHTML = html`
    <div class="adm-page-head"><div><h1>Help</h1><p class="adm-sub">How the publication lists on the site are built.</p></div></div>
    <div class="adm-grid-2">
      <section class="adm-card adm-prose">
        <h2>Where a paper shows up</h2>
        <ul>
          <li><strong>Papers page</strong> — every publication, newest first, grouped by year.</li>
          <li><strong>Project pages</strong> — chosen by tag:<ul>${tags}</ul></li>
          <li><strong>Member pages</strong> — chosen by author name. Write authors the same way every time (for example <code>K Bekris</code>), one per line.</li>
        </ul>
        <p>Each paper's edit screen lists exactly which pages it will appear on.</p>
        <h2>Ordering</h2>
        <p>Lists are sorted by <strong>Date</strong> (newest first), then by year. Set the date to the conference or publication date to control the position within a year.</p>
        <h2>Shortcuts</h2>
        <p>In the editor, <kbd>Ctrl</kbd>+<kbd>S</kbd> (<kbd>⌘</kbd>+<kbd>S</kbd> on a Mac) saves. “Edit as BibTeX” lets you paste or fix the raw entry.</p>
      </section>
      <section class="adm-card adm-prose">
        <h2>Publishing</h2>
        <ol>
          <li>Make changes here. They are saved in this browser only.</li>
          <li>Open any page of the site in this browser to preview them.</li>
          <li>Go to <a href="#/export">Export &amp; publish</a>, download <code>publications.bib</code>, and upload it to <a href="${gh.upload}" target="_blank" rel="noopener">GitHub</a> under exactly that name.</li>
        </ol>
        <h2>Bulk updates</h2>
        <p>Paste BibTeX from Google Scholar, DBLP or a teachPress export into <a href="#/import">Import BibTeX</a>. Existing keys are shown as updates so you can review them before importing, and author names can be rewritten in the lab's style (<code>K Bekris</code>).</p>
        <h2>Working on two computers</h2>
        <p>Pending edits live in one browser. On <a href="#/export">Export &amp; publish</a>, use “Download pending changes (.json)” and load that file on the other computer with <a href="#/import">Import</a> — or simply publish first.</p>
      </section>
    </div>`.toString();
}
