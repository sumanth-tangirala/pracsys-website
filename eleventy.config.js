import { HtmlBasePlugin } from '@11ty/eleventy';
import {
  renderPublicationList,
  filterPublications,
  PER_PAGE,
  facets,
  TYPES,
  escapeHtml,
} from './src/assets/js/lib/publications.js';
import { renderPager } from './src/assets/js/lib/pager.js';

/**
 * PATH_PREFIX lets the same source build for a GitHub Pages project site
 * (/pracsys-website/) or for a custom domain served from the root (/).
 */
const pathPrefix = process.env.PATH_PREFIX || '/';

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(HtmlBasePlugin);

  eleventyConfig.addPassthroughCopy({ 'src/uploads': 'uploads' });
  eleventyConfig.addPassthroughCopy({ 'src/assets': 'assets' });
  eleventyConfig.addPassthroughCopy({ data: 'data' });
  eleventyConfig.addPassthroughCopy('src/admin/users.json');
  eleventyConfig.addPassthroughCopy('src/.nojekyll');
  eleventyConfig.addWatchTarget('./data/');
  eleventyConfig.addWatchTarget('./src/assets/');

  /** JSON for inline <script type="application/json"> blocks. */
  eleventyConfig.addFilter('jsonAttr', (value) => escapeHtml(JSON.stringify(value)));
  eleventyConfig.addFilter('json', (value) => JSON.stringify(value).replace(/</g, '\\u003c'));

  eleventyConfig.addFilter('byGroup', (members, group) => members.filter((m) => m.group === group));
  eleventyConfig.addFilter('memberBySlug', (members, slug) => members.find((m) => m.slug === slug));
  eleventyConfig.addFilter('pubCount', (pubs, filter) => filterPublications(pubs, filter || {}).length);
  eleventyConfig.addFilter('readableDate', (d) =>
    new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }));
  eleventyConfig.addFilter('isoDate', (d) => new Date(d).toISOString().slice(0, 10));
  eleventyConfig.addFilter('obfuscateEmail', (email) =>
    [...String(email)].map((c) => `&#${c.charCodeAt(0)};`).join(''));

  /**
   * {% publist publications, { tags: [...], authors: [...], keys: [...] }, { filters: true, showTags: true } %}
   *
   * Renders the first page of a teachPress-style list at build time. The
   * browser script (assets/js/publist.js) takes over for paging, filtering
   * and previewing unpublished edits made in the admin editor.
   */
  eleventyConfig.addShortcode('publist', function (pubs, filter = {}, options = {}) {
    const base = pathPrefix.replace(/\/$/, '');
    const matched = filterPublications(pubs, filter);
    const perPage = options.perPage || PER_PAGE;
    const page = matched.slice(0, perPage);
    const config = { filter, ...options, perPage };
    const filtersHtml = options.filters ? renderFilters(facets(pubs)) : '';
    const list = renderPublicationList(page, {
      showTags: !!options.showTags,
      tagHref: (t) => `/papers/?tag=${encodeURIComponent(t)}`,
      idPrefix: options.idPrefix || 'tp',
      emptyText: options.emptyText,
    });
    const pager = renderPager(matched.length, 1, perPage);
    return `<div class="tp-publist" data-publist="${escapeHtml(JSON.stringify(config))}" data-base="${escapeHtml(base)}">`
      + `${filtersHtml}<div class="tp-pager-top">${pager}</div>`
      + `<div class="tp-results" aria-live="polite">${list}</div>`
      + `<div class="tp-pager-bottom">${matched.length > perPage ? pager : ''}</div></div>`;
  });

  function renderFilters(f) {
    const opt = (v, label) => `<option value="${escapeHtml(v)}">${escapeHtml(label)}</option>`;
    return `<form class="teachpress_filter" role="search" onsubmit="return false">`
      + `<label class="screen-reader-text" for="tp-year">Year</label><select id="tp-year" name="year">${opt('', 'All years')}${f.years.map((y) => opt(y, y || 'Undated')).join('')}</select>`
      + `<label class="screen-reader-text" for="tp-type">Type</label><select id="tp-type" name="type">${opt('', 'All types')}${f.types.map((t) => opt(t, TYPES[t][1])).join('')}</select>`
      + `<label class="screen-reader-text" for="tp-author">Author</label><select id="tp-author" name="author">${opt('', 'All authors')}${f.authors.map((a) => opt(a, a)).join('')}</select>`
      + `<label class="screen-reader-text" for="tp-tag">Tag</label><select id="tp-tag" name="tag">${opt('', 'All tags')}${f.tags.map((t) => opt(t, t)).join('')}</select>`
      + `<label class="screen-reader-text" for="tp-q">Search</label><input id="tp-q" name="q" type="search" placeholder="Search…" autocomplete="off">`
      + `<button type="button" class="tp-reset" hidden>Reset</button>`
      + `</form>`;
  }

  return {
    dir: { input: 'src', includes: '_includes', data: '_data', output: '_site' },
    pathPrefix,
    templateFormats: ['njk', 'html', 'md', '11ty.js'],
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  };
}
