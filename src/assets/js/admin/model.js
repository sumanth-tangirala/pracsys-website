/** Admin-side helpers: field metadata, validation, data checks. */
import { TYPES, TYPE_FIELDS, PUBSTATES, filterPublications, splitNames, parseName, displayName, toPublication } from '../lib/publications.js';

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

/** Fields the editor renders explicitly (everything else goes to "Other fields"). */
export const MANAGED_FIELDS = new Set(['title', 'author', 'editor', 'year', 'date', 'pubstate', 'keywords', 'abstract', 'url', 'doi', 'tppubtype',
  'booktitle', 'journal', 'volume', 'number', 'pages', 'publisher', 'address', 'organization', 'school', 'institution', 'series', 'edition',
  'chapter', 'howpublished', 'techtype', 'issuetitle', 'isbn', 'issn', 'note']);

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
  const word = String(fields.title || '')
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
export function validateEntry(entry, { existingKeys, originalKey, knownAuthors }) {
  const errors = [];
  const warnings = [];
  const f = entry.fields;
  const key = String(entry.key || '').trim();
  if (!TYPES[entry.type]) errors.push({ field: 'type', message: 'Choose a publication type.' });
  if (!key) errors.push({ field: 'key', message: 'A citation key is required.' });
  else if (!KEY_PATTERN.test(key)) errors.push({ field: 'key', message: 'Use only letters, numbers and _ - : . + / in the citation key (no spaces).' });
  else if (key !== originalKey && existingKeys.has(key)) errors.push({ field: 'key', message: `Another publication already uses the key “${key}”.` });
  if (!String(f.title || '').trim()) errors.push({ field: 'title', message: 'A title is required.' });
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
    for (const raw of authors) {
      const p = parseName(raw);
      const d = displayName(p);
      if (knownAuthors.has(d)) continue;
      const sameLast = [...knownAuthors].filter((k) => k.split(', ')[0] === p.last);
      if (sameLast.length) {
        warnings.push({ field: 'author', message: `“${raw}” is listed as ${sameLast.map((s) => `“${s}”`).join(' or ')} on other papers. Use the same spelling so author filters and member pages stay accurate.` });
      }
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

/** Keys of all known author display names in a publication list. */
export function knownAuthorSet(pubs) {
  const s = new Set();
  for (const p of pubs) for (const a of p.authors) s.add(displayName(a));
  return s;
}
