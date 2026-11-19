/**
 * Minimal, dependency-free BibTeX parser and serializer.
 *
 * Shared by the Eleventy build (Node) and the browser (public publication
 * lists and the admin editor), so it must stay plain ES2020 with no imports.
 *
 * An entry is represented as:
 *   { type: 'inproceedings', key: 'smith2020', fields: { title: '...', ... } }
 * Field names are lower-cased; values are kept as raw BibTeX text (LaTeX
 * escapes intact) so a parse -> serialize round trip is lossless.
 */

/** Field order used when writing entries (mirrors teachPress exports). */
export const FIELD_ORDER = [
  'title', 'author', 'editor', 'url', 'doi', 'year', 'date', 'booktitle',
  'issuetitle', 'journal', 'volume', 'number', 'pages', 'chapter', 'edition',
  'series', 'publisher', 'address', 'howpublished', 'institution',
  'organization', 'school', 'techtype', 'isbn', 'issn', 'crossref', 'note',
  'abstract', 'keywords', 'annote', 'image', 'pubstate', 'tppubtype',
];

class BibtexSyntaxError extends Error {
  constructor(message, pos, text) {
    const line = text.slice(0, pos).split('\n').length;
    super(`${message} (line ${line})`);
    this.name = 'BibtexSyntaxError';
    this.line = line;
  }
}

/**
 * Parse a BibTeX string.
 * @param {string} text
 * @param {{strict?: boolean}} [options] strict=true throws on the first
 *   malformed entry; otherwise malformed entries are reported in `errors`.
 * @returns {{entries: Array, errors: Array<{message: string, line: number}>}}
 */
export function parseBibtexWithErrors(text, options = {}) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const entries = [];
  const errors = [];
  const strings = {};
  let i = 0;
  const n = src.length;

  const skipWs = () => {
    while (i < n && /\s/.test(src[i])) i++;
  };

  while (i < n) {
    const at = src.indexOf('@', i);
    if (at === -1) break;
    i = at + 1;
    const typeMatch = /^[A-Za-z]+/.exec(src.slice(i, i + 40));
    if (!typeMatch) continue;
    const type = typeMatch[0].toLowerCase();
    i += typeMatch[0].length;
    skipWs();
    const open = src[i];
    if (open !== '{' && open !== '(') continue;
    const close = open === '{' ? '}' : ')';
    const entryStart = at;
    i++;

    if (type === 'comment') {
      i = findMatching(src, i - 1, open, close) + 1;
      continue;
    }

    try {
      if (type === 'preamble') {
        i = findMatching(src, i - 1, open, close) + 1;
        continue;
      }
      if (type === 'string') {
        skipWs();
        const name = readIdentifier();
        skipWs();
        expect('=');
        const value = readValue();
        strings[name.toLowerCase()] = value;
        skipWs();
        if (src[i] === close) i++;
        continue;
      }

      skipWs();
      let key = '';
      while (i < n && src[i] !== ',' && src[i] !== close && !/\s/.test(src[i])) key += src[i++];
      skipWs();
      const fields = {};
      if (src[i] === ',') i++;
      for (;;) {
        skipWs();
        if (i >= n) throw new BibtexSyntaxError(`Unterminated entry "${key}"`, entryStart, src);
        if (src[i] === close) { i++; break; }
        if (src[i] === ',') { i++; continue; }
        const name = readIdentifier().toLowerCase();
        if (!name) throw new BibtexSyntaxError(`Expected a field name in "${key}"`, i, src);
        skipWs();
        expect('=');
        fields[name] = readValue();
      }
      entries.push({ type, key: key.trim(), fields });
    } catch (err) {
      if (options.strict) throw err;
      errors.push({ message: err.message, line: err.line ?? 0 });
      // Resynchronise on the next line that starts with "@".
      const next = src.indexOf('\n@', entryStart + 1);
      i = next === -1 ? n : next + 1;
    }
  }
  return { entries, errors };

  function expect(ch) {
    if (src[i] !== ch) throw new BibtexSyntaxError(`Expected "${ch}"`, i, src);
    i++;
  }

  function readIdentifier() {
    let s = '';
    while (i < n && /[A-Za-z0-9_\-:.+]/.test(src[i])) s += src[i++];
    return s;
  }

  function readValue() {
    const parts = [];
    for (;;) {
      skipWs();
      const c = src[i];
      if (c === '{') {
        const end = findMatching(src, i, '{', '}');
        if (end === -1) throw new BibtexSyntaxError('Unbalanced braces', i, src);
        parts.push(src.slice(i + 1, end));
        i = end + 1;
      } else if (c === '"') {
        let j = i + 1;
        let depth = 0;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '{') depth++;
          else if (src[j] === '}') depth--;
          else if (src[j] === '"' && depth === 0) break;
          j++;
        }
        if (j >= n) throw new BibtexSyntaxError('Unterminated quoted value', i, src);
        parts.push(src.slice(i + 1, j));
        i = j + 1;
      } else {
        const m = /^[A-Za-z0-9_\-:.+]+/.exec(src.slice(i, i + 200));
        if (!m) throw new BibtexSyntaxError('Expected a value', i, src);
        const word = m[0];
        i += word.length;
        parts.push(/^\d+$/.test(word) ? word : (strings[word.toLowerCase()] ?? word));
      }
      skipWs();
      if (src[i] === '#') { i++; continue; }
      break;
    }
    return parts.join('');
  }
}

/** Parse BibTeX, ignoring malformed entries. */
export function parseBibtex(text) {
  return parseBibtexWithErrors(text).entries;
}

function findMatching(src, start, open, close) {
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** Serialize one entry in teachPress' layout (one field per line). */
export function serializeEntry(entry) {
  const fields = entry.fields || {};
  const names = Object.keys(fields).filter((k) => fields[k] !== undefined && fields[k] !== null);
  const ordered = [
    ...FIELD_ORDER.filter((k) => names.includes(k)),
    ...names.filter((k) => !FIELD_ORDER.includes(k)).sort(),
  ];
  const lines = ordered.map((k) => {
    const label = k === 'year' ? 'year ' : k;
    return `${label} = {${balanceBraces(String(fields[k]))}}`;
  });
  return `@${entry.type}{${entry.key},\n${lines.join(',\n')}\n}`;
}

/** Serialize many entries, separated by blank lines. */
export function serializeBibtex(entries, header = '') {
  const body = entries.map(serializeEntry).join('\n\n');
  return (header ? header.trimEnd() + '\n\n' : '') + body + '\n';
}

/** Escape unbalanced braces so a value can always be wrapped in {...}. */
function balanceBraces(value) {
  let depth = 0;
  let out = '';
  for (let j = 0; j < value.length; j++) {
    const c = value[j];
    if (c === '\\' && j + 1 < value.length) { out += c + value[++j]; continue; }
    if (c === '{') depth++;
    if (c === '}') {
      if (depth === 0) { out += '\\}'; continue; }
      depth--;
    }
    out += c;
  }
  return out + '}'.repeat(depth);
}

const ACCENTS = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', c: 'ć', n: 'ń', s: 'ś', z: 'ź', C: 'Ć', S: 'Ś', Z: 'Ź' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  c: { c: 'ç', C: 'Ç', s: 'ş', S: 'Ş' },
  v: { c: 'č', s: 'š', z: 'ž', r: 'ř', e: 'ě', C: 'Č', S: 'Š', Z: 'Ž', R: 'Ř' },
  u: { a: 'ă', g: 'ğ', A: 'Ă', G: 'Ğ' },
  '=': { a: 'ā', e: 'ē', o: 'ō', u: 'ū' },
  '.': { z: 'ż', Z: 'Ż' },
};
const SYMBOLS = { ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', leq: '≤', geq: '≥', times: '×', textendash: '–', textemdash: '—', ldots: '…' };

/** Convert common LaTeX markup in a field value to plain Unicode text. */
export function latexToText(value) {
  if (value === undefined || value === null) return '';
  let s = String(value);
  s = s.replace(/\\([`'^"~=.])\s*\{?\\?([A-Za-z])\}?/g, (m, acc, ch) => ACCENTS[acc]?.[ch] ?? ch);
  s = s.replace(/\\([cvu])\s*\{([A-Za-z])\}/g, (m, acc, ch) => ACCENTS[acc]?.[ch] ?? ch);
  s = s.replace(/\\(ss|ae|AE|oe|OE|aa|AA|leq|geq|times|textendash|textemdash|ldots|[oOlLi])\b\s?(\{\})?/g, (m, sym) => SYMBOLS[sym] ?? m);
  s = s.replace(/\\(?:textbf|textit|emph|texttt|mathrm|mbox|text)\s*\{([^{}]*)\}/g, '$1');
  // Protect escaped characters while stripping grouping braces.
  const escaped = [];
  s = s.replace(/\\([&%$#_{}])/g, (m, ch) => `\u0000${escaped.push(ch) - 1}\u0000`);
  s = s.replace(/[{}]/g, '');
  s = s.replace(/---/g, '—').replace(/--/g, '–');
  s = s.replace(/``|''/g, '"');
  s = s.replace(/(^|[^\\])~/g, '$1 ');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, idx) => escaped[Number(idx)]);
  return s;
}
