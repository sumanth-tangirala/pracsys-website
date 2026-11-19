/**
 * Publication model, filtering and HTML rendering.
 *
 * Shared by the Eleventy build (pre-rendered, no-JS lists) and the browser
 * (interactive lists and the admin preview), so the markup is identical in
 * both places. Plain ES module, no imports besides the BibTeX helpers.
 */
import { latexToText, serializeEntry } from './bibtex.js';

/** teachPress publication types: singular label, plural label. */
export const TYPES = {
  article: ['Journal Article', 'Journal Articles'],
  book: ['Book', 'Books'],
  booklet: ['Booklet', 'Booklets'],
  collection: ['Collection', 'Collections'],
  conference: ['Conference', 'Conferences'],
  inbook: ['Book Chapter', 'Book Chapters'],
  incollection: ['Incollection', 'Incollections'],
  inproceedings: ['Proceedings Article', 'Proceedings Articles'],
  manual: ['Technical Manual', 'Technical Manuals'],
  mastersthesis: ['Masters Thesis', 'Masters Theses'],
  misc: ['Miscellaneous', 'Miscellaneous'],
  online: ['Online', 'Online'],
  patent: ['Patent', 'Patents'],
  periodical: ['Periodical', 'Periodicals'],
  phdthesis: ['PhD Thesis', 'PhD Theses'],
  presentation: ['Presentation', 'Presentations'],
  proceedings: ['Proceedings', 'Proceedings'],
  techreport: ['Technical Report', 'Technical Reports'],
  unpublished: ['Unpublished', 'Unpublished'],
  workshop: ['Workshop', 'Workshops'],
};

/** Publication states understood by the renderer (teachPress values). */
export const PUBSTATES = {
  published: 'Published',
  forthcoming: 'Forthcoming',
  accepted: 'Accepted',
  submitted: 'Submitted',
  inpress: 'In press',
  inreview: 'In review',
  preprint: 'Preprint',
};

/**
 * Fields the admin form shows for each type. `required` follows the BibTeX
 * conventions; everything else is offered as optional.
 */
export const TYPE_FIELDS = {
  article: { required: ['author', 'title', 'journal', 'year'], optional: ['volume', 'number', 'pages', 'publisher', 'issn', 'doi'] },
  book: { required: ['author', 'title', 'publisher', 'year'], optional: ['editor', 'edition', 'series', 'volume', 'address', 'isbn', 'doi'] },
  booklet: { required: ['title'], optional: ['author', 'howpublished', 'address', 'year'] },
  collection: { required: ['editor', 'title', 'year'], optional: ['publisher', 'address', 'edition', 'isbn'] },
  conference: { required: ['author', 'title', 'booktitle', 'year'], optional: ['address', 'pages', 'volume', 'number', 'series', 'organization', 'publisher', 'doi'] },
  inbook: { required: ['author', 'title', 'booktitle', 'publisher', 'year'], optional: ['editor', 'chapter', 'pages', 'volume', 'number', 'series', 'address', 'edition', 'isbn', 'doi'] },
  incollection: { required: ['author', 'title', 'booktitle', 'publisher', 'year'], optional: ['editor', 'pages', 'address', 'isbn', 'doi'] },
  inproceedings: { required: ['author', 'title', 'booktitle', 'year'], optional: ['address', 'pages', 'editor', 'organization', 'publisher', 'volume', 'series', 'doi'] },
  manual: { required: ['title'], optional: ['author', 'organization', 'address', 'edition', 'year'] },
  mastersthesis: { required: ['author', 'title', 'school', 'year'], optional: ['address', 'doi'] },
  misc: { required: ['title'], optional: ['author', 'howpublished', 'year'] },
  online: { required: ['title', 'year'], optional: ['author', 'organization'] },
  patent: { required: ['author', 'title', 'year'], optional: ['number', 'address'] },
  periodical: { required: ['title', 'year'], optional: ['editor', 'issuetitle', 'series', 'volume', 'number', 'issn'] },
  phdthesis: { required: ['author', 'title', 'school', 'year'], optional: ['address', 'doi'] },
  presentation: { required: ['author', 'title', 'year'], optional: ['howpublished', 'address'] },
  proceedings: { required: ['title', 'year'], optional: ['editor', 'publisher', 'organization', 'address', 'volume', 'number', 'series', 'isbn'] },
  techreport: { required: ['author', 'title', 'institution', 'year'], optional: ['techtype', 'number', 'address'] },
  unpublished: { required: ['author', 'title'], optional: ['howpublished', 'year'] },
  workshop: { required: ['author', 'title', 'booktitle', 'year'], optional: ['address', 'pages', 'organization', 'publisher', 'doi'] },
};

export const PER_PAGE = 50;

const TEXT_FIELDS = ['title', 'booktitle', 'journal', 'publisher', 'address', 'organization', 'school', 'institution', 'series', 'howpublished', 'note', 'edition', 'chapter', 'issuetitle', 'techtype', 'abstract'];

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Split a BibTeX name list on top-level " and ". */
export function splitNames(value) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && /\s/.test(c) && /^\s+and\s+/i.test(s.slice(i, i + 6))) {
      const m = /^\s+and\s+/i.exec(s.slice(i));
      out.push(s.slice(start, i));
      i += m[0].length - 1;
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Parse one name into {first, last}; "Last, First" or "First Last". */
export function parseName(raw) {
  const name = String(raw).trim();
  if (name.includes(',')) {
    const [last, ...rest] = name.split(',');
    return { first: latexToText(rest.join(',').trim()), last: latexToText(last.trim()) };
  }
  const tokens = [];
  let depth = 0;
  let cur = '';
  for (const c of name) {
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (/\s/.test(c) && depth === 0) {
      if (cur) tokens.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) tokens.push(cur);
  const last = tokens.pop() ?? '';
  return { first: latexToText(tokens.join(' ')), last: latexToText(last) };
}

/** teachPress display style: "Last, First". */
export function displayName(person) {
  return person.first ? `${person.last}, ${person.first}` : person.last;
}

/** Turn the raw `url` field (one link per line, optional ", title") into links. */
export function parseLinks(urlField, doi) {
  const links = [];
  String(urlField ?? '')
    .split(/\n|\\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const m = /^(\S+?)(?:,\s+(.+))?$/.exec(line);
      if (!m) return;
      const url = m[1].replace(/\\([&%_#])/g, '$1');
      links.push({ url, label: m[2] ? latexToText(m[2]) : url, icon: linkIcon(url) });
    });
  if (doi) {
    const d = String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    links.push({ url: `https://dx.doi.org/${d}`, label: `doi:${d}`, title: `Follow DOI:${d}`, icon: 'ai ai-doi' });
  }
  return links;
}

export function linkIcon(url) {
  const u = url.toLowerCase();
  if (/\.pdf($|[?#])/.test(u)) return 'fas fa-file-pdf';
  if (u.includes('arxiv.org')) return 'ai ai-arxiv';
  if (u.includes('github.com')) return 'fab fa-github';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'fab fa-youtube';
  if (/\.(ppt|pptx|key)($|[?#])/.test(u)) return 'fas fa-file-powerpoint';
  if (/\.(zip|gz|tgz)($|[?#])/.test(u)) return 'fas fa-file-archive';
  return 'fas fa-globe';
}

/** Split a keywords field into a clean, unique list of tags. */
export function parseTags(keywords) {
  const seen = new Set();
  return String(keywords ?? '')
    .split(/[,;]/)
    .map((t) => latexToText(t).trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

/**
 * Normalise a parsed BibTeX entry into the object the renderer works with.
 * @param {{type: string, key: string, fields: object}} entry
 * @param {number} order position in the source file (stable tie-breaker)
 */
export function toPublication(entry, order = 0) {
  const f = entry.fields || {};
  const type = (f.tppubtype || entry.type || 'misc').toLowerCase();
  const authors = splitNames(f.author).map(parseName);
  const editors = splitNames(f.editor).map(parseName);
  const yearMatch = /\d{4}/.exec(f.year || f.date || '');
  const year = yearMatch ? Number(yearMatch[0]) : 0;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(f.date || '').trim())
    ? String(f.date).trim()
    : `${String(year || 0).padStart(4, '0')}-01-01`;
  const text = {};
  for (const k of TEXT_FIELDS) if (f[k]) text[k] = latexToText(f[k]).trim();
  return {
    key: entry.key,
    type: TYPES[type] ? type : 'misc',
    entryType: entry.type,
    fields: { ...f },
    order,
    year,
    date,
    authors,
    editors,
    authorText: authors.map(displayName).join('; '),
    title: text.title || '(untitled)',
    text,
    pubstate: String(f.pubstate || 'published').split(',')[0].toLowerCase().replace(/\s+/g, '') || 'published',
    tags: parseTags(f.keywords),
    links: parseLinks(f.url, f.doi),
    image: f.image ? String(f.image).trim() : '',
  };
}

/** Newest first: date, then year, then original file order. */
export function sortPublications(pubs) {
  return [...pubs].sort((a, b) =>
    b.date.localeCompare(a.date) || b.year - a.year || a.order - b.order);
}

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Filter publications.
 * @param {Array} pubs
 * @param {object} f  { year, type, author, tag, q, authors: [..], tags: [..], keys: [..] }
 *   - author: exact "Last, First" display name
 *   - authors: list of display names, match any (used by member pages)
 *   - tags: list of tags, match any (used by project pages)
 */
export function filterPublications(pubs, f = {}) {
  const q = fold(f.q).trim();
  const terms = q ? q.split(/\s+/) : [];
  const authorSet = f.authors?.length ? new Set(f.authors.map(fold)) : null;
  const tagSet = f.tags?.length ? new Set(f.tags.map(fold)) : null;
  const keySet = f.keys?.length ? new Set(f.keys) : null;
  return pubs.filter((p) => {
    if (keySet && !keySet.has(p.key)) return false;
    if (f.year && String(p.year) !== String(f.year)) return false;
    if (f.type && p.type !== f.type) return false;
    if (f.tag && !p.tags.some((t) => fold(t) === fold(f.tag))) return false;
    if (f.author && !p.authors.some((a) => fold(displayName(a)) === fold(f.author))) return false;
    if (authorSet && !p.authors.some((a) => authorSet.has(fold(displayName(a))))) return false;
    if (tagSet && !p.tags.some((t) => tagSet.has(fold(t)))) return false;
    if (terms.length) {
      const hay = fold([p.title, p.authorText, p.text.booktitle, p.text.journal, p.year, p.key, p.tags.join(' ')].join(' '));
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

/** Values for the filter drop-downs, computed from a set of publications. */
export function facets(pubs) {
  const years = [...new Set(pubs.map((p) => p.year))].sort((a, b) => b - a);
  const types = Object.keys(TYPES).filter((t) => pubs.some((p) => p.type === t));
  const authorMap = new Map();
  for (const p of pubs) for (const a of p.authors) {
    const d = displayName(a);
    if (d && !authorMap.has(fold(d))) authorMap.set(fold(d), d);
  }
  const authors = [...authorMap.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  const tagCounts = new Map();
  for (const p of pubs) for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const tags = [...tagCounts.keys()].sort((a, b) => a.localeCompare(b));
  return { years, types, authors, tags, tagCounts };
}

// ---------------------------------------------------------------------------
// Rendering (teachPress-compatible markup and class names)
// ---------------------------------------------------------------------------

const span = (cls, value, before = '', after = ', ') =>
  value ? `<span class="tp_pub_additional_${cls}">${before}${escapeHtml(value)}${after}</span>` : '';

/** The "In: Booktitle, Address, 2024." line. */
export function renderMeta(p) {
  const t = p.text;
  const f = p.fields;
  const editorNames = p.editors.map(displayName).join('; ');
  const editor = editorNames ? `<span class="tp_pub_additional_editor">${escapeHtml(editorNames)} (Ed.): </span>` : '';
  const booktitle = span('booktitle', t.booktitle);
  const journal = span('journal', t.journal);
  const issuetitle = span('issuetitle', t.issuetitle);
  const volume = span('volume', latexToText(f.volume), 'vol. ');
  const number = span('number', latexToText(f.number), 'no. ');
  const pages = span('pages', latexToText(f.pages || '').replace(/\s*-+\s*/g, '–'), 'pp. ');
  const publisher = span('publisher', t.publisher);
  const address = span('address', t.address);
  const edition = span('edition', t.edition);
  const chapter = span('chapter', t.chapter, 'Chapter ');
  const institution = span('institution', t.institution);
  const organization = span('organization', t.organization, '', ' ');
  const school = span('school', t.school);
  const series = span('series', t.series);
  const howpublished = span('howpublished', t.howpublished);
  const techtype = span('techtype', t.techtype);
  const isbnValue = f.isbn || f.issn;
  const isbn = isbnValue ? `<span class="tp_pub_additional_isbn">${f.isbn ? 'ISBN' : 'ISSN'}: ${escapeHtml(isbnValue)}, </span>` : '';
  const note = t.note ? `<span class="tp_pub_additional_note">, (${escapeHtml(t.note)})</span>` : '';
  const year = p.pubstate === 'forthcoming'
    ? 'Forthcoming'
    : (p.year ? `<span class="tp_pub_additional_year">${p.year}</span>` : '');
  const inPrefix = ['article', 'inbook', 'incollection', 'inproceedings'].includes(p.type)
    ? '<span class="tp_pub_additional_in">In: </span>' : '';

  const tail = isbn + note;
  let parts;
  switch (p.type) {
    case 'article': parts = inPrefix + journal + volume + number + pages + year + tail; break;
    case 'book': parts = edition + publisher + address + year + tail; break;
    case 'booklet': parts = howpublished + address + edition + year + tail; break;
    case 'collection': parts = edition + publisher + address + year + tail; break;
    case 'conference':
    case 'workshop': parts = booktitle + volume + number + series + organization + publisher + address + year + tail; break;
    case 'inbook': parts = inPrefix + editor + booktitle + volume + number + chapter + pages + publisher + address + edition + year + tail; break;
    case 'incollection': parts = inPrefix + editor + booktitle + publisher + pages + address + year + tail; break;
    case 'inproceedings': parts = inPrefix + editor + booktitle + pages + organization + publisher + address + year + tail; break;
    case 'manual': parts = editor + address + edition + year + tail; break;
    case 'mastersthesis':
    case 'phdthesis': parts = school + year + tail; break;
    case 'misc':
    case 'unpublished': parts = howpublished + year + tail; break;
    case 'online': parts = editor + organization + year + note; break;
    case 'periodical': parts = issuetitle + series + volume + number + year + tail; break;
    case 'presentation': parts = howpublished + address + year + note; break;
    case 'proceedings': parts = howpublished + organization + publisher + address + volume + number + year + tail; break;
    case 'techreport': parts = institution + address + techtype + number + year + tail; break;
    default: parts = year + tail;
  }
  // Drop the dangling ", " separator when nothing follows it (no year).
  if (!year && !tail) {
    const at = parts.lastIndexOf(', </span>');
    if (at !== -1 && at === parts.length - 9) parts = parts.slice(0, at) + '</span>';
  }
  return `${parts}.`;
}

/** BibTeX as displayed in the "BibTeX" panel (empty fields omitted). */
export function bibtexFor(p) {
  const fields = {};
  for (const [k, v] of Object.entries(p.fields)) if (String(v ?? '').trim() !== '') fields[k] = v;
  return serializeEntry({ type: p.entryType || p.type, key: p.key, fields });
}

/**
 * Render a single publication.
 * @param {object} p publication from toPublication()
 * @param {object} o { showTags, tagHref(tag) => url, idPrefix }
 */
export function renderPublication(p, o = {}) {
  const id = `${o.idPrefix || 'tp'}-${p.key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const typeLabel = TYPES[p.type]?.[0] || p.type;
  const hasLinks = p.links.length > 0;
  const titleHtml = hasLinks
    ? `<button type="button" class="tp_title_link" data-tp-toggle="links" aria-controls="${id}-links" aria-expanded="false">${escapeHtml(p.title)}</button>`
    : escapeHtml(p.title);
  const status = p.pubstate && p.pubstate !== 'published'
    ? ` <span class="tp_pub_label_status ${escapeHtml(p.pubstate)}">${escapeHtml(PUBSTATES[p.pubstate] || p.pubstate)}</span>`
    : '';

  const menu = [];
  if (p.text.abstract) menu.push(toggle('abstract', 'Abstract', 'Show abstract'));
  if (hasLinks) menu.push(toggle('links', 'Links', 'Show links and resources'));
  menu.push(toggle('bibtex', 'BibTeX', 'Show BibTeX entry'));
  if (o.showTags && p.tags.length) {
    const tagLinks = p.tags.map((t) =>
      `<a rel="nofollow" href="${escapeHtml(o.tagHref ? o.tagHref(t) : `?tag=${encodeURIComponent(t)}`)}" title="Show all publications which have a relationship to this tag">${escapeHtml(t)}</a>`);
    menu.push(`<span class="tp_pub_tags_label">Tags: </span>${tagLinks.join(', ')}`);
  }

  const close = (panel) =>
    `<p class="tp_close_menu"><button type="button" class="tp_close" data-tp-toggle="${panel}">Close</button></p>`;

  const abstractPanel = p.text.abstract
    ? `<div class="tp_abstract" id="${id}-abstract" hidden><div class="tp_abstract_entry">${escapeHtml(p.text.abstract).replace(/\n/g, '<br>')}</div>${close('abstract')}</div>`
    : '';
  const linksPanel = hasLinks
    ? `<div class="tp_links" id="${id}-links" hidden><div class="tp_links_entry"><ul class="tp_pub_list">${p.links.map((l) =>
      `<li><i class="${l.icon}" aria-hidden="true"></i><a class="tp_pub_list" href="${escapeHtml(l.url)}" title="${escapeHtml(l.title || l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a></li>`).join('')}</ul></div>${close('links')}</div>`
    : '';
  const bibtexPanel = `<div class="tp_bibtex" id="${id}-bibtex" hidden><div class="tp_bibtex_entry"><pre>${escapeHtml(bibtexFor(p))}</pre></div>${close('bibtex')}</div>`;

  const image = p.image && o.showImages
    ? `<div class="tp_pub_image"><img src="${escapeHtml(p.image)}" alt="" loading="lazy"></div>` : '';

  return `<div class="tp_publication tp_publication_${p.type}" id="${id}" data-key="${escapeHtml(p.key)}">${image}<div class="tp_pub_info">`
    + `<p class="tp_pub_author">${escapeHtml(p.authorText)}</p>`
    + `<p class="tp_pub_title">${titleHtml} <span class="tp_pub_type tp_ ${p.type}">${escapeHtml(typeLabel)}</span>${status}</p>`
    + `<p class="tp_pub_additional">${renderMeta(p)}</p>`
    + `<p class="tp_pub_menu">${menu.join(' | ')}</p>`
    + bibtexPanel + abstractPanel + linksPanel
    + '</div></div>';

  function toggle(panel, label, title) {
    return `<span class="tp_${panel}_link"><button type="button" class="tp_show" data-tp-toggle="${panel}" aria-controls="${id}-${panel}" aria-expanded="false" title="${title}">${label}</button></span>`;
  }
}

/** Render a list grouped by year headings. */
export function renderPublicationList(pubs, o = {}) {
  if (!pubs.length) {
    return `<div class="teachpress_publication_list tp_empty"><p>${escapeHtml(o.emptyText || 'Sorry, no publications matched your criteria.')}</p></div>`;
  }
  let html = '<div class="teachpress_publication_list">';
  let currentYear = null;
  for (const p of pubs) {
    if (o.groupByYear !== false && p.year !== currentYear) {
      currentYear = p.year;
      html += `<h3 class="tp_h3" id="tp_h3_${p.year}">${p.year || 'Undated'}</h3>`;
    }
    html += renderPublication(p, o);
  }
  return html + '</div>';
}

/** Build the publication array from parsed BibTeX entries. */
export function publicationsFromEntries(entries) {
  return sortPublications(entries.map((e, i) => toPublication(e, i)));
}
