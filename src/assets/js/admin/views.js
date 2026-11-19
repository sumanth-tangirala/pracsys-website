/** Admin views: dashboard, publication list, pending changes, export, account, help. */
import { TYPES, facets, filterPublications, toPublication, escapeHtml } from '../lib/publications.js';
import { serializeEntry } from '../lib/bibtex.js';
import { siteBase } from '../store.js';
import { html, raw, $, $$, toast, confirmDialog, download, copyText, relativeTime, plural, statusBadge, debounce } from './ui.js';
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

function bibFilename() {
  return 'publications.bib';
}

// ------------------------------------------------------------------ dashboard

export function renderDashboard(main, ctx) {
  const { store, user, config } = ctx;
  const pubs = store.publications();
  const thisYear = new Date().getFullYear();
  const inYear = pubs.filter((p) => p.year === thisYear).length;
  const changes = store.changes();
  const issues = dataIssues(store.entries());
  const byYear = new Map();
  for (const p of pubs) if (p.year) byYear.set(p.year, (byYear.get(p.year) || 0) + 1);
  const years = [...byYear.keys()].sort((a, b) => a - b).slice(-12);
  const max = Math.max(1, ...years.map((y) => byYear.get(y)));
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

    <div class="adm-stats">
      <a class="adm-stat" href="#/publications"><span class="adm-stat-num">${pubs.length}</span><span class="adm-stat-label">publications</span></a>
      <a class="adm-stat" href="#/publications?year=${thisYear}"><span class="adm-stat-num">${inYear}</span><span class="adm-stat-label">in ${thisYear}</span></a>
      <a class="adm-stat ${changes.length ? 'adm-stat-warn' : ''}" href="#/changes"><span class="adm-stat-num">${changes.length}</span><span class="adm-stat-label">pending ${changes.length === 1 ? 'change' : 'changes'}</span></a>
      <a class="adm-stat" href="#issues"><span class="adm-stat-num">${issues.length}</span><span class="adm-stat-label">data ${issues.length === 1 ? 'check' : 'checks'}</span></a>
    </div>

    <div class="adm-grid-2">
      <section class="adm-card">
        <h2>How publishing works</h2>
        <ol class="adm-steps">
          <li class="${changes.length ? 'is-done' : ''}"><strong>Edit</strong> — add, edit or import papers here. Changes are saved in this browser, and the public pages show them to you as a preview.</li>
          <li><strong>Export</strong> — download the updated <code>publications.bib</code> from <a href="#/export">Export &amp; publish</a>.</li>
          <li><strong>Publish</strong> — upload that file to the <a href="${gh.upload}" target="_blank" rel="noopener">data/ folder on GitHub</a>. The site rebuilds in about two minutes, and pending changes clear themselves.</li>
        </ol>
        ${changes.length
          ? html`<p class="adm-callout"><i class="fa fa-circle-exclamation" aria-hidden="true"></i> ${plural(changes.length, 'change')} not published yet. <a href="#/export">Export &amp; publish</a></p>`
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

    <section class="adm-card">
      <h2>Publications per year</h2>
      <div class="adm-bars" role="img" aria-label="${years.map((y) => `${y}: ${byYear.get(y)}`).join(', ')}">
        ${years.map((y) => html`<a class="adm-bar" href="#/publications?year=${y}" title="${byYear.get(y)} in ${y}"><span class="adm-bar-val">${byYear.get(y)}</span><span class="adm-bar-fill" style="height:${Math.round((byYear.get(y) / max) * 100)}%"></span><span class="adm-bar-label">${String(y).slice(2)}</span></a>`)}
      </div>
    </section>

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

  const all = () => {
    const live = store.publications();
    const deleted = store.changes().filter((c) => c.status === 'deleted' && c.before).map((c) => toPublication(c.before));
    return [...live, ...deleted];
  };

  main.innerHTML = html`
    <div class="adm-page-head">
      <div><h1>Publications</h1><p class="adm-sub" id="adm-list-summary"></p></div>
      <div class="adm-head-actions">
        <a class="adm-btn" href="#/import"><i class="fa fa-file-import" aria-hidden="true"></i> Import BibTeX</a>
        <a class="adm-btn adm-btn-primary" href="#/publications/new"><i class="fa fa-plus" aria-hidden="true"></i> Add publication</a>
      </div>
    </div>
    <form class="adm-toolbar" role="search" onsubmit="return false">
      <label class="adm-search"><i class="fa fa-magnifying-glass" aria-hidden="true"></i><span class="screen-reader-text">Search publications</span>
        <input type="search" name="q" placeholder="Search title, author, venue, key…" value="${state.q}"></label>
      <label><span class="screen-reader-text">Type</span><select name="type"></select></label>
      <label><span class="screen-reader-text">Year</span><select name="year"></select></label>
      <label><span class="screen-reader-text">Tag</span><select name="tag"></select></label>
      <label><span class="screen-reader-text">Status</span><select name="status">
        <option value="">Any status</option><option value="changed">Changed (not published)</option><option value="new">New</option><option value="edited">Edited</option><option value="deleted">Deleted</option>
      </select></label>
      <label><span class="screen-reader-text">Sort</span><select name="sort">
        <option value="date">Newest first</option><option value="date-asc">Oldest first</option><option value="title">Title A–Z</option><option value="changed">Recently changed</option>
      </select></label>
    </form>
    <div id="adm-list"></div>`.toString();

  const form = $('.adm-toolbar', main);
  form.elements.status.value = state.status;
  form.elements.sort.value = state.sort;

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
    history.replaceState(null, '', `#/publications${qs ? `?${qs}` : ''}`);
  };

  const draw = () => {
    const pubs = all();
    fillSelects(pubs);
    let rows = filterPublications(pubs, { q: state.q, type: state.type, year: state.year, tag: state.tag });
    const statusOf = (p) => store.statusOf(p.key) === 'deleted' && !store.get(p.key) ? 'deleted' : store.statusOf(p.key);
    if (state.status === 'changed') rows = rows.filter((p) => statusOf(p) !== 'published');
    else if (state.status) rows = rows.filter((p) => statusOf(p) === state.status);
    else rows = rows.filter((p) => statusOf(p) !== 'deleted');
    const changedAt = new Map(store.changes().map((c) => [c.key, c.at]));
    if (state.sort === 'title') rows.sort((a, b) => a.title.localeCompare(b.title));
    else if (state.sort === 'date-asc') rows.reverse();
    else if (state.sort === 'changed') rows.sort((a, b) => String(changedAt.get(b.key) || '').localeCompare(String(changedAt.get(a.key) || '')));

    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const slice = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    const filtered = state.q || state.type || state.year || state.tag || state.status;
    $('#adm-list-summary', main).textContent = filtered
      ? `${rows.length} of ${store.publications().length} publications match.`
      : `${rows.length} publications. Click a title to edit it.`;

    $('#adm-list', main).innerHTML = rows.length ? html`
      <div class="adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th scope="col">Publication</th><th scope="col">Year</th><th scope="col">Type</th><th scope="col">Tags</th><th scope="col"><span class="screen-reader-text">Status and actions</span></th></tr></thead>
        <tbody>${slice.map((p) => {
          const st = statusOf(p);
          return html`<tr class="adm-row-${st}">
            <td class="adm-cell-main">
              ${st === 'deleted' ? html`<span class="adm-row-title">${p.title}</span>` : html`<a class="adm-row-title" href="${editHref(p.key)}">${p.title}</a>`}
              <div class="adm-row-authors">${p.authorText}</div>
              <div class="adm-row-venue">${p.text.booktitle || p.text.journal || p.text.school || p.text.institution || ''}</div>
            </td>
            <td>${p.pubstate === 'forthcoming' ? 'Forthc.' : (p.year || '—')}</td>
            <td>${TYPES[p.type]?.[0] || p.type}</td>
            <td class="adm-cell-tags">${p.tags.map((t) => html`<span class="adm-tag">${t}</span>`)}</td>
            <td class="adm-cell-actions">
              ${st !== 'published' ? statusBadge(st) : ''}
              ${st === 'deleted'
                ? html`<button type="button" class="adm-btn adm-btn-sm" data-act="restore" data-key="${p.key}">Restore</button>`
                : html`<a class="adm-btn adm-btn-sm" href="${editHref(p.key)}" aria-label="Edit ${p.title}">Edit</a>
                  <button type="button" class="adm-btn adm-btn-sm adm-btn-icon" data-act="duplicate" data-key="${p.key}" title="Duplicate" aria-label="Duplicate ${p.title}"><i class="fa fa-copy" aria-hidden="true"></i></button>
                  <button type="button" class="adm-btn adm-btn-sm adm-btn-icon adm-btn-danger-ghost" data-act="delete" data-key="${p.key}" title="Delete" aria-label="Delete ${p.title}"><i class="fa fa-trash-can" aria-hidden="true"></i></button>`}
            </td></tr>`;
        })}</tbody>
      </table></div>
      ${pages > 1 ? html`<nav class="adm-pager" aria-label="Pages">
        <button type="button" class="adm-btn adm-btn-sm" data-page="${state.page - 1}" ${state.page <= 1 ? raw('disabled') : ''}>&larr; Previous</button>
        <span>Page ${state.page} of ${pages}</span>
        <button type="button" class="adm-btn adm-btn-sm" data-page="${state.page + 1}" ${state.page >= pages ? raw('disabled') : ''}>Next &rarr;</button>
      </nav>` : ''}`.toString()
      : html`<div class="adm-empty"><p>No publications match these filters.</p><button type="button" class="adm-btn" data-act="clear">Clear filters</button></div>`.toString();
  };

  form.addEventListener('input', debounce((e) => {
    if (e.target.name !== 'q') return;
    state.q = e.target.value.trim();
    state.page = 1;
    syncHash();
    draw();
  }, 180));
  form.addEventListener('change', (e) => {
    if (e.target.name === 'q') return;
    state[e.target.name] = e.target.value;
    state.page = 1;
    syncHash();
    draw();
  });
  main.addEventListener('click', async (e) => {
    const pageBtn = e.target.closest('[data-page]');
    if (pageBtn) {
      state.page = Number(pageBtn.dataset.page);
      syncHash();
      draw();
      main.scrollIntoView();
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
    } else if (btn.dataset.act === 'duplicate') {
      ctx.navigate(`/publications/new?from=${encodeURIComponent(key)}`);
    } else if (btn.dataset.act === 'delete') {
      const entry = store.get(key);
      const ok = await confirmDialog({
        title: 'Delete this publication?',
        body: `“${entry?.fields.title || key}” will be removed from the site when you next publish. You can restore it from Pending changes until then.`,
        confirm: 'Delete',
        danger: true,
      });
      if (!ok) return;
      store.remove(key, { user: ctx.user.username });
      toast('Publication deleted. Restore it any time before publishing.', 'success');
      draw();
    } else if (btn.dataset.act === 'restore') {
      store.revert(key);
      toast('Publication restored.', 'success');
      draw();
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
    const a = String(before?.fields[k] ?? '').trim();
    const b = String(after?.fields[k] ?? '').trim();
    if (a !== b) rows.push({ field: FIELD_LABELS[k] || k, from: a, to: b });
  }
  return rows;
}

export function renderChanges(main, ctx) {
  const { store } = ctx;
  const draw = () => {
    const changes = store.changes();
    const groups = [
      ['new', 'New publications'],
      ['edited', 'Edited publications'],
      ['deleted', 'Deleted publications'],
    ];
    main.innerHTML = html`
      <div class="adm-page-head">
        <div><h1>Pending changes</h1>
        <p class="adm-sub">${changes.length ? `${plural(changes.length, 'change')} saved in this browser and not yet on the live site.` : 'Nothing waiting to be published.'}</p></div>
        <div class="adm-head-actions">
          ${changes.length ? html`<button type="button" class="adm-btn adm-btn-danger-ghost" data-act="discard-all">Discard all</button>
          <a class="adm-btn adm-btn-primary" href="#/export"><i class="fa fa-cloud-arrow-up" aria-hidden="true"></i> Export &amp; publish</a>` : ''}
        </div>
      </div>
      ${changes.length ? '' : html`<div class="adm-empty"><i class="fa fa-circle-check adm-empty-icon" aria-hidden="true"></i><p>Your browser has no unpublished edits.</p><p><a class="adm-btn" href="#/publications">Go to publications</a></p></div>`}
      ${groups.map(([status, title]) => {
        const items = changes.filter((c) => c.status === status);
        if (!items.length) return '';
        return html`<section class="adm-card"><h2>${title} <span class="adm-muted">(${items.length})</span></h2>
          <ul class="adm-change-list">${items.map((c) => {
            const entry = c.after || c.before;
            const diff = status === 'edited' ? fieldDiff(c.before, c.after) : [];
            return html`<li class="adm-change">
              <div class="adm-change-head">
                <div>
                  ${statusBadge(status)}
                  ${status === 'deleted' ? html`<strong>${entry.fields.title || c.key}</strong>` : html`<a href="${editHref(c.key)}"><strong>${entry.fields.title || c.key}</strong></a>`}
                  <div class="adm-muted adm-small"><code>${c.key}</code>${c.renamedFrom ? html` (renamed from <code>${c.renamedFrom}</code>)` : ''}${c.renamedTo ? html` (renamed to <code>${c.renamedTo}</code>)` : ''} · ${relativeTime(c.at)}${c.user ? ` by ${c.user}` : ''}</div>
                </div>
                <button type="button" class="adm-btn adm-btn-sm" data-act="revert" data-key="${c.key}">${status === 'new' ? 'Remove' : status === 'deleted' ? 'Restore' : 'Revert'}</button>
              </div>
              ${diff.length ? html`<table class="adm-diff"><thead><tr><th scope="col">Field</th><th scope="col">Live site</th><th scope="col">Your version</th></tr></thead><tbody>${diff.map((d) => html`<tr><th scope="row">${d.field}</th><td class="adm-diff-old">${d.from || raw('<em>empty</em>')}</td><td class="adm-diff-new">${d.to || raw('<em>empty</em>')}</td></tr>`)}</tbody></table>` : ''}
              ${status === 'new' ? html`<details><summary>BibTeX</summary><pre class="adm-pre">${serializeEntry(c.after)}</pre></details>` : ''}
            </li>`;
          })}</ul></section>`;
      })}`.toString();
  };
  main.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'revert') {
      store.revert(btn.dataset.key);
      toast('Change undone.', 'success');
      draw();
    } else if (btn.dataset.act === 'discard-all') {
      const ok = await confirmDialog({
        title: 'Discard all pending changes?',
        body: `This removes ${plural(store.changeCount, 'unpublished change')} from this browser. It cannot be undone. Export a backup first if you might need them.`,
        confirm: 'Discard all',
        danger: true,
      });
      if (!ok) return;
      store.discardAll();
      toast('All pending changes discarded.', 'success');
      draw();
    }
  });
  draw();
}

// --------------------------------------------------------------------- export

export function renderExport(main, ctx) {
  const { store, config } = ctx;
  const gh = githubLinks(config);
  const changes = store.changes();
  const counts = { new: 0, edited: 0, deleted: 0 };
  for (const c of changes) counts[c.status]++;
  main.innerHTML = html`
    <div class="adm-page-head"><div><h1>Export &amp; publish</h1>
      <p class="adm-sub">${changes.length ? `${counts.new} new, ${counts.edited} edited and ${counts.deleted} deleted ${changes.length === 1 ? 'publication' : 'publications'} will go live.` : 'There are no pending changes, but you can still download the current list.'}</p></div></div>

    <section class="adm-card adm-publish">
      <h2><span class="adm-step-num">1</span> Download the updated BibTeX file</h2>
      <p>This is the complete list (${store.entries().length} publications) including your changes, in the same format teachPress uses.</p>
      <div class="adm-actions">
        <button type="button" class="adm-btn adm-btn-primary" data-act="bib"><i class="fa fa-download" aria-hidden="true"></i> Download publications.bib</button>
        <button type="button" class="adm-btn" data-act="copy"><i class="fa fa-copy" aria-hidden="true"></i> Copy to clipboard</button>
      </div>
    </section>

    <section class="adm-card adm-publish">
      <h2><span class="adm-step-num">2</span> Upload it to GitHub</h2>
      <p>Open the <a href="${gh.upload}" target="_blank" rel="noopener">upload page for the <code>data/</code> folder</a>, drop in <code>publications.bib</code>, and press <strong>Commit changes</strong>. GitHub replaces the old file. You need write access to <a href="${gh.repo}" target="_blank" rel="noopener">${config.repo}</a>.</p>
      <div class="adm-actions">
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
        <button type="button" class="adm-btn" data-act="changed" ${changes.some((c) => c.after) ? '' : raw('disabled')}>Only new &amp; edited entries (.bib)</button>
        <button type="button" class="adm-btn" data-act="json">Backup of everything (.json)</button>
      </div>
      <p class="adm-muted adm-small">The JSON backup can be loaded again from <a href="#/import">Import</a>, for example to move your pending edits to another computer.</p>
    </section>`.toString();

  main.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'bib') {
      download(bibFilename(), store.exportBibtex(), 'application/x-bibtex');
      toast('publications.bib downloaded. Next: upload it on GitHub.', 'success');
    } else if (act === 'copy') {
      toast(await copyText(store.exportBibtex()) ? 'BibTeX copied to the clipboard.' : 'Could not copy. Use the download button instead.', 'info');
    } else if (act === 'changed') {
      download('publications-changes.bib', store.exportBibtex({ onlyChanged: true }), 'application/x-bibtex');
    } else if (act === 'json') {
      download(`pracsys-publications-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson(), 'application/json');
    }
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
          <div class="adm-alert" role="alert" hidden></div>
          <label class="adm-field"><span class="adm-label">Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
          <label class="adm-field"><span class="adm-label">New password</span><input type="password" name="next" autocomplete="new-password" minlength="8" required><span class="adm-help">At least 8 characters.</span></label>
          <label class="adm-field"><span class="adm-label">Repeat new password</span><input type="password" name="again" autocomplete="new-password" required></label>
          <button class="adm-btn adm-btn-primary" type="submit">Update password</button>
        </form>
        <div id="pw-result" hidden>
          <p>The new password works in this browser now. To use it everywhere, replace your entry in <a href="${gh.usersFile}" target="_blank" rel="noopener"><code>src/admin/users.json</code></a> with:</p>
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alert.hidden = true;
    alert.className = 'adm-alert adm-alert-error';
    const { current, next, again } = form.elements;
    if (next.value !== again.value) {
      alert.textContent = 'The new passwords do not match.';
      alert.hidden = false;
      again.focus();
      return;
    }
    try {
      const record = await changePassword(current.value, next.value);
      form.reset();
      $('#pw-json', main).textContent = JSON.stringify(record, null, 2);
      $('#pw-result', main).hidden = false;
      toast('Password updated in this browser.', 'success');
    } catch (err) {
      alert.textContent = err.message;
      alert.hidden = false;
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
      </section>
      <section class="adm-card adm-prose">
        <h2>Publishing</h2>
        <ol>
          <li>Make changes here. They are saved in this browser only.</li>
          <li>Open any page of the site in this browser to preview them.</li>
          <li>Go to <a href="#/export">Export &amp; publish</a>, download <code>publications.bib</code>, and upload it to <a href="${gh.upload}" target="_blank" rel="noopener">GitHub</a>.</li>
        </ol>
        <h2>Bulk updates</h2>
        <p>Paste BibTeX from Google Scholar, DBLP or a teachPress export into <a href="#/import">Import BibTeX</a>. Existing keys are shown as updates so you can review them before importing.</p>
        <h2>Working on two computers</h2>
        <p>Pending edits live in one browser. Export the JSON backup and import it on the other computer, or publish first.</p>
      </section>
    </div>`.toString();
}
