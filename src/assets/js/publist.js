/**
 * Interactive teachPress-style publication lists.
 *
 * The build pre-renders page 1 of every list. This module adds the panel
 * toggles (Abstract / Links / BibTeX), paging, the filter bar on /papers/,
 * shareable filter URLs, and the live preview of unpublished edits.
 */
import {
  filterPublications,
  renderPublicationList,
  facets,
  TYPES,
  escapeHtml,
} from './lib/publications.js';
import { renderPager } from './lib/pager.js';
import { getStore, previewDisabled, readOverlay, CHANGE_EVENT } from './store.js';

const FILTER_KEYS = ['year', 'type', 'author', 'tag', 'q'];

/** Panel toggles work on pre-rendered markup without loading any data. */
export function bindToggles(root) {
  root.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-tp-toggle]');
    if (!btn || !root.contains(btn)) return;
    const pub = btn.closest('.tp_publication');
    if (!pub) return;
    event.preventDefault();
    const panel = btn.dataset.tpToggle;
    const target = pub.querySelector(`#${CSS.escape(pub.id)}-${panel}`);
    if (!target) return;
    const opening = target.hidden;
    for (const p of pub.querySelectorAll('.tp_abstract, .tp_links, .tp_bibtex')) p.hidden = true;
    for (const b of pub.querySelectorAll('[aria-expanded]')) b.setAttribute('aria-expanded', 'false');
    if (opening) {
      target.hidden = false;
      for (const b of pub.querySelectorAll(`[data-tp-toggle="${panel}"][aria-expanded]`)) b.setAttribute('aria-expanded', 'true');
      if (panel === 'bibtex') addCopyButton(target);
      if (btn.classList.contains('tp_close')) pub.querySelector(`.tp_${panel}_link button, .tp_title_link`)?.focus();
    } else if (btn.classList.contains('tp_close')) {
      pub.querySelector(`.tp_${panel}_link button`)?.focus();
    }
  });
}

function addCopyButton(panel) {
  const box = panel.querySelector('.tp_bibtex_entry');
  if (!box || box.querySelector('.tp-copy') || !navigator.clipboard) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tp-copy';
  b.textContent = 'Copy';
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(box.querySelector('pre').textContent);
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Copy failed';
    }
    setTimeout(() => { b.textContent = 'Copy'; }, 1600);
  });
  box.prepend(b);
}

class Publist {
  constructor(root) {
    this.root = root;
    this.config = JSON.parse(root.dataset.publist || '{}');
    this.base = root.dataset.base || '';
    this.perPage = this.config.perPage || 50;
    this.state = { page: 1, year: '', type: '', author: '', tag: '', q: '' };
    this.form = root.querySelector('.teachpress_filter');
    this.results = root.querySelector('.tp-results');
    this.pagerTop = root.querySelector('.tp-pager-top');
    this.pagerBottom = root.querySelector('.tp-pager-bottom');
    this.pubs = null;

    bindToggles(root);
    root.addEventListener('click', (e) => this.onPagerClick(e));
    if (this.form) this.bindForm();

    this.start();
    window.addEventListener(CHANGE_EVENT, () => this.refresh());
    window.addEventListener('popstate', () => {
      if (!this.config.syncUrl) return;
      this.readUrl();
      this.refresh({ keepPage: true });
    });
  }

  async start() {
    if (this.config.syncUrl) {
      await translateLegacyUrl(this.base);
      this.readUrl();
    }
    const needsData = this.hasActiveState() || (!previewDisabled() && Object.keys(readOverlay().changes).length > 0);
    if (needsData) this.refresh();
  }

  hasActiveState() {
    return this.state.page > 1 || FILTER_KEYS.some((k) => this.state[k]);
  }

  readUrl() {
    const params = new URLSearchParams(location.search);
    for (const k of FILTER_KEYS) this.state[k] = params.get(k) || '';
    this.state.page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
    if (this.form) this.syncFormFromState();
  }

  writeUrl() {
    if (!this.config.syncUrl) return;
    const params = new URLSearchParams();
    for (const k of FILTER_KEYS) if (this.state[k]) params.set(k, this.state[k]);
    if (this.state.page > 1) params.set('page', String(this.state.page));
    const qs = params.toString();
    const url = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) history.pushState(null, '', url);
  }

  bindForm() {
    let timer = null;
    this.form.addEventListener('change', (e) => {
      if (e.target.name === 'q') return;
      this.updateFromForm();
    });
    this.form.addEventListener('input', (e) => {
      if (e.target.name !== 'q') return;
      clearTimeout(timer);
      timer = setTimeout(() => this.updateFromForm(), 220);
    });
    this.form.querySelector('.tp-reset')?.addEventListener('click', () => {
      for (const k of FILTER_KEYS) this.state[k] = '';
      this.state.page = 1;
      this.syncFormFromState();
      this.writeUrl();
      this.refresh();
    });
  }

  updateFromForm() {
    for (const k of FILTER_KEYS) {
      const el = this.form.elements[k];
      if (el) this.state[k] = el.value.trim();
    }
    this.state.page = 1;
    this.writeUrl();
    this.refresh();
  }

  syncFormFromState() {
    for (const k of FILTER_KEYS) {
      const el = this.form.elements[k];
      if (!el) continue;
      if (el.tagName === 'SELECT' && this.state[k] && ![...el.options].some((o) => o.value === this.state[k])) {
        el.add(new Option(this.state[k], this.state[k]));
      }
      el.value = this.state[k];
    }
    const reset = this.form.querySelector('.tp-reset');
    if (reset) reset.hidden = !FILTER_KEYS.some((k) => this.state[k]);
  }

  onPagerClick(event) {
    const a = event.target.closest('a[data-page]');
    if (!a || !this.root.contains(a)) return;
    event.preventDefault();
    this.state.page = parseInt(a.dataset.page, 10) || 1;
    this.writeUrl();
    this.refresh({ keepPage: true, scroll: true });
  }

  async refresh({ keepPage = true, scroll = false } = {}) {
    this.root.classList.add('tp-loading');
    try {
      const store = getStore();
      if (!store.published) await store.load();
      this.pubs = store.publications({ includeOverlay: !previewDisabled() });
    } catch (err) {
      this.root.classList.remove('tp-loading');
      console.error(err);
      return;
    }
    this.render({ keepPage });
    this.root.classList.remove('tp-loading');
    if (scroll) {
      const top = this.root.getBoundingClientRect().top + window.scrollY - 90;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  }

  render() {
    const filter = { ...this.config.filter };
    for (const k of FILTER_KEYS) if (this.state[k]) filter[k] = this.state[k];
    const matched = filterPublications(this.pubs, filter);
    const pages = Math.max(1, Math.ceil(matched.length / this.perPage));
    this.state.page = Math.min(this.state.page, pages);
    const start = (this.state.page - 1) * this.perPage;
    const slice = matched.slice(start, start + this.perPage);
    this.results.innerHTML = renderPublicationList(slice, {
      showTags: !!this.config.showTags,
      tagHref: (t) => `${this.base}/papers/?tag=${encodeURIComponent(t)}`,
      idPrefix: this.config.idPrefix || 'tp',
      emptyText: this.config.emptyText,
    });
    const pager = renderPager(matched.length, this.state.page, this.perPage);
    this.pagerTop.innerHTML = pager;
    this.pagerBottom.innerHTML = matched.length > this.perPage ? pager : '';
    if (this.form) this.refreshFilterOptions();
  }

  /** Keep the drop-downs in sync with the data (local edits may add years, tags…). */
  refreshFilterOptions() {
    const f = facets(this.pubs);
    const fill = (name, values, allLabel, label = (v) => v) => {
      const el = this.form.elements[name];
      if (!el) return;
      const current = this.state[name];
      el.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>`
        + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(label(v))}</option>`).join('');
      if (current && !values.map(String).includes(current)) el.add(new Option(current, current));
      el.value = current;
    };
    fill('year', f.years.map(String), 'All years', (y) => (y === '0' ? 'Undated' : y));
    fill('type', f.types, 'All types', (t) => TYPES[t]?.[1] || t);
    fill('author', f.authors, 'All authors');
    fill('tag', f.tags, 'All tags');
    const reset = this.form.querySelector('.tp-reset');
    if (reset) reset.hidden = !FILTER_KEYS.some((k) => this.state[k]);
  }
}

/**
 * Links into the old WordPress site use teachPress' numeric IDs
 * (?tgid=2&auth=189&yr=2024&limit=2). Rewrite them to the readable
 * parameters this site uses so old bookmarks and citations keep working.
 */
async function translateLegacyUrl(base) {
  const params = new URLSearchParams(location.search);
  const legacy = ['tgid', 'auth', 'yr', 'usr', 'limit', 'tsr'].filter((k) => params.has(k));
  if (!legacy.length) return;
  let ids = { tags: {}, authors: {} };
  if (params.get('tgid') || params.get('auth')) {
    try {
      ids = await (await fetch(`${base}/assets/js/teachpress-ids.json`)).json();
    } catch { /* fall back to dropping the unknown IDs */ }
  }
  const next = new URLSearchParams();
  for (const [k, v] of params) if (!legacy.includes(k) && v) next.set(k, v);
  if (params.get('yr')) next.set('year', params.get('yr') === '0000' ? '0' : params.get('yr'));
  if (ids.tags[params.get('tgid')]) next.set('tag', ids.tags[params.get('tgid')]);
  const author = ids.authors[params.get('auth')];
  if (author) next.set('author', author);
  if (params.get('tsr')) next.set('q', params.get('tsr'));
  if (Number(params.get('limit')) > 1) next.set('page', params.get('limit'));
  const qs = next.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash === '#tppubs' ? '' : location.hash}`);
}

export function initPublists() {
  for (const root of document.querySelectorAll('.tp-publist')) new Publist(root);
}
