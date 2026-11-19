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
 *
 * Brace counting treats a backslash as escaping the next character, so
 * `\{` and `\}` are literal braces (this is what the serializer relies on
 * to write values whose braces do not balance).
 */

/** Field order used when writing entries (mirrors teachPress exports). */
export const FIELD_ORDER = [
  'title', 'author', 'editor', 'url', 'doi', 'year', 'date', 'booktitle',
  'issuetitle', 'journal', 'volume', 'number', 'pages', 'chapter', 'edition',
  'series', 'publisher', 'address', 'howpublished', 'institution',
  'organization', 'school', 'techtype', 'isbn', 'issn', 'crossref', 'note',
  'abstract', 'keywords', 'annote', 'image', 'pubstate', 'tppubtype',
];

/** Month macros predefined by every standard BibTeX style. */
const MONTHS = {
  jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June',
  jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December',
};

/** Characters allowed in field names, macro names and bare values. */
const IDENT = /[^\s=,{}()"#%'@\\]+/y;

class BibtexSyntaxError extends Error {
  constructor(message, line) {
    super(`${message} (line ${line})`);
    this.name = 'BibtexSyntaxError';
    this.line = line;
  }
}

/**
 * Parse a BibTeX string.
 * @param {string} text
 * @param {{strict?: boolean}} [options] strict=true throws on the first
 *   malformed entry; otherwise malformed entries are reported in `errors`
 *   and parsing resumes at the next entry.
 * @returns {{entries: Array, errors: Array<{message: string, line: number}>}}
 */
export function parseBibtexWithErrors(text, options = {}) {
  const src = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const entries = [];
  const errors = [];
  const strings = Object.create(null); // macro names like "constructor" are plain keys
  const n = src.length;
  let i = 0;

  // Line numbers are only needed for error messages: index newlines lazily.
  let newlines = null;
  const lineAt = (pos) => {
    if (!newlines) {
      newlines = [];
      for (let j = src.indexOf('\n'); j !== -1; j = src.indexOf('\n', j + 1)) newlines.push(j);
    }
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid] < pos) lo = mid + 1; else hi = mid;
    }
    return lo + 1;
  };
  const fail = (message, pos) => { throw new BibtexSyntaxError(message, lineAt(pos)); };

  const skipWs = () => {
    while (i < n && (src[i] === ' ' || src[i] === '\n' || src[i] === '\t' || /\s/.test(src[i]))) i++;
  };

  /** Next "@" outside a %-comment line (text between entries is ignored). */
  const nextAt = (from) => {
    for (let at = src.indexOf('@', from); at !== -1; at = src.indexOf('@', from)) {
      const lineStart = src.lastIndexOf('\n', at - 1) + 1;
      if (!/^[ \t]*%/.test(src.slice(lineStart, at))) return at;
      const eol = src.indexOf('\n', at);
      if (eol === -1) return -1;
      from = eol + 1;
    }
    return -1;
  };

  /** Where to resume after a malformed entry: the next "@type{" or "@type(". */
  const resync = (from) => {
    const re = /@[ \t]*[A-Za-z]+[ \t\n]*[{(]/g;
    re.lastIndex = from + 1;
    const m = re.exec(src);
    return m ? m.index : n;
  };

  while (i < n) {
    const at = nextAt(i);
    if (at === -1) break;
    i = at + 1;
    skipWs();
    const typeMatch = /[A-Za-z]+/y;
    typeMatch.lastIndex = i;
    const tm = typeMatch.exec(src);
    if (!tm) continue; // a stray "@", e.g. an e-mail address in free text
    const type = tm[0].toLowerCase();
    i += tm[0].length;
    skipWs();
    const open = src[i];
    if (open !== '{' && open !== '(') continue;
    const close = open === '{' ? '}' : ')';

    try {
      if (type === 'comment' || type === 'preamble') {
        const end = findMatching(src, i, open, close);
        if (end === -1) fail(`Unterminated @${type}`, at);
        i = end + 1;
        continue;
      }
      i++;
      if (type === 'string') {
        skipWs();
        const name = readIdentifier();
        if (!name) fail('Expected a macro name in @string', i);
        skipWs();
        expect('=');
        const value = readValue();
        skipWs();
        if (src[i] !== close) fail(`Expected "${close}" to end @string`, i);
        i++;
        strings[name.toLowerCase()] = value;
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
        if (i >= n) fail(`Unterminated entry "${key}"`, at);
        if (src[i] === close) { i++; break; }
        if (src[i] === ',') { i++; continue; }
        const name = readIdentifier().toLowerCase();
        if (!name) fail(`Expected a field name in "${key}"`, i);
        skipWs();
        expect('=');
        fields[name] = readValue();
      }
      entries.push({ type, key: key.trim(), fields });
    } catch (err) {
      if (options.strict || !(err instanceof BibtexSyntaxError)) throw err;
      errors.push({ message: err.message, line: err.line });
      i = resync(at);
    }
  }
  return { entries, errors };

  function expect(ch) {
    if (src[i] !== ch) fail(`Expected "${ch}"`, i);
    i++;
  }

  function readIdentifier() {
    IDENT.lastIndex = i;
    const m = IDENT.exec(src);
    if (!m) return '';
    i += m[0].length;
    return m[0];
  }

  function readValue() {
    const parts = [];
    for (;;) {
      skipWs();
      const c = src[i];
      if (c === '{') {
        const end = findMatching(src, i, '{', '}');
        if (end === -1) fail('Unbalanced braces', i);
        parts.push(src.slice(i + 1, end));
        i = end + 1;
      } else if (c === '"') {
        let j = i + 1;
        let depth = 0;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '{') depth++;
          else if (src[j] === '}') depth--;
          else if (src[j] === '"' && depth <= 0) break;
          j++;
        }
        if (j >= n) fail('Unterminated quoted value', i);
        parts.push(src.slice(i + 1, j));
        i = j + 1;
      } else {
        const word = readIdentifier();
        if (!word) fail('Expected a value', i);
        const macro = word.toLowerCase();
        const month = Object.prototype.hasOwnProperty.call(MONTHS, macro) ? MONTHS[macro] : undefined;
        parts.push(/^\d+$/.test(word) ? word : (strings[macro] ?? month ?? word));
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

/** Index of the delimiter closing the one at `start`, or -1. */
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
  const raw = entry?.fields || {};
  const fields = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    const name = String(k).toLowerCase().replace(/[^a-z0-9_\-:.+/]/g, '_') || 'field';
    fields[name] = String(v);
  }
  const names = Object.keys(fields);
  const ordered = [
    ...FIELD_ORDER.filter((k) => k in fields),
    ...names.filter((k) => !FIELD_ORDER.includes(k)).sort(),
  ];
  const lines = ordered.map((k) => {
    const label = k === 'year' ? 'year ' : k;
    return `${label} = {${encodeValue(fields[k])}}`;
  });
  const type = String(entry?.type || '').toLowerCase().replace(/[^a-z]/g, '') || 'misc';
  // The parser reads a key up to the first comma, brace or whitespace.
  const key = String(entry?.key ?? '').trim().replace(/[\s,{}()"#%=\\]/g, '_');
  return `@${type}{${key},\n${lines.join(',\n')}\n}`;
}

/** Serialize many entries, separated by blank lines. */
export function serializeBibtex(entries, header = '') {
  const body = entries.map(serializeEntry).join('\n\n');
  const head = String(header || '').trimEnd().split('\n')
    .map((l) => (l === '' || /^\s*%/.test(l) ? l : `% ${l}`)).join('\n');
  return (head ? `${head}\n\n` : '') + body + '\n';
}

/**
 * Make a value safe to wrap in {...}: unmatched braces are escaped as \{ or
 * \} and a dangling final backslash (which would escape the closing brace)
 * is written as \textbackslash{}. Balanced values are returned unchanged,
 * so a parse -> serialize round trip of valid BibTeX is lossless.
 */
function encodeValue(value) {
  const s = value.replace(/\r\n?/g, '\n');
  const out = [];
  const openIdx = [];
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      if (j + 1 < s.length) { out.push(c + s[++j]); continue; }
      out.push('\\textbackslash{}');
      continue;
    }
    if (c === '{') { openIdx.push(out.length); out.push(c); continue; }
    if (c === '}') {
      if (openIdx.length) openIdx.pop();
      else { out.push('\\}'); continue; }
    }
    out.push(c);
  }
  for (const idx of openIdx) out[idx] = '\\{';
  return out.join('');
}

// ---------------------------------------------------------------------------
// LaTeX -> plain text (for display only; never applied to stored values)
// ---------------------------------------------------------------------------

/** Combining marks for LaTeX accent commands. */
const ACCENT_MARKS = {
  '`': '\u0300', "'": '\u0301', '^': '\u0302', '~': '\u0303', '=': '\u0304', '.': '\u0307',
  '"': '\u0308', u: '\u0306', v: '\u030C', H: '\u030B', c: '\u0327', k: '\u0328',
  r: '\u030A', d: '\u0323', b: '\u0331',
};

/** Letter-like macros: TeX swallows the space that follows them ("Bj\o rn"). */
const LETTERS = {
  ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å',
  l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ', DH: 'Ð', dh: 'ð', TH: 'Þ', th: 'þ', NG: 'Ŋ', ng: 'ŋ',
};

/** Symbol macros: the space after them is kept ("\leq x" -> "≤ x"). */
const SYMBOLS = {
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', sim: '∼', equiv: '≡',
  times: '×', cdot: '·', pm: '±', mp: '∓', div: '÷', infty: '∞', partial: '∂', nabla: '∇',
  sum: '∑', prod: '∏', int: '∫', sqrt: '√', propto: '∝', in: '∈', notin: '∉', subset: '⊂',
  subseteq: '⊆', supset: '⊃', cup: '∪', cap: '∩', emptyset: '∅', forall: '∀', exists: '∃',
  rightarrow: '→', to: '→', leftarrow: '←', gets: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', Leftrightarrow: '⇔', mapsto: '↦', ast: '∗', star: '⋆', circ: '∘',
  ell: 'ℓ', hbar: 'ħ', degree: '°', prime: '′',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ',
  Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  log: 'log', ln: 'ln', exp: 'exp', min: 'min', max: 'max', sin: 'sin', cos: 'cos', tan: 'tan',
  arg: 'arg', lim: 'lim', det: 'det',
  textendash: '–', textemdash: '—', ldots: '…', dots: '…', textellipsis: '…',
  textregistered: '®', texttrademark: '™', copyright: '©', textcopyright: '©',
  textdegree: '°', textbackslash: '\\', textasciitilde: '~', textasciicircum: '^',
  textunderscore: '_', textbar: '|', textless: '<', textgreater: '>', S: '§', P: '¶',
  dag: '†', ddag: '‡', textbullet: '•', euro: '€', texteuro: '€', pounds: '£',
  textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“', textquotedblright: '”',
  guillemotleft: '«', guillemotright: '»', LaTeX: 'LaTeX', TeX: 'TeX', BibTeX: 'BibTeX',
  quad: ' ', qquad: ' ',
};

/** Commands whose argument is kept as plain text. */
const TEXT_COMMANDS = 'textbf|textit|textsl|textsc|textrm|textsf|texttt|textup|textmd|textnormal|emph|underline|uline|'
  + 'mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathbb|mathfrak|boldsymbol|bm|operatorname|mbox|hbox|text|url|'
  + 'textsuperscript|textsubscript|ensuremath|protect|NoCaseChange';
/** Font switches such as {\em ...} or {\bf ...}. */
const FONT_SWITCHES = 'em|bf|it|sl|sc|rm|sf|tt|normalfont|upshape|itshape|bfseries|mdseries|scshape|small|footnotesize|large|Large|huge|noindent';

const SUPERSCRIPTS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', T: 'ᵀ' };
const SUBSCRIPTS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' };

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/**
 * Decode HTML entities (teachPress stores values HTML-escaped, sometimes
 * twice: "&amp;amp;"), repeating until the text no longer changes.
 */
export function decodeEntities(value) {
  let s = String(value ?? '');
  for (let k = 0; k < 5 && s.includes('&'); k++) {
    const next = s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/gi, (m, name) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : m;
      }
      return NAMED_ENTITIES[name.toLowerCase()] ?? m;
    });
    if (next === s) break;
    s = next;
  }
  return s;
}

/** Superscript/subscript a short math argument where Unicode allows it. */
function scriptText(text, map) {
  const chars = [...text];
  return chars.every((c) => map[c]) ? chars.map((c) => map[c]).join('') : text;
}

/** Convert common LaTeX markup in a field value to plain Unicode text. */
export function latexToText(value) {
  if (value === undefined || value === null) return '';
  let s = String(value);
  if (!/[\\{}$~`'&-]/.test(s)) return s;

  // 1. Protect escaped characters and line breaks.
  const escaped = [];
  const protect = (ch) => `\u0000${escaped.push(ch) - 1}\u0000`;
  // URLs quoted in text keep "~", "--" and "_" as they are.
  s = s.replace(/\bhttps?:\/\/[^\s{}"<>]*[^\s{}"<>.,;:!?)'\]]/g, (url) => protect(url.replace(/\\([&%$#_~])/g, '$1')));
  s = s.replace(/\\\\|\\([&%$#_{}])/g, (m, ch) => protect(ch ?? ' '));

  // 2. Text and font commands keep their argument: \emph{x}, {\em x}.
  s = s.replace(/\\href\s*\{[^{}]*\}/g, '');
  s = s.replace(new RegExp(`\\\\(?:${TEXT_COMMANDS})(?![A-Za-z])\\*?\\s*`, 'g'), '');
  s = s.replace(new RegExp(`\\\\(?:${FONT_SWITCHES})(?![A-Za-z])\\s*`, 'g'), '');

  // 3. Accents: \'e, \'{e}, {\'e}, \"{\i}, \c{c}, \c c, \v{s}, \H{o}.
  const accent = (mark, ch) => {
    const base = ch === '\\i' ? 'i' : ch === '\\j' ? 'j' : ch;
    return (base + mark).normalize('NFC');
  };
  s = s.replace(/\\([`'^"~=.])\s*(?:\{\s*(\\[ij](?![A-Za-z])|[A-Za-z])\s*\}|(\\[ij](?![A-Za-z])|[A-Za-z]))/g,
    (m, acc, a, b) => accent(ACCENT_MARKS[acc], a || b));
  s = s.replace(/\\([uvHckrdb])(?:\s*\{\s*(\\[ij](?![A-Za-z])|[A-Za-z])\s*\}|\s+([A-Za-z]))/g,
    (m, acc, a, b) => accent(ACCENT_MARKS[acc], a || b));

  // 4. Letters and symbols.
  s = s.replace(/\\([A-Za-z]+)(?![A-Za-z])(\s*\{\})?( ?)/g, (m, name, empty, space) => {
    // "\ss{} x" keeps its space; "\o rn" (no braces) swallows it, as in TeX.
    if (LETTERS[name]) return LETTERS[name] + (empty ? space : '');
    if (SYMBOLS[name] !== undefined) return SYMBOLS[name] + space;
    return space; // unknown macro: drop the command name, keep its argument
  });
  s = s.replace(/\\[ ,;:!]/g, ' ').replace(/\\[-/@]/g, '');

  // 5. Inline math: $^*$ -> *, $x^2$ -> x², $7$ -> 7.
  s = s.replace(/\$([^$]*)\$/g, (m, math) => math
    .replace(/\^\s*(?:\{([^{}]*)\}|(\S))/g, (x, a, b) => scriptText(a ?? b, SUPERSCRIPTS))
    .replace(/_\s*(?:\{([^{}]*)\}|(\S))/g, (x, a, b) => scriptText(a ?? b, SUBSCRIPTS)));

  // 6. Grouping braces, dashes, quotes, ties.
  s = s.replace(/[{}]/g, '');
  s = s.replace(/---/g, '—').replace(/--/g, '–');
  s = s.replace(/``/g, '“').replace(/''/g, '”');
  s = s.replace(/~/g, ' ');

  s = s.replace(/\u0000(\d+)\u0000/g, (m, idx) => escaped[Number(idx)]);
  return decodeEntities(s);
}
