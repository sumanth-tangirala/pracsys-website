/**
 * Publication model, filtering and HTML rendering.
 *
 * Shared by the Eleventy build (pre-rendered, no-JS lists) and the browser
 * (interactive lists and the admin preview), so the markup is identical in
 * both places. Plain ES module, no imports besides the BibTeX helpers.
 */
import { latexToText, serializeEntry, decodeEntities } from './bibtex.js';

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

/** Fields converted to display text once, in toPublication(). */
const TEXT_FIELDS = ['title', 'booktitle', 'journal', 'publisher', 'address', 'organization', 'school', 'institution', 'series', 'howpublished', 'note', 'edition', 'chapter', 'issuetitle', 'techtype', 'abstract'];

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Split a BibTeX name list on top-level " and " (any case, any whitespace). */
export function splitNames(value) {
  const s = squash(value);
  if (!s) return [];
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === ' ' && /^ and /i.test(s.slice(i, i + 5))) {
      out.push(s.slice(start, i));
      i += 4;
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Split on a separator character that is not inside braces. */
function splitTopLevel(s, test) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && test(c)) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

/** BibTeX's "von" test: the first letter at brace depth 0 is lower case. */
function isLowerToken(token) {
  if (/^\{\\/.test(token)) return /^\p{Ll}/u.test(latexToText(token));
  let depth = 0;
  for (const c of token) {
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && /\p{L}/u.test(c)) return c !== c.toUpperCase();
  }
  return false;
}

/**
 * Parse one name into {first, last} (plus `jr` when given). Accepts
 * "Last, First", "von Last, Jr, First", "First von Last" and braced groups
 * such as "{Van den Berg}, Jur".
 */
export function parseName(raw) {
  const name = squash(raw);
  const commas = splitTopLevel(name, (c) => c === ',').map((x) => x.trim());
  if (commas.length >= 2) {
    const last = commas[0];
    const jr = commas.length >= 3 ? commas[1] : '';
    const first = (commas.length >= 3 ? commas.slice(2) : commas.slice(1)).filter(Boolean).join(', ');
    return withJr({ first: latexToText(first).trim(), last: latexToText(last).trim() }, latexToText(jr).trim());
  }
  const tokens = splitTopLevel(name, (c) => c === ' ').filter(Boolean);
  if (tokens.length <= 1) return { first: '', last: latexToText(tokens[0] ?? '').trim() };
  // "First von Last": von starts at the first lower-case word (never the last word).
  let split = tokens.length - 1;
  for (let k = 0; k < tokens.length - 1; k++) {
    if (isLowerToken(tokens[k])) { split = k; break; }
  }
  return {
    first: latexToText(tokens.slice(0, split).join(' ')).trim(),
    last: latexToText(tokens.slice(split).join(' ')).trim(),
  };
}

function withJr(person, jr) {
  return jr ? { ...person, jr } : person;
}

/** teachPress display style: "Last, First". */
export function displayName(person) {
  const last = person.jr ? `${person.last} ${person.jr}` : person.last;
  return person.first ? `${last}, ${person.first}` : last;
}

const isOthers = (raw) => /^others$/i.test(String(raw).trim());

/** Loose identity of a person: folded last name + first initial. */
function personMatchKey(person) {
  const last = fold(person.last).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const initial = (fold(person.first).match(/[\p{L}\p{N}]/u) || [''])[0];
  return { last, initial };
}

/**
 * Build a predicate matching people leniently: same last name and same first
 * initial, so "Bekris, K" matches "Bekris, Kostas E." and "K. E. Bekris".
 * A name without a first name matches on the last name alone.
 */
export function authorMatcher(names) {
  const wanted = (Array.isArray(names) ? names : [names])
    .filter((x) => String(x ?? '').trim())
    .map((x) => personMatchKey(parseName(x)));
  return (person) => {
    const k = personMatchKey(person);
    return wanted.some((w) => w.last === k.last && (!w.initial || w.initial === k.initial));
  };
}

// ---------------------------------------------------------------------------
// Links and tags
// ---------------------------------------------------------------------------

/**
 * Return `url` if it is safe to put in href/src (http, https, mailto, ftp or
 * a relative URL), otherwise ''. Blocks javascript:, data:, vbscript: etc.,
 * including variants obfuscated with whitespace or control characters.
 */
export function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (!u) return '';
  const probe = decodeEntities(u).replace(/[\x00-\x20\x7f-\x9f]+/g, '');
  const scheme = /^([^/?#]*?):/.exec(probe);
  if (scheme && !/^(?:https?|mailto|ftps?)$/i.test(scheme[1])) return '';
  return u;
}

/** Undo BibTeX escaping and teachPress' HTML escaping in a URL. */
function cleanUrl(raw) {
  let u = String(raw).trim().replace(/^\\url\s*\{(.*)\}$/, '$1');
  u = u.replace(/\\([&%_#~$])/g, '$1');
  return decodeEntities(u).trim();
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
      const url = safeUrl(cleanUrl(m[1]));
      if (!url) return;
      const label = m[2] ? squash(latexToText(m[2])) : '';
      links.push({ url, label: label || url, icon: linkIcon(url) });
    });
  if (doi) {
    const d = cleanUrl(doi).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').trim();
    if (d) {
      let path;
      try {
        path = encodeURI(d).replace(/#/g, '%23').replace(/\?/g, '%3F');
      } catch {
        path = encodeURIComponent(d.replace(/[\ud800-\udfff]/g, ''));
      }
      links.push({ url: `https://dx.doi.org/${path}`, label: `doi:${d}`, title: `Follow DOI:${d}`, icon: 'ai ai-doi' });
    }
  }
  return links;
}

export function linkIcon(url) {
  const u = String(url ?? '').toLowerCase();
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
    .map((t) => squash(latexToText(t)))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** Abstract text: single line breaks (PDF copy-paste) become spaces, blank lines stay paragraphs. */
function abstractText(value) {
  return latexToText(value)
    .split(/\n[ \t]*\n\s*/)
    .map(squash)
    .filter(Boolean)
    .join('\n\n');
}

function parseYear(...candidates) {
  for (const c of candidates) {
    const m = /\d{4}/.exec(String(c ?? ''));
    if (m) return Number(m[0]);
  }
  return 0;
}

/**
 * Normalise a parsed BibTeX entry into the object the renderer works with.
 * @param {{type: string, key: string, fields: object}} entry
 * @param {number} order position in the source file (stable tie-breaker)
 */
export function toPublication(entry, order = 0) {
  const f = entry.fields || {};
  const type = String(f.tppubtype || entry.type || 'misc').trim().toLowerCase();
  const names = splitNames(f.author);
  const etAl = names.some(isOthers);
  const authors = names.filter((n) => !isOthers(n)).map(parseName);
  const editors = splitNames(f.editor).filter((n) => !isOthers(n)).map(parseName);
  const year = parseYear(f.year, f.date);
  const dm = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:$|[T\s])/.exec(String(f.date || '').trim());
  const date = dm
    ? `${dm[1]}-${(dm[2] || '1').padStart(2, '0')}-${(dm[3] || '1').padStart(2, '0')}`
    : `${String(year || 0).padStart(4, '0')}-01-01`;
  const text = {};
  for (const k of TEXT_FIELDS) {
    if (!f[k]) continue;
    const v = k === 'abstract' ? abstractText(f[k]) : squash(latexToText(f[k]));
    if (v) text[k] = v;
  }
  const pubstate = String(f.pubstate || 'published').split(',')[0].toLowerCase().replace(/\s+/g, '') || 'published';
  const forthcoming = pubstate === 'forthcoming';
  let authorText = authors.map(displayName).join('; ');
  if (etAl) authorText += authorText ? '; et al.' : 'et al.';
  if (!authorText && editors.length) authorText = `${editors.map(displayName).join('; ')} (Ed.)`;
  return {
    key: entry.key,
    type: own(TYPES, type) ? type : 'misc',
    entryType: entry.type,
    fields: { ...f },
    order,
    year,
    date,
    /** Year heading: the year, or "Forthcoming"/"Undated" when there is none. */
    heading: year ? String(year) : (forthcoming ? 'Forthcoming' : 'Undated'),
    authors,
    editors,
    authorText,
    title: text.title || '(untitled)',
    text,
    pubstate,
    tags: parseTags(f.keywords),
    links: parseLinks(f.url, f.doi),
    image: f.image ? safeUrl(cleanUrl(f.image)) : '',
  };
}

/** Undated forthcoming papers first, then by year, date and file order; other undated papers last. */
function rank(p) {
  if (p.year) return 1;
  return p.pubstate === 'forthcoming' ? 2 : 0;
}

/**
 * Newest first. Sorting by year before date keeps every year in one group
 * even when an entry's date falls in a different year.
 */
export function sortPublications(pubs) {
  return [...pubs].sort((a, b) =>
    rank(b) - rank(a)
    || (b.year || 0) - (a.year || 0)
    || String(b.date || '').localeCompare(String(a.date || ''))
    || (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Filter publications.
 * @param {Array} pubs
 * @param {object} f  { year, type, author, tag, q, authors: [..], tags: [..], keys: [..] }
 *   - author: a name such as "Bekris, K"; matches the same last name and
 *     first initial ("Bekris, Kostas E." too)
 *   - authors: list of names, match any (used by member pages)
 *   - tags: list of tags, match any (used by project pages)
 */
export function filterPublications(pubs, f) {
  f = f || {};
  const q = fold(f.q).trim();
  const terms = q ? q.split(/\s+/) : [];
  const author = String(f.author ?? '').trim() ? authorMatcher(f.author) : null;
  const authorsMatch = f.authors?.length ? authorMatcher(f.authors) : null;
  const tagSet = f.tags?.length ? new Set(f.tags.map(fold)) : null;
  const keySet = f.keys?.length ? new Set(f.keys) : null;
  const year = f.year === undefined || f.year === null ? '' : String(f.year).trim();
  return pubs.filter((p) => {
    if (keySet && !keySet.has(p.key)) return false;
    if (year && String(p.year) !== year) return false;
    if (f.type && p.type !== f.type) return false;
    if (f.tag && !p.tags.some((t) => fold(t) === fold(f.tag))) return false;
    if (author && !p.authors.some(author)) return false;
    if (authorsMatch && !p.authors.some(authorsMatch)) return false;
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

/**
 * The "In: Booktitle, Address, 2024." line.
 *
 * Built from segments so a separator is only written when something follows
 * it: missing fields never leave ", ." or doubled separators behind. Like
 * teachPress, each separator sits inside the span of the field before it,
 * while ISBN/ISSN and notes carry their own leading ", ".
 */
export function renderMeta(p) {
  const t = p.text || {};
  const f = p.fields || {};
  const seg = (cls, value, before = '', after = ', ') => {
    const v = squash(value);
    return v ? { cls, html: before + escapeHtml(v), after } : null;
  };
  const editorNames = (p.editors || []).map(displayName).join('; ');
  const editor = editorNames ? { cls: 'editor', html: `${escapeHtml(editorNames)} (Ed.)`, after: ': ' } : null;
  const booktitle = seg('booktitle', t.booktitle);
  const journal = seg('journal', t.journal);
  const issuetitle = seg('issuetitle', t.issuetitle);
  const volume = seg('volume', latexToText(f.volume), 'vol. ');
  const number = seg('number', latexToText(f.number), 'no. ');
  const pages = seg('pages', latexToText(f.pages).replace(/\s*(?:-+|–|—)\s*/g, '–'), 'pp. ');
  const publisher = seg('publisher', t.publisher);
  const address = seg('address', t.address);
  const edition = seg('edition', t.edition);
  const chapter = seg('chapter', t.chapter, 'Chapter ');
  const institution = seg('institution', t.institution);
  const organization = seg('organization', t.organization, '', ' ');
  const school = seg('school', t.school);
  const series = seg('series', t.series);
  const howpublished = seg('howpublished', t.howpublished);
  const techtype = seg('techtype', t.techtype);
  const isbnValue = squash(f.isbn || f.issn);
  const isbn = isbnValue ? { cls: 'isbn', html: `${f.isbn ? 'ISBN' : 'ISSN'}: ${escapeHtml(isbnValue)}`, lead: ', ' } : null;
  const note = t.note ? { cls: 'note', html: `(${escapeHtml(t.note)})`, lead: ', ' } : null;
  const year = p.pubstate === 'forthcoming'
    ? { cls: null, html: 'Forthcoming' }
    : (p.year ? { cls: 'year', html: String(p.year) } : null);

  let parts;
  switch (p.type) {
    case 'article': parts = [journal, volume, number, pages, year, isbn, note]; break;
    case 'book': parts = [edition, publisher, address, year, isbn, note]; break;
    case 'booklet': parts = [howpublished, address, edition, year, isbn, note]; break;
    case 'collection': parts = [edition, publisher, address, year, isbn, note]; break;
    case 'conference':
    case 'workshop': parts = [booktitle, volume, number, series, organization, publisher, address, year, isbn, note]; break;
    case 'inbook': parts = [editor, booktitle, volume, number, chapter, pages, publisher, address, edition, year, isbn, note]; break;
    case 'incollection': parts = [editor, booktitle, publisher, pages, address, year, isbn, note]; break;
    case 'inproceedings': parts = [editor, booktitle, pages, organization, publisher, address, year, isbn, note]; break;
    case 'manual': parts = [editor, address, edition, year, isbn, note]; break;
    case 'mastersthesis':
    case 'phdthesis': parts = [school, year, isbn, note]; break;
    case 'misc':
    case 'unpublished': parts = [howpublished, year, isbn, note]; break;
    case 'online': parts = [editor, organization, year, note]; break;
    case 'patent': parts = [number, address, year, note]; break;
    case 'periodical': parts = [issuetitle, series, volume, number, year, isbn, note]; break;
    case 'presentation': parts = [howpublished, address, year, note]; break;
    case 'proceedings': parts = [howpublished, organization, publisher, address, volume, number, year, isbn, note]; break;
    case 'techreport': parts = [institution, address, techtype, number, year, isbn, note]; break;
    default: parts = [year, isbn, note];
  }
  const segs = parts.filter(Boolean);
  if (!segs.length) return '';
  let out = ['article', 'inbook', 'incollection', 'inproceedings'].includes(p.type)
    ? '<span class="tp_pub_additional_in">In: </span>' : '';
  segs.forEach((s, i) => {
    const next = segs[i + 1];
    const body = (i > 0 && s.lead ? s.lead : '') + s.html + (next && !next.lead ? s.after ?? ', ' : '');
    out += s.cls ? `<span class="tp_pub_additional_${s.cls}">${body}</span>` : body;
  });
  // "Washington, D.C." already ends the sentence.
  return /\.(<\/span>)?$/.test(out) ? out : `${out}.`;
}

/** BibTeX as displayed in the "BibTeX" panel (empty fields omitted). */
export function bibtexFor(p) {
  const fields = {};
  for (const [k, v] of Object.entries(p.fields)) if (String(v ?? '').trim() !== '') fields[k] = v;
  return serializeEntry({ type: p.entryType || p.type, key: p.key, fields });
}

function hash36(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * A valid, unique element id for a publication. Keys made only of letters,
 * digits, "_" and "-" are used as they are; any other key (spaces, ":", "/"…)
 * is sanitised and suffixed with a hash of the original so that, say,
 * "a:b" and "a/b" never collide.
 */
export function publicationDomId(key, prefix = 'tp') {
  const k = String(key ?? '');
  const safe = k.replace(/[^A-Za-z0-9_-]/g, '_');
  const pre = String(prefix || 'tp').replace(/[^A-Za-z0-9_-]/g, '_');
  return `${pre}-${safe && safe === k ? safe : `${safe}-${hash36(k)}`}`;
}

const PANEL_NAMES = { abstract: 'abstract', links: 'links', bibtex: 'BibTeX' };

/**
 * Render a single publication.
 * @param {object} p publication from toPublication()
 * @param {object} o { showTags, tagHref(tag) => url, idPrefix, showImages }
 */
export function renderPublication(p, o = {}) {
  const id = publicationDomId(p.key, o.idPrefix);
  const typeLabel = own(TYPES, p.type) ? TYPES[p.type][0] : p.type;
  const links = (p.links || []).filter((l) => safeUrl(l.url));
  const hasLinks = links.length > 0;
  const titleHtml = hasLinks
    ? `<button type="button" class="tp_title_link" data-tp-toggle="links" aria-controls="${id}-links" aria-expanded="false">${escapeHtml(p.title)}</button>`
    : escapeHtml(p.title);
  const status = p.pubstate && p.pubstate !== 'published'
    ? ` <span class="tp_pub_label_status ${escapeHtml(p.pubstate)}">${escapeHtml(own(PUBSTATES, p.pubstate) ? PUBSTATES[p.pubstate] : p.pubstate)}</span>`
    : '';

  const menu = [];
  if (p.text.abstract) menu.push(toggle('abstract', 'Abstract', 'Show abstract'));
  if (hasLinks) menu.push(toggle('links', 'Links', 'Show links and resources'));
  menu.push(toggle('bibtex', 'BibTeX', 'Show BibTeX entry'));
  if (o.showTags && p.tags.length) {
    const tagLinks = p.tags.map((t) => {
      const href = safeUrl(o.tagHref ? o.tagHref(t) : `?tag=${encodeURIComponent(t)}`) || '#';
      return `<a rel="nofollow" href="${escapeHtml(href)}" title="Show all publications which have a relationship to this tag">${escapeHtml(t)}</a>`;
    });
    menu.push(`<span class="tp_pub_tags_label">Tags: </span>${tagLinks.join(', ')}`);
  }

  const close = (panel) =>
    `<p class="tp_close_menu"><button type="button" class="tp_close" data-tp-toggle="${panel}" aria-label="Close ${PANEL_NAMES[panel]}">Close</button></p>`;

  const abstractPanel = p.text.abstract
    ? `<div class="tp_abstract" id="${id}-abstract" hidden><div class="tp_abstract_entry">${escapeHtml(p.text.abstract).replace(/\n\n/g, '<br><br>').replace(/\n/g, ' ')}</div>${close('abstract')}</div>`
    : '';
  const linksPanel = hasLinks
    ? `<div class="tp_links" id="${id}-links" hidden><div class="tp_links_entry"><ul class="tp_pub_list">${links.map((l) =>
      `<li><i class="${escapeHtml(l.icon)}" aria-hidden="true"></i><a class="tp_pub_list" href="${escapeHtml(l.url)}" title="${escapeHtml(l.title || l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a></li>`).join('')}</ul></div>${close('links')}</div>`
    : '';
  const bibtexPanel = `<div class="tp_bibtex" id="${id}-bibtex" hidden><div class="tp_bibtex_entry"><pre>${escapeHtml(bibtexFor(p))}</pre></div>${close('bibtex')}</div>`;

  const imageUrl = o.showImages ? safeUrl(p.image) : '';
  const image = imageUrl
    ? `<div class="tp_pub_image"><img src="${escapeHtml(imageUrl)}" alt="" loading="lazy"></div>` : '';

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

/**
 * Render a list grouped by year headings.
 * @param {Array} pubs sorted publications
 * @param {object} o renderPublication options plus { groupByYear, emptyText,
 *   headingLevel (2–6, default 3) }
 */
export function renderPublicationList(pubs, o = {}) {
  if (!pubs.length) {
    return `<div class="teachpress_publication_list tp_empty"><p>${escapeHtml(o.emptyText || 'Sorry, no publications matched your criteria.')}</p></div>`;
  }
  const level = Math.min(6, Math.max(2, Number(o.headingLevel) || 3));
  const prefix = String(o.idPrefix || 'tp').replace(/[^A-Za-z0-9_-]/g, '_');
  const idBase = prefix === 'tp' ? 'tp_h3_' : `${prefix}_tp_h3_`;
  const used = new Set();
  let html = '<div class="teachpress_publication_list">';
  let current = null;
  for (const p of pubs) {
    const heading = p.heading || (p.year ? String(p.year) : 'Undated');
    if (o.groupByYear !== false && heading !== current) {
      current = heading;
      const slug = heading.toLowerCase();
      let hid = idBase + slug;
      for (let k = 2; used.has(hid); k++) hid = `${idBase}${slug}-${k}`;
      used.add(hid);
      html += `<h${level} class="tp_h3" id="${hid}">${escapeHtml(heading)}</h${level}>`;
    }
    html += renderPublication(p, o);
  }
  return html + '</div>';
}

/**
 * renderPublicationList() options for a {% publist %} configuration. Used by
 * the build and by publist.js so the pre-rendered and the client-rendered
 * markup are identical.
 * @param {object} config the shortcode options (idPrefix, showTags, emptyText, headingLevel)
 * @param {string} base path prefix without trailing slash ("" at build time,
 *   where Eleventy's base plugin adds it to every root-relative URL)
 */
export function publistRenderOptions(config = {}, base = '') {
  return {
    showTags: !!config.showTags,
    tagHref: (t) => `${base}/papers/?tag=${encodeURIComponent(t)}`,
    idPrefix: config.idPrefix || 'tp',
    emptyText: config.emptyText,
    headingLevel: config.headingLevel || 3,
  };
}

/** Build the publication array from parsed BibTeX entries. */
export function publicationsFromEntries(entries) {
  return sortPublications(entries.map((e, i) => toPublication(e, i)));
}
