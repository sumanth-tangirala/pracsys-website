/**
 * teachPress-style pager: "198 entries « ‹ 1 of 4 › »".
 * Shared by the build and the browser so both produce identical markup.
 */

/** Accessible names of the pagers above and below a list (build and browser use the same). */
export const PAGER_LABELS = { top: 'Publication pages (top)', bottom: 'Publication pages (bottom)' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {number} total number of entries
 * @param {number} page current page (clamped to the valid range)
 * @param {number} perPage entries per page
 * @param {{label?: string, href?: (page: number) => string}} [options]
 *   label: aria-label of the <nav>; href: link target for a page
 *   (default "?page=N").
 */
export function renderPager(total, page, perPage, options = {}) {
  const count = Math.max(0, Number(total) || 0);
  const size = Math.max(1, Math.floor(Number(perPage)) || 1);
  const pages = Math.max(1, Math.ceil(count / size));
  const current = Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1));
  const entries = `<span class="displaying-num">${count} ${count === 1 ? 'entry' : 'entries'}</span>`;
  if (pages <= 1) return `<div class="tablenav"><div class="tablenav-pages">${entries}</div></div>`;
  const href = options.href || ((n) => `?page=${n}`);
  const btn = (target, label, name, title, disabled) => disabled
    ? `<span class="page-numbers button disabled" aria-hidden="true">${label}</span>`
    : `<a class="page-numbers button" href="${esc(href(target))}" data-page="${target}" title="${title}" aria-label="${name}">${label}</a>`;
  return `<div class="tablenav"><nav class="tablenav-pages" aria-label="${esc(options.label || 'Publication pages')}">${entries} `
    + `${btn(1, '&laquo;', 'First page', 'first page', current <= 1)} ${btn(current - 1, '&lsaquo;', 'Previous page', 'previous page', current <= 1)} `
    + `<span class="paging-input">${current} of ${pages}</span> `
    + `${btn(current + 1, '&rsaquo;', 'Next page', 'next page', current >= pages)} ${btn(pages, '&raquo;', 'Last page', 'last page', current >= pages)}</nav></div>`;
}
