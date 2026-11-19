import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBibtex, parseBibtexWithErrors, serializeBibtex, latexToText } from '../src/assets/js/lib/bibtex.js';
import { publicationsFromEntries, filterPublications, renderMeta, renderPublication, splitNames, parseName, displayName, parseLinks } from '../src/assets/js/lib/publications.js';

const bib = readFileSync(new URL('../data/publications.bib', import.meta.url), 'utf8');

test('data/publications.bib parses without errors', () => {
  const { entries, errors } = parseBibtexWithErrors(bib);
  assert.deepEqual(errors, [], errors.map((e) => e.message).join('\n'));
  assert.ok(entries.length > 0);
});

test('every entry has a unique key, a title and a known type', () => {
  const entries = parseBibtex(bib);
  const keys = new Set();
  for (const e of entries) {
    assert.ok(e.key, 'entry without key');
    assert.ok(!keys.has(e.key), `duplicate key ${e.key}`);
    keys.add(e.key);
    assert.ok(String(e.fields.title || '').trim(), `${e.key} has no title`);
  }
});

test('serialize → parse round trip keeps every field', () => {
  const entries = parseBibtex(bib);
  const again = parseBibtex(serializeBibtex(entries));
  assert.equal(again.length, entries.length);
  entries.forEach((e, i) => {
    assert.equal(again[i].key, e.key);
    for (const [k, v] of Object.entries(e.fields)) {
      if (String(v).trim() === '') continue;
      assert.equal(again[i].fields[k], v, `${e.key}.${k}`);
    }
  });
});

test('parser handles quotes, concatenation, @string and comments', () => {
  const { entries, errors } = parseBibtexWithErrors(`
    % comment
    @string{icra = "Proc. ICRA"}
    @comment{ ignored @article{nope, title={x}} }
    @inproceedings{a1, title = "A {B}ig " # "Title", booktitle = icra, year = 2020}
  `);
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].fields.title, 'A {B}ig Title');
  assert.equal(entries[0].fields.booktitle, 'Proc. ICRA');
  assert.equal(entries[0].fields.year, '2020');
});

test('malformed entries are reported, not silently dropped', () => {
  const { entries, errors } = parseBibtexWithErrors('@article{ok, title={Fine}}\n@article{bad, title={Unclosed}\n@misc{ok2, title={Also fine}}');
  assert.equal(errors.length, 1);
  assert.deepEqual(entries.map((e) => e.key), ['ok', 'ok2']);
});

test('LaTeX is converted for display', () => {
  assert.equal(latexToText('Caf{\\\'e} \\& {RRT}$^*$ -- fast'), 'Café & RRT* – fast');
  assert.equal(latexToText('M{\\"u}ller'), 'Müller');
});

test('author names follow teachPress display', () => {
  assert.deepEqual(splitNames('N Chen and P Meng and R Kramer-Bottiglio'), ['N Chen', 'P Meng', 'R Kramer-Bottiglio']);
  assert.equal(displayName(parseName('R Kramer-Bottiglio')), 'Kramer-Bottiglio, R');
  assert.equal(displayName(parseName('Bekris, Kostas E.')), 'Bekris, Kostas E.');
  assert.equal(displayName(parseName('D K Grady')), 'Grady, D K');
});

test('meta line matches teachPress formatting', () => {
  const [p] = publicationsFromEntries(parseBibtex('@article{x, title={T}, author={A B}, journal={IJRR}, volume={31}, number={2}, pages={129--149}, year={2012}, tppubtype={article}}'));
  assert.equal(renderMeta(p).replace(/<[^>]+>/g, ''), 'In: IJRR, vol. 31, no. 2, pp. 129–149, 2012.');
  const [c] = publicationsFromEntries(parseBibtex('@conference{y, title={T}, author={A B}, booktitle={ICRA}, address={Paris}, note={Best Paper}, year={2020}}'));
  assert.equal(renderMeta(c).replace(/<[^>]+>/g, ''), 'ICRA, Paris, 2020, (Best Paper).');
  const [f] = publicationsFromEntries(parseBibtex('@article{z, title={T}, author={A B}, journal={FnT}, pubstate={forthcoming}}'));
  assert.equal(renderMeta(f).replace(/<[^>]+>/g, ''), 'In: FnT, Forthcoming.');
});

test('links: multiple URLs, labels and DOI', () => {
  const links = parseLinks('https://arxiv.org/abs/1\n\nhttps://x.org/p.pdf, Paper PDF', '10.1/abc');
  assert.deepEqual(links.map((l) => l.icon), ['ai ai-arxiv', 'fas fa-file-pdf', 'ai ai-doi']);
  assert.equal(links[1].label, 'Paper PDF');
  assert.equal(links[2].url, 'https://dx.doi.org/10.1/abc');
});

test('filters by tag, author, year and search text', () => {
  const pubs = publicationsFromEntries(parseBibtex(bib));
  const planning = filterPublications(pubs, { tags: ['Planning'] });
  assert.ok(planning.length > 50);
  assert.ok(planning.every((p) => p.tags.includes('Planning')));
  const mine = filterPublications(pubs, { authors: ['Tangirala, S'] });
  assert.ok(mine.length >= 1 && mine.every((p) => p.authorText.includes('Tangirala, S')));
  assert.ok(filterPublications(pubs, { q: 'tensegrity', year: '2026' }).length >= 1);
});

test('rendered entries escape HTML', () => {
  const [p] = publicationsFromEntries(parseBibtex('@misc{x, title={<script>alert(1)</script>}, author={A B}, year={2020}}'));
  assert.ok(!renderPublication(p).includes('<script>'));
});

test('publications are sorted newest first', () => {
  const pubs = publicationsFromEntries(parseBibtex(bib));
  for (let i = 1; i < pubs.length; i++) assert.ok(pubs[i - 1].date >= pubs[i].date, `${pubs[i - 1].key} before ${pubs[i].key}`);
});
