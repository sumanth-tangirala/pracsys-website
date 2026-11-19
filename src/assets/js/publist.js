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
  publistRenderOptions,
  facets,
  TYPES,
  PER_PAGE,
  escapeHtml,
} from './lib/publications.js';
import { renderPager, PAGER_LABELS } from './lib/pager.js';
import { getStore } from './store.js';
import { previewDisabled, readOverlay, siteBase, CHANGE_EVENT } from './overlay.js';

const FILTER_KEYS = ['year', 'type', 'author', 'tag', 'q'];
const LEGACY_KEYS = ['tgid', 'auth', 'yr', 'usr', 'limit', 'tsr'];
const PANELS = ['abstract', 'links', 'bibtex'];

/** Panel toggles work on pre-rendered markup without loading any data. */
export function bindToggles(root) {
  root.addEventListener('click', (event) => {
    if (event.defaultPrevented) return; // already handled (nested list)
    const btn = event.target.closest?.('[data-tp-toggle]');
    if (!btn || !root.contains(btn)) return;
    const pub = btn.closest('.tp_publication');
    const panel = btn.dataset.tpToggle;
    if (!pub || !pub.id || !PANELS.includes(panel)) return;
    const targetId = `${pub.id}-${panel}`;
    const target = [...pub.querySelectorAll(`.tp_${panel}`)].find((el) => el.id === targetId);
    if (!target) return;
    event.preventDefault();
    const opening = target.hidden;
    for (const p of pub.querySelectorAll('.tp_abstract, .tp_links, .tp_bibtex')) p.hidden = true;
    for (const b of pub.querySelectorAll('[data-tp-toggle][aria-expanded]')) b.setAttribute('aria-expanded', 'false');
    if (opening) {
      target.hidden = false;
      for (const b of pub.querySelectorAll(`[data-tp-toggle="${panel}"][aria-expanded]`)) b.setAttribute('aria-expanded', 'true');
      if (panel === 'bibtex') addCopyButton(target);
    } else if (btn.classList.contains('tp_close')) {
      // The Close button just disappeared with its panel: return focus to the toggle.
      (pub.querySelector(`.tp_${panel}_link button`) || pub.querySelector('.tp_title_link'))?.focus();
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
  b.setAttribute('aria-label', 'Copy BibTeX');
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

const prefersReducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

class Publist {
  constructor(root) {
    this.root = root;
    let config = {};
    try {
      config = JSON.parse(root.dataset.publist || '{}') || {};
    } catch (err) {
      console.error('Invalid data-publist configuration', err);
    }
    this.config = config;
    // data-base is "" or "/pracsys-website" (no trailing slash).
    this.base = (root.dataset.base ?? siteBase()).replace(/\/+$/, '');
    this.perPage = Math.max(1, parseInt(config.perPage, 10) || PER_PAGE);
    this.state = { page: 1, year: '', type: '', author: '', tag: '', q: '' };
    this.form = root.querySelector('.teachpress_filter');
    this.results = root.querySelector('.tp-results');
    this.pagerTop = root.querySelector('.tp-pager-top');
    this.pagerBottom = root.querySelector('.tp-pager-bottom');
    this.status = root.querySelector('.tp-status');
    this.pubs = null;
    this.refreshId = 0;
    this.optionsSignature = '';

    bindToggles(root);
    if (!this.results) return;
    root.addEventListener('click', (e) => this.onPagerClick(e));
    if (this.form) this.bindForm();

    window.addEventListener(CHANGE_EVENT, () => {
      if (this.pubs || this.needsData()) this.refresh();
    });
    window.addEventListener('popstate', () => {
      if (!this.config.syncUrl) return;
      this.readUrl();
      if (this.pubs || this.needsData()) this.refresh({ announce: true });
    });
    this.start().catch((err) => console.error(err));
  }

  async start() {
    if (this.config.syncUrl) {
      try {
        await translateLegacyUrl(this.base);
      } catch (err) {
        console.error(err);
      }
      this.readUrl();
    }
    if (this.needsData()) await this.refresh();
  }

  hasActiveState() {
    return this.state.page > 1 || FILTER_KEYS.some((k) => this.state[k]);
  }

  /** The pre-rendered page is stale: filters/page in the URL or local edits to preview. */
  needsData() {
    return this.hasActiveState() || (!previewDisabled() && Object.keys(readOverlay().changes).length > 0);
  }

  readUrl() {
    const params = new URLSearchParams(location.search);
    for (const k of FILTER_KEYS) this.state[k] = (params.get(k) || '').trim();
    this.state.page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
    if (this.form) this.syncFormFromState();
  }

  /** Query string for the current filters at `page` (other parameters are kept). */
  queryFor(page) {
    const params = new URLSearchParams(location.search);
    for (const k of [...FILTER_KEYS, 'page']) params.delete(k);
    for (const k of FILTER_KEYS) if (this.state[k]) params.set(k, this.state[k]);
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  writeUrl({ replace = false } = {}) {
    if (!this.config.syncUrl) return;
    const url = `${location.pathname}${this.queryFor(this.state.page)}${location.hash}`;
    if (url === `${location.pathname}${location.search}${location.hash}`) return;
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }

  bindForm() {
    let timer = null;
    this.form.addEventListener('submit', (e) => e.preventDefault());
    this.form.addEventListener('change', (e) => {
      if (e.target.name === 'q') return;
      this.updateFromForm();
    });
    this.form.addEventListener('input', (e) => {
      if (e.target.name !== 'q') return;
      clearTimeout(timer);
      timer = setTimeout(() => this.updateFromForm({ typing: true }), 220);
    });
    this.form.querySelector('.tp-reset')?.addEventListener('click', () => {
      clearTimeout(timer);
      for (const k of FILTER_KEYS) this.state[k] = '';
      this.state.page = 1;
      this.syncFormFromState();
      this.writeUrl();
      this.refresh({ announce: true });
      this.form.elements.q?.focus();
    });
  }

  updateFromForm({ typing = false } = {}) {
    const previousQuery = this.state.q;
    for (const k of FILTER_KEYS) {
      const el = this.form.elements[k];
      if (el) this.state[k] = el.value.trim();
    }
    this.state.page = 1;
    // One history entry per search, not one per pause while typing.
    this.writeUrl({ replace: typing && !!previousQuery });
    this.refresh({ announce: true });
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
    this.updateReset();
  }

  updateReset() {
    const reset = this.form?.querySelector('.tp-reset');
    if (reset) reset.hidden = !FILTER_KEYS.some((k) => this.state[k]);
  }

  onPagerClick(event) {
    const a = event.target.closest?.('a[data-page]');
    if (!a || !this.root.contains(a)) return;
    // Let "open in new tab" through where the URL carries the state.
    if (this.config.syncUrl && (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
    event.preventDefault();
    this.state.page = parseInt(a.dataset.page, 10) || 1;
    this.writeUrl();
    this.refresh({ scroll: true, focus: true, announce: true });
  }

  async refresh({ scroll = false, focus = false, announce = false } = {}) {
    const id = ++this.refreshId;
    this.root.classList.add('tp-loading');
    this.root.setAttribute('aria-busy', 'true');
    try {
      const store = getStore();
      if (!store.published) await store.load();
      if (id !== this.refreshId) return; // superseded by a newer refresh
      this.pubs = store.publications({ includeOverlay: !previewDisabled() });
      this.render();
    } catch (err) {
      console.error(err);
      if (id === this.refreshId && this.hasActiveState()) this.renderError();
      return;
    } finally {
      if (id === this.refreshId) {
        this.root.classList.remove('tp-loading');
        this.root.removeAttribute('aria-busy');
      }
    }
    if (announce) this.announce();
    if (focus) {
      this.results.tabIndex = -1;
      this.results.focus({ preventScroll: true });
    }
    if (scroll) {
      const top = this.root.getBoundingClientRect().top + window.scrollY - 90;
      window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }

  render() {
    const filter = { ...(this.config.filter || {}) };
    for (const k of FILTER_KEYS) if (this.state[k]) filter[k] = this.state[k];
    const matched = filterPublications(this.pubs, filter);
    const pages = Math.max(1, Math.ceil(matched.length / this.perPage));
    if (this.state.page > pages) {
      this.state.page = pages;
      this.writeUrl({ replace: true });
    }
    const page = this.state.page;
    const start = (page - 1) * this.perPage;
    this.results.innerHTML = renderPublicationList(matched.slice(start, start + this.perPage), publistRenderOptions(this.config, this.base));
    const href = this.config.syncUrl ? (n) => this.queryFor(n) || '?page=1' : undefined;
    this.pagerTop.innerHTML = renderPager(matched.length, page, this.perPage, { label: PAGER_LABELS.top, href });
    this.pagerBottom.innerHTML = matched.length > this.perPage
      ? renderPager(matched.length, page, this.perPage, { label: PAGER_LABELS.bottom, href }) : '';
    this.summary = { total: matched.length, page, pages };
    if (this.form) this.refreshFilterOptions();
  }

  renderError() {
    this.results.innerHTML = '<div class="teachpress_publication_list tp_empty"><p>Sorry, the publication list could not be loaded. Please reload the page.</p></div>';
    this.pagerTop.innerHTML = '';
    this.pagerBottom.innerHTML = '';
  }

  /** Tell screen-reader users what changed ("12 entries match, page 1 of 1"). */
  announce() {
    if (!this.status || !this.summary) return;
    const { total, page, pages } = this.summary;
    const filtered = FILTER_KEYS.some((k) => this.state[k]);
    const text = `${total} ${total === 1 ? 'entry' : 'entries'}${filtered ? (total === 1 ? ' matches' : ' match') : ''}`
      + `${pages > 1 ? `, page ${page} of ${pages}` : ''}`;
    // Clear first so an identical message is announced again.
    this.status.textContent = '';
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => { this.status.textContent = text; }, 60);
  }

  /** Keep the drop-downs in sync with the data (local edits may add years, tags…). */
  refreshFilterOptions() {
    const f = facets(this.pubs);
    const lists = {
      year: [f.years.map(String), 'All years', (y) => (y === '0' ? 'Undated' : y)],
      type: [f.types, 'All types', (t) => TYPES[t]?.[1] || t],
      author: [f.authors, 'All authors', (a) => a],
      tag: [f.tags, 'All tags', (t) => t],
    };
    const signature = JSON.stringify(Object.values(lists).map((l) => l[0]));
    const rebuild = signature !== this.optionsSignature;
    this.optionsSignature = signature;
    for (const [name, [values, allLabel, label]] of Object.entries(lists)) {
      const el = this.form.elements[name];
      if (!el) continue;
      const current = this.state[name];
      if (rebuild) {
        el.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>`
          + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(label(v))}</option>`).join('');
      }
      if (current && ![...el.options].some((o) => o.value === current)) el.add(new Option(current, current));
      el.value = current;
    }
    this.updateReset();
  }
}

/**
 * Links into the old WordPress site use teachPress' numeric IDs
 * (?tgid=2&auth=189&yr=2024&limit=2). Rewrite them to the readable
 * parameters this site uses so old bookmarks and citations keep working.
 */
export async function translateLegacyUrl(base) {
  const params = new URLSearchParams(location.search);
  const legacy = LEGACY_KEYS.filter((k) => params.has(k));
  if (!legacy.length) return false;
  let ids = null;
  if (params.get('tgid') || params.get('auth')) {
    try {
      const r = await fetch(`${base}/assets/js/teachpress-ids.json`);
      if (r.ok) ids = await r.json();
    } catch { /* unknown IDs are dropped */ }
  }
  const lookup = (map, k) => (map && typeof map === 'object' && k && Object.prototype.hasOwnProperty.call(map, k)
    && typeof map[k] === 'string' ? map[k] : '');
  const next = new URLSearchParams();
  for (const [k, v] of params) if (!legacy.includes(k) && v && !next.has(k)) next.set(k, v);
  const yr = (params.get('yr') || '').trim();
  if (/^\d{4}$/.test(yr)) next.set('year', yr === '0000' ? '0' : String(Number(yr)));
  const tag = lookup(ids?.tags, params.get('tgid'));
  if (tag) next.set('tag', tag);
  const author = lookup(ids?.authors, params.get('auth'));
  if (author) next.set('author', author);
  if (params.get('tsr')) next.set('q', params.get('tsr'));
  const page = parseInt(params.get('limit') || '', 10);
  if (page > 1) next.set('page', String(page));
  const qs = next.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash === '#tppubs' ? '' : location.hash}`);
  return true;
}

export function initPublists() {
  // Create the store now so edits saved in another tab refresh the lists.
  try {
    getStore();
  } catch (err) {
    console.error(err);
  }
  for (const root of document.querySelectorAll('.tp-publist')) {
    if (root.tpPublist) continue;
    try {
      root.tpPublist = new Publist(root);
    } catch (err) {
      console.error(err);
    }
  }
}
