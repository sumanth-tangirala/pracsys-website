/**
 * teachPress-style pager: "198 entries « ‹ 1 of 4 › »".
 * Shared by the build and the browser so both produce identical markup.
 */
export function renderPager(total, page, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const entries = `<span class="displaying-num">${total} ${total === 1 ? 'entry' : 'entries'}</span>`;
  if (pages <= 1) return `<div class="tablenav"><div class="tablenav-pages">${entries}</div></div>`;
  const btn = (target, label, title, disabled) => disabled
    ? `<span class="page-numbers button disabled" aria-hidden="true">${label}</span>`
    : `<a class="page-numbers button" href="?page=${target}" data-page="${target}" title="${title}">${label}</a>`;
  return `<div class="tablenav"><nav class="tablenav-pages" aria-label="Publication pages">${entries} `
    + `${btn(1, '&laquo;', 'first page', page <= 1)} ${btn(page - 1, '&lsaquo;', 'previous page', page <= 1)} `
    + `<span class="paging-input">${page} of ${pages}</span> `
    + `${btn(page + 1, '&rsaquo;', 'next page', page >= pages)} ${btn(pages, '&raquo;', 'last page', page >= pages)}</nav></div>`;
}
