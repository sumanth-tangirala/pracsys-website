/** Admin-side helpers: field metadata, validation, data checks. */
import { TYPES, TYPE_FIELDS, PUBSTATES, filterPublications, splitNames, parseName, displayName, toPublication } from '../lib/publications.js';
import { latexToText } from '../lib/bibtex.js';

export const FIELD_LABELS = {
  title: 'Title',
  author: 'Authors',
  editor: 'Editors',
  booktitle: 'Conference / book title',
  journal: 'Journal',
  volume: 'Volume',
  number: 'Number / issue',
  pages: 'Pages',
  publisher: 'Publisher',
  address: 'Location',
  organization: 'Organization',
  school: 'School / university',
  institution: 'Institution',
  series: 'Series',
  edition: 'Edition',
  chapter: 'Chapter',
  howpublished: 'How published',
  techtype: 'Report type',
  issuetitle: 'Issue title',
  isbn: 'ISBN',
  issn: 'ISSN',
  doi: 'DOI',
  note: 'Note',
  year: 'Year',
  date: 'Date',
  pubstate: 'Status',
  keywords: 'Tags',
  abstract: 'Abstract',
  url: 'Links',
  crossref: 'Crossref',
  image: 'Image URL',
  annote: 'Private note',
  tppubtype: 'teachPress type',
};

export const FIELD_HELP = {
  booktitle: 'e.g. IEEE International Conference on Robotics and Automation (ICRA)',
  address: 'City, country — shown after the venue',
  note: 'Shown in parentheses after the year, e.g. Best Paper Award Finalist',
  pages: 'e.g. 1236--1241',
  doi: 'Just the DOI, e.g. 10.1109/ICRA.2012.6224582',
};

export const EXTRA_FIELDS = ['note', 'crossref', 'image', 'annote'];

export function venueFields(type) {
  const t = TYPE_FIELDS[type] || TYPE_FIELDS.misc;
  const order = ['journal', 'booktitle', 'school', 'institution', 'howpublished', 'issuetitle', 'address', 'volume', 'number', 'pages',
    'chapter', 'edition', 'series', 'publisher', 'organization', 'techtype', 'editor', 'isbn', 'issn'];
  const wanted = new Set([...t.required, ...t.optional].filter((f) => !['author', 'title', 'year', 'doi'].includes(f)));
  return order.filter((f) => wanted.has(f));
}

export function requiredFields(type) {
  return new Set((TYPE_FIELDS[type] || TYPE_FIELDS.misc).required);
}

export const KEY_PATTERN = /^[A-Za-z0-9_:\-.+\/]+$/;

/** Suggest a citation key like "tangirala2025kinodynamic". */
export function suggestKey(fields, existingKeys) {
  const first = splitNames(fields.author || fields.editor || '')[0];
  const last = first ? parseName(first).last : 'anon';
  const word = latexToText(fields.title || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .find((w) => w.length > 3 && !['with', 'from', 'over', 'into', 'using', 'towards', 'toward', 'via', 'under', 'that', 'this', 'learning'].includes(w)) || 'paper';
  const base = `${last.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '') || 'anon'}${fields.year || ''}${word}`;
  let key = base;
  let i = 2;
  while (existingKeys.has(key)) key = `${base}${i++}`;
  return key;
}

/**
 * Validate an entry being edited.
 * @returns {{errors: Array<{field, message}>, warnings: Array<{field, message}>}}
 */
export function validateEntry(entry, { existingKeys, originalKey, knownAuthors, knownTitles }) {
  const errors = [];
  const warnings = [];
  const f = entry.fields;
  const key = String(entry.key || '').trim();
  if (!TYPES[entry.type]) errors.push({ field: 'type', message: 'Choose a publication type.' });
  if (!key) errors.push({ field: 'key', message: 'A citation key is required.' });
  else if (!KEY_PATTERN.test(key)) errors.push({ field: 'key', message: 'Use only letters, numbers and _ - : . + / in the citation key (no spaces).' });
  else if (key !== originalKey && existingKeys.has(key)) errors.push({ field: 'key', message: `Another publication already uses the key “${key}”.` });
  if (!String(f.title || '').trim()) errors.push({ field: 'title', message: 'A title is required.' });
  else if (knownTitles) {
    const other = knownTitles.get(normalizeTitle(f.title));
    if (other && other !== originalKey) warnings.push({ field: 'title', message: `“${other}” has the same title. Is this a duplicate?` });
  }
  const year = String(f.year || '').trim();
  if (!year && f.pubstate !== 'forthcoming') errors.push({ field: 'year', message: 'A year is required (or set the status to Forthcoming).' });
  else if (year && !/^\d{4}$/.test(year)) errors.push({ field: 'year', message: 'Use a four-digit year, e.g. 2026.' });
  const date = String(f.date || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push({ field: 'date', message: 'Use the format YYYY-MM-DD.' });
  else if (date && year && !date.startsWith(year)) warnings.push({ field: 'date', message: `The date (${date}) is not in ${year}. The list is sorted by date.` });

  for (const r of requiredFields(entry.type)) {
    if (['title', 'year', 'author'].includes(r)) continue;
    if (!String(f[r] || '').trim()) warnings.push({ field: r, message: `${FIELD_LABELS[r] || r} is usually given for this type.` });
  }
  const authors = splitNames(f.author);
  if (!authors.length && requiredFields(entry.type).has('author')) errors.push({ field: 'author', message: 'Add at least one author.' });
  if (knownAuthors) {
    for (const s of authorSuggestions(authors, knownAuthors)) {
      warnings.push({ field: 'author', message: `“${s.raw}” is written ${s.known.map((k) => `“${k}”`).join(' or ')} on other papers. Use the same spelling so author filters and member pages stay accurate.`, fix: s });
    }
  }
  for (const line of String(f.url || '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (!/^https?:\/\//i.test(line)) warnings.push({ field: 'url', message: `“${line.slice(0, 60)}” does not start with http:// or https://.` });
  }
  if (f.doi && /^https?:/i.test(f.doi)) warnings.push({ field: 'doi', message: 'Enter only the DOI (e.g. 10.1109/…), not the full link.' });
  if (!String(f.keywords || '').trim()) warnings.push({ field: 'keywords', message: 'Without tags this paper will not appear on any project page.' });
  if (!String(f.abstract || '').trim()) warnings.push({ field: 'abstract', message: 'No abstract: the “Abstract” toggle will be hidden.' });
  return { errors, warnings };
}

/** Where on the public site a publication will be listed. */
export function appearsOn(entry, config) {
  const pub = toPublication(entry);
  const pages = [{ label: 'Papers', href: 'papers/' }];
  for (const p of config.projects) {
    if (filterPublications([pub], p.filter).length) pages.push({ label: `${p.title} project`, href: `projects/${p.slug}/` });
  }
  for (const m of config.members) {
    if (m.showPublications && m.authors?.length && filterPublications([pub], { authors: m.authors }).length) {
      pages.push({ label: `${m.name}'s page`, href: `members/${m.slug}/` });
    }
  }
  return pages;
}

/** Whole-library checks shown on the dashboard. */
export function dataIssues(entries) {
  const issues = [];
  const titles = new Map();
  for (const e of entries) {
    const f = e.fields;
    const label = String(f.title || e.key).slice(0, 90);
    if (!/^\d{4}$/.test(String(f.year || '').trim()) && f.pubstate !== 'forthcoming') issues.push({ key: e.key, label, message: 'Missing year — listed under “Undated”.' });
    const state = String(f.pubstate || 'published').toLowerCase();
    if (!PUBSTATES[state.replace(/\s+/g, '')]) issues.push({ key: e.key, label, message: `Unusual status “${f.pubstate}”.` });
    if (/\s/.test(e.key)) issues.push({ key: e.key, label, message: 'Citation key contains spaces.' });
    if (!String(f.keywords || '').trim()) issues.push({ key: e.key, label, message: 'No tags — not shown on any project page.' });
    const norm = String(f.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (norm) {
      if (titles.has(norm)) issues.push({ key: e.key, label, message: `Same title as “${titles.get(norm)}” — possible duplicate.` });
      else titles.set(norm, e.key);
    }
  }
  return issues;
}

/** Lower-case, accent- and punctuation-free title used to spot duplicates. */
export function normalizeTitle(title) {
  return latexToText(title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Map of normalised title → key for spotting duplicates. */
export function titleIndex(entries) {
  const m = new Map();
  for (const e of entries) {
    const t = normalizeTitle(e.fields.title);
    if (t && !m.has(t)) m.set(t, e.key);
  }
  return m;
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const PARTICLES = /^(von|van|der|den|de|del|della|di|da|du|la|le|dos|das|ter|ten|zu)$/;

/** Split a name on top-level whitespace (braced groups stay together). */
function nameTokens(name) {
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
  return tokens;
}

/** {first, last} keeping the raw BibTeX text, with "van der" particles in the last name. */
function splitRawName(raw) {
  const name = String(raw).trim();
  if (name.includes(',')) {
    const [last, ...rest] = name.split(',');
    return { first: rest.join(',').trim(), last: last.trim() };
  }
  const tokens = nameTokens(name);
  if (tokens.length < 2) return { first: '', last: name };
  let i = tokens.length - 1;
  while (i > 1 && PARTICLES.test(tokens[i - 1])) i--;
  return { first: tokens.slice(0, i).join(' '), last: tokens.slice(i).join(' ') };
}

/**
 * Lab style for an author name: first initial + last name
 * ("Kostas E. Bekris" or "Bekris, Kostas" → "K Bekris"). When another paper
 * already spells this person with the same last name and initial (e.g.
 * "N V Navkar") that spelling wins. Braced names ("{PRACSYS Lab}") and
 * "others" are left alone.
 */
export function labStyleName(raw, knownAuthors) {
  const name = String(raw || '').trim();
  if (!name || /^\{.*\}$/.test(name) || /^others$/i.test(name)) return name;
  const { first, last } = splitRawName(name);
  const initial = latexToText(first).match(/\p{L}/u)?.[0]?.toUpperCase();
  if (!initial || !last) return name;
  if (knownAuthors) {
    const lastText = fold(latexToText(last).replace(/[{}]/g, ''));
    const same = [...knownAuthors].filter((k) => {
      const [kl, kf = ''] = k.split(', ');
      return fold(kl) === lastText && fold(kf).startsWith(fold(initial));
    });
    if (same.length === 1) {
      const [kl, kf = ''] = same[0].split(', ');
      return kf ? `${kf} ${kl}` : kl;
    }
  }
  return `${initial} ${last}`;
}

/** Rewrite a BibTeX name list ("A and B") in lab style. */
export function labStyleNames(value, knownAuthors) {
  return splitNames(value).map((n) => labStyleName(n, knownAuthors)).join(' and ');
}

/**
 * Authors whose last name matches a known author but are written differently.
 * Each result: { raw, index, known: [display names], suggestion: "K Bekris" | null }.
 */
export function authorSuggestions(names, knownAuthors) {
  const out = [];
  names.forEach((raw, index) => {
    const p = parseName(raw);
    if (!p.last || knownAuthors.has(displayName(p))) return;
    const known = [...knownAuthors].filter((k) => fold(k.split(', ')[0]) === fold(p.last));
    if (!known.length) return;
    const lab = labStyleName(raw, knownAuthors);
    const labDisplay = displayName(parseName(lab));
    out.push({ raw, index, known, suggestion: lab !== raw && knownAuthors.has(labDisplay) ? lab : null });
  });
  return out;
}

/** Keys of all known author display names in a publication list. */
export function knownAuthorSet(pubs) {
  const s = new Set();
  for (const p of pubs) for (const a of p.authors) s.add(displayName(a));
  return s;
}
