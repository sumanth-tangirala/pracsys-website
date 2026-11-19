import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseBibtex, parseBibtexWithErrors, serializeEntry, serializeBibtex, latexToText, decodeEntities,
} from '../src/assets/js/lib/bibtex.js';

const bib = readFileSync(new URL('../data/publications.bib', import.meta.url), 'utf8');

/** Small deterministic PRNG so failures are reproducible. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Is `s` balanced when "\x" is read as an escaped pair (the parser's rule)? */
function balancedForParser(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      if (i + 1 >= s.length) return false;
      i++;
    } else if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth < 0) return false;
  }
  return depth === 0;
}

test('every real entry survives serializeEntry → parse unchanged', () => {
  const entries = parseBibtex(bib);
  assert.equal(entries.length, 198);
  for (const e of entries) {
    const { entries: back, errors } = parseBibtexWithErrors(serializeEntry(e));
    assert.deepEqual(errors, [], e.key);
    assert.deepEqual(back, [e], e.key);
  }
  assert.deepEqual(parseBibtex(serializeBibtex(entries, '% header')), entries);
});

test('serializeEntry always produces re-parseable output (adversarial values)', () => {
  const alphabet = ['{', '}', '\\', '"', '@', '%', ',', '=', '#', '\n', '\r\n', ' ', 'a', 'Z', 'é', '$', '~', '(', ')', '\\{', '\\}', '@article{x,', '}}', '{{'];
  const next = rng(42);
  const fixed = ['C:\\', 'ends with \\\\\\', '}', '{', '}{', 'a}b{c', '\\', '\\\\', '"quoted"', '@article{evil, title={x}}', '% not a comment', '', '  padded  ', 'x # y', 'line\nbreak'];
  const cases = [...fixed];
  for (let k = 0; k < 3000; k++) {
    const len = Math.floor(next() * 24);
    let s = '';
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(next() * alphabet.length)];
    cases.push(s);
  }
  for (const value of cases) {
    const entry = { type: 'article', key: 'k1', fields: { title: value, note: 'after' } };
    const text = serializeEntry(entry);
    const { entries, errors } = parseBibtexWithErrors(text);
    assert.deepEqual(errors, [], JSON.stringify(value));
    assert.equal(entries.length, 1, JSON.stringify(value));
    assert.equal(entries[0].key, 'k1');
    assert.equal(entries[0].fields.note, 'after', `field after ${JSON.stringify(value)} was swallowed`);
    // Stable: serializing what was read back gives the same text.
    assert.equal(serializeEntry(entries[0]), text, JSON.stringify(value));
    // Lossless whenever BibTeX can represent the value as it is.
    if (balancedForParser(value) && !value.includes('\r')) assert.equal(entries[0].fields.title, value, JSON.stringify(value));
  }
});

test('unrepresentable values are escaped, keeping their displayed text', () => {
  const back = (v) => parseBibtex(serializeEntry({ type: 'misc', key: 'x', fields: { title: v } }))[0].fields.title;
  assert.equal(back('a}b'), 'a\\}b');
  assert.equal(back('a{b'), 'a\\{b');
  assert.equal(back('C:\\'), 'C:\\textbackslash{}');
  assert.equal(latexToText(back('a}b{c')), 'a}b{c');
  assert.equal(latexToText(back('C:\\')), 'C:\\');
});

test('serializer sanitises keys, types and field names the parser could not read back', () => {
  const text = serializeEntry({ type: 'In Proceedings!', key: 'my key,{1}', fields: { 'Odd Name': 'v', Title: 'T', empty: null } });
  const [e] = parseBibtex(text);
  assert.equal(e.type, 'inproceedings');
  assert.equal(e.key, 'my_key__1_');
  assert.deepEqual(e.fields, { title: 'T', odd_name: 'v' });
  assert.match(serializeBibtex([e], 'Line one\n% two\nmail me@example.org'), /^% Line one\n% two\n% mail me@example\.org\n\n@inproceedings/);
});

test('parser: quotes, concatenation, @string, months and comments', () => {
  const { entries, errors } = parseBibtexWithErrors(`
    % comment @article{commented, title={no}}
    @string{icra = "Proc. ICRA"}
    @STRING(conf = {Conf. } # icra)
    @comment{ ignored @article{nope, title={x}} }
    @preamble{ "\\newcommand{\\x}{y}" }
    @inproceedings{a1, title = "A {B}ig " # "Title", booktitle = conf, year = 2020, month = jun,
      note = "say \\"hi\\" {"quoted" inside}"}
  `);
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].fields, {
    title: 'A {B}ig Title', booktitle: 'Conf. Proc. ICRA', year: '2020', month: 'June',
    note: 'say \\"hi\\" {"quoted" inside}',
  });
});

test('parser: () delimiters, CRLF, BOM, odd casing, keys with : / +', () => {
  const text = '\uFEFF@ARTICLE(Smith:2020/a+b,\r\n  TiTlE = {X (y)},\r\n  Year=2020\r\n)\r\n@Misc{k2,note={a\r\nb}}';
  const { entries, errors } = parseBibtexWithErrors(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(entries, [
    { type: 'article', key: 'Smith:2020/a+b', fields: { title: 'X (y)', year: '2020' } },
    { type: 'misc', key: 'k2', fields: { note: 'a\nb' } },
  ]);
});

test('parser: macro names are not looked up on Object.prototype', () => {
  const [e] = parseBibtex('@misc{k, title = constructor, note = toString # "x"}');
  assert.equal(e.fields.title, 'constructor');
  assert.equal(e.fields.note, 'toStringx');
});

test('malformed entries are reported and following entries still parse', () => {
  let r = parseBibtexWithErrors('@article{ok, title={Fine}}\n@article{bad, title={Unclosed}\n@misc{ok2, title={Also fine}}');
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.entries.map((e) => e.key), ['ok', 'ok2']);

  // Recovery does not need the next entry to start a line.
  r = parseBibtexWithErrors('@article{bad, title={x} junk junk} @misc{same_line, title={y}}');
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.entries.map((e) => e.key), ['same_line']);

  // Unbalanced braces swallow the rest of the entry, not the rest of the file.
  r = parseBibtexWithErrors('@article{bad, title={never closed,\n  year = 2020}\n@misc{next, title={n}}\n@misc{last, title={l}}');
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.entries.map((e) => e.key), ['next', 'last']);
  assert.match(r.errors[0].message, /"bad" \(line 3\)/);

  // Unterminated @comment / @preamble used to loop forever.
  for (const kind of ['comment', 'preamble']) {
    r = parseBibtexWithErrors(`@${kind}{ never closed\n@misc{after, title={a}}`);
    assert.equal(r.errors.length, 1, kind);
    assert.deepEqual(r.entries.map((e) => e.key), ['after'], kind);
  }

  assert.throws(() => parseBibtexWithErrors('@article{bad, title={x}', { strict: true }), /Unterminated entry "bad" \(line 1\)/);
});

test('error line numbers are right', () => {
  const { errors } = parseBibtexWithErrors('\n\n@misc{a, title={x}}\n\n@misc{b, title = }\n');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 5);
});

test('large files parse quickly', () => {
  const big = bib.repeat(25); // ~9 MB, ~5000 entries
  const t = performance.now();
  const { entries, errors } = parseBibtexWithErrors(big);
  assert.equal(entries.length, 198 * 25);
  assert.equal(errors.length, 0);
  assert.ok(performance.now() - t < 3000, `took ${performance.now() - t} ms`);
  // Many errors must not be quadratic (line numbers are computed lazily).
  const broken = '@misc{x, title = }\n'.repeat(20000);
  const t2 = performance.now();
  assert.equal(parseBibtexWithErrors(broken).errors.length, 20000);
  assert.ok(performance.now() - t2 < 3000, `took ${performance.now() - t2} ms`);
});

test('latexToText: accents, symbols, math, escapes', () => {
  const cases = {
    "Caf{\\'e} \\& {RRT}$^*$ -- fast": 'Café & RRT* – fast',
    'M{\\"u}ller and \\"{O}zt\\"urk': 'Müller and Öztürk',
    "M\\'{e}rida, M\\'{e}xico": 'Mérida, México',
    '\\c{c}a \\c c \\v{s}\\H{o} \\k{a} \\r{a}': 'ça ç šő ą å',
    "{\\'\\i}x \\\"{\\i}": 'íx ï',
    "\\'Emile \\`a \\^o \\~n \\=a \\.z \\u{g}": 'Émile à ô ñ ā ż ğ',
    'Bj\\o rn \\ss{} \\AA ngstr\\"om \\L\\\'od\\\'z': 'Bjørn ß Ångström Łódź',
    'P(|In| \\leq deltaI) \\leq Psuccess': 'P(|In| ≤ deltaI) ≤ Psuccess',
    'up to $7$ arms; $\\delta$-robust; x$^{2}$, H$_2$O, $\\alpha+\\beta$': 'up to 7 arms; δ-robust; x², H₂O, α+β',
    'dRRT$^*$ and $O(n \\log n)$': 'dRRT* and O(n log n)',
    '\\textbf{Bold {Nested}} {\\em em} \\emph{x}': 'Bold Nested em x',
    'a~b ``q\'\' 100\\% \\$5 \\#1 a\\_b \\{x\\}': 'a b “q” 100% $5 #1 a_b {x}',
    'pages 1--2, a---b': 'pages 1–2, a—b',
    '\\ldots{} and \\ldots more': '… and … more',
    'unknown \\foo{bar}': 'unknown bar',
    'no markup at all': 'no markup at all',
    'code at https://x.org/~kb572/a--b\\_c.pdf, see \\url{http://y.org/p~q}.': 'code at https://x.org/~kb572/a--b_c.pdf, see http://y.org/p~q.',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(latexToText(input), want, input);
  assert.equal(latexToText(undefined), '');
  assert.equal(latexToText(null), '');
});

test('latexToText decodes teachPress HTML entities (display only)', () => {
  assert.equal(latexToText('Learning for Dynamics \\&amp;amp;amp; Control'), 'Learning for Dynamics & Control');
  assert.equal(latexToText('tolerances (\\&lt;1mm)'), 'tolerances (<1mm)');
  assert.equal(decodeEntities('&#39;a&#039; &#x41; &quot;'), "'a' A \"");
  assert.equal(decodeEntities('&bogus; & &#0;'), '&bogus; & &#0;');
  // The stored value is untouched.
  const [e] = parseBibtex('@misc{k, booktitle = {A \\&amp;amp; B}}');
  assert.equal(e.fields.booktitle, 'A \\&amp;amp; B');
});
