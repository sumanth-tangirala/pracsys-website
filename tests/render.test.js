import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBibtex } from '../src/assets/js/lib/bibtex.js';
import {
  TYPES, publicationsFromEntries, toPublication, sortPublications, filterPublications, facets,
  renderMeta, renderPublication, renderPublicationList, publistRenderOptions, publicationDomId,
  splitNames, parseName, displayName, parseLinks, safeUrl, authorMatcher,
} from '../src/assets/js/lib/publications.js';
import { renderPager, PAGER_LABELS } from '../src/assets/js/lib/pager.js';

const bib = readFileSync(new URL('../data/publications.bib', import.meta.url), 'utf8');
const pub = (src) => publicationsFromEntries(parseBibtex(src))[0];
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const meta = (src) => text(renderMeta(pub(src)));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------- meta line

test('meta line matches teachPress for each type', () => {
  const cases = [
    ['@article{a, journal={IJRR}, volume={31}, number={2}, pages={129--149}, year={2012}}', 'In: IJRR, vol. 31, no. 2, pp. 129–149, 2012.'],
    ['@conference{a, booktitle={ICRA}, address={Paris}, note={Best Paper}, year={2020}}', 'ICRA, Paris, 2020, (Best Paper).'],
    ['@conference{a, booktitle={MRS}, organization={[Award]}, publisher={[Award]}, address={LA}, year={2017}}', 'MRS, [Award] [Award], LA, 2017.'],
    ['@workshop{a, booktitle={ICRA}, address={Anchorage, AK}, year={2010}}', 'ICRA, Anchorage, AK, 2010.'],
    ['@inproceedings{a, editor={E Karpas}, booktitle={ICAPS}, pages={1-2}, publisher={AAAI}, year={2019}}', 'In: Karpas, E (Ed.): ICAPS, pp. 1–2, AAAI, 2019.'],
    ['@inbook{a, booktitle={LNCS}, volume={33}, chapter={4}, pages={75--101}, publisher={Springer}, year={2006}}', 'In: LNCS, vol. 33, Chapter 4, pp. 75–101, Springer, 2006.'],
    ['@incollection{a, booktitle={Handbook}, publisher={MIT}, pages={3--9}, address={Boston}, year={2001}}', 'In: Handbook, MIT, pp. 3–9, Boston, 2001.'],
    ['@book{a, publisher={Springer}, isbn={978-3-030-43089-4}, year={2020}}', 'Springer, 2020, ISBN: 978-3-030-43089-4.'],
    ['@proceedings{a, publisher={Springer}, address={Rennes, France}, issn={978-3-642}, year={2012}}', 'Springer, Rennes, France, 2012, ISSN: 978-3-642.'],
    ['@collection{a, edition={2nd}, publisher={P}, address={A}, year={2001}}', '2nd, P, A, 2001.'],
    ['@booklet{a, howpublished={Self}, address={NJ}, year={2001}}', 'Self, NJ, 2001.'],
    ['@phdthesis{a, school={Rice University}, year={2009}}', 'Rice University, 2009.'],
    ['@mastersthesis{a, school={UNR}, year={2011}}', 'UNR, 2011.'],
    ['@techreport{a, institution={Rutgers}, address={NJ}, techtype={TR}, number={7}, year={2019}}', 'Rutgers, NJ, TR, no. 7, 2019.'],
    ['@techreport{a, school={PlanRob Workshop}, year={2019}}', '2019.'],
    ['@misc{a, howpublished={arXiv}, year={2021}}', 'arXiv, 2021.'],
    ['@unpublished{a, howpublished={Draft}, note={In prep}}', 'Draft, (In prep).'],
    ['@manual{a, address={NJ}, edition={3}, year={2001}}', 'NJ, 3, 2001.'],
    ['@online{a, organization={GitHub}, year={2022}, note={code}}', 'GitHub 2022, (code).'],
    ['@periodical{a, issuetitle={Special}, series={S}, volume={1}, number={2}, year={2003}}', 'Special, S, vol. 1, no. 2, 2003.'],
    ['@presentation{a, howpublished={Talk}, address={Rome}, year={2015}}', 'Talk, Rome, 2015.'],
    ['@patent{a, number={US123}, address={USA}, year={2015}}', 'no. US123, USA, 2015.'],
  ];
  for (const [src, want] of cases) assert.equal(meta(src), want, src);
});

test('meta line never leaves dangling or doubled separators, for every type', () => {
  const pool = {
    journal: 'J', booktitle: 'B', volume: '3', number: '4', pages: '5--6', publisher: 'P', address: 'A',
    edition: 'E', chapter: 'C', institution: 'I', organization: 'O', school: 'S', series: 'Se',
    howpublished: 'H', techtype: 'T', isbn: '978', issn: '123', note: 'N', editor: 'X Y', issuetitle: 'IT',
    year: '2020', pubstate: 'forthcoming',
  };
  const keys = Object.keys(pool);
  const next = rng(7);
  for (const type of Object.keys(TYPES)) {
    for (let k = 0; k < 150; k++) {
      const fields = { title: 'T', tppubtype: type };
      for (const f of keys) if (next() < 0.35) fields[f] = pool[f];
      const p = toPublication({ type, key: 'k', fields });
      const html = renderMeta(p);
      const t = text(html);
      const label = `${type} ${JSON.stringify(fields)} → ${JSON.stringify(t)}`;
      if (!t) continue;
      assert.ok(t.endsWith('.'), label);
      assert.ok(!/[,:]\s*\.$/.test(t), label);
      assert.ok(!/,\s*,|:\s*,|,\s*:/.test(t), label);
      assert.ok(!/ {2}|^\s|\s\.$/.test(t), label);
      assert.ok(!/^In: \.$/.test(t), label);
      assert.ok(!/<span class="tp_pub_additional_\w+"><\/span>/.test(html), label);
    }
  }
});

test('meta line edge cases', () => {
  assert.equal(meta('@article{a, journal={J}}'), 'In: J.');
  assert.equal(meta('@article{a, title={only}}'), '');
  assert.equal(meta('@book{a, publisher={P}, isbn={1}}'), 'P, ISBN: 1.');
  assert.equal(meta('@misc{a, note={just a note}}'), '(just a note).');
  assert.equal(meta('@misc{a, howpublished={Washington, D.C.}}'), 'Washington, D.C.');
  assert.equal(meta('@article{a, journal={  Spaced \n  Out  }, year={2020}}'), 'In: Spaced Out, 2020.');
  assert.equal(meta('@article{a, journal={FnT}, pubstate={forthcoming}}'), 'In: FnT, Forthcoming.');
  assert.equal(meta('@article{a, journal={FnT}, year={2027}, pubstate={forthcoming}}'), 'In: FnT, Forthcoming.');
  assert.equal(meta('@conference{a, booktitle={Learning for Dynamics \\&amp;amp;amp; Control}, year={2020}}'), 'Learning for Dynamics & Control, 2020.');
});

test('real data: no meta line has dangling separators', () => {
  for (const p of publicationsFromEntries(parseBibtex(bib))) {
    const t = text(renderMeta(p));
    assert.ok(t.endsWith('.') && !/[,:]\s*\.$|,\s*,| {2}/.test(t), `${p.key}: ${t}`);
    assert.ok(!/&amp;|&lt;|\\&/.test(t), `${p.key}: undecoded entity in ${t}`);
  }
});

// ------------------------------------------------------------------- names

test('splitNames handles whitespace, newlines, case and braces', () => {
  assert.deepEqual(splitNames('N Chen and P Meng and R Kramer-Bottiglio'), ['N Chen', 'P Meng', 'R Kramer-Bottiglio']);
  assert.deepEqual(splitNames('  A  B\n and\tC D AND E F  '), ['A B', 'C D', 'E F']);
  assert.deepEqual(splitNames('{Barnes and Noble} and Alexander Anderson'), ['{Barnes and Noble}', 'Alexander Anderson']);
  assert.deepEqual(splitNames(''), []);
  assert.deepEqual(splitNames(undefined), []);
});

test('parseName: Last, First / First von Last / braces / Jr', () => {
  const d = (n) => displayName(parseName(n));
  assert.equal(d('R Kramer-Bottiglio'), 'Kramer-Bottiglio, R');
  assert.equal(d('Bekris, Kostas E.'), 'Bekris, Kostas E.');
  assert.equal(d('D K Grady'), 'Grady, D K');
  assert.equal(d('Jur van den Berg'), 'van den Berg, Jur');
  assert.equal(d('van den Berg, Jur'), 'van den Berg, Jur');
  assert.equal(d('{Van den Berg}, Jur'), 'Van den Berg, Jur');
  assert.equal(d('Jur {Van den Berg}'), 'Van den Berg, Jur');
  assert.equal(d('{Barnes, and Noble}'), 'Barnes, and Noble');
  assert.equal(d('Ford, Jr., Henry'), 'Ford Jr., Henry');
  assert.equal(d("Fran{\\c{c}}ois M\\\"uller"), 'Müller, François');
  assert.equal(d('Aristotle'), 'Aristotle');
  assert.equal(d('  Ada \n  Lovelace '), 'Lovelace, Ada');
});

test('"and others" renders as et al. and is not an author', () => {
  const p = pub('@misc{a, title={T}, author={A Smith and B Jones and others}}');
  assert.equal(p.authorText, 'Smith, A; Jones, B; et al.');
  assert.deepEqual(p.authors.map(displayName), ['Smith, A', 'Jones, B']);
  assert.ok(!facets([p]).authors.includes('others'));
});

test('editors stand in for missing authors', () => {
  assert.equal(pub('@proceedings{a, title={P}, editor={K Goldberg and P Abbeel}}').authorText, 'Goldberg, K; Abbeel, P (Ed.)');
});

test('author filters match last name + first initial', () => {
  const pubs = publicationsFromEntries(parseBibtex(`
    @misc{a, title={1}, author={Kostas E. Bekris}, year={2020}}
    @misc{b, title={2}, author={K. Bekris and N Chen}, year={2020}}
    @misc{c, title={3}, author={Bekris, K}, year={2020}}
    @misc{d, title={4}, author={M Chen}, year={2020}}
    @misc{e, title={5}, author={Z Bekris}, year={2020}}
  `));
  const keys = (f) => filterPublications(pubs, f).map((p) => p.key).sort();
  assert.deepEqual(keys({ authors: ['Bekris, K'] }), ['a', 'b', 'c']);
  assert.deepEqual(keys({ author: 'Bekris, Kostas E.' }), ['a', 'b', 'c']);
  assert.deepEqual(keys({ author: 'K E Bekris' }), ['a', 'b', 'c']);
  assert.deepEqual(keys({ authors: ['Chen, N'] }), ['b']);
  assert.deepEqual(keys({ authors: ['Chen, M'] }), ['d']);
  assert.deepEqual(keys({ authors: ['Chen, N', 'Chen, M'] }), ['b', 'd']);
  assert.deepEqual(keys({ author: 'Bekris' }), ['a', 'b', 'c', 'e']);
  // Facets keep the exact spellings.
  assert.deepEqual(facets(pubs).authors, ['Bekris, K', 'Bekris, K.', 'Bekris, Kostas E.', 'Bekris, Z', 'Chen, M', 'Chen, N']);
  assert.ok(authorMatcher(['Müller, J'])(parseName('J Muller')));
});

// ----------------------------------------------------------------- sorting

test('sorting: forthcoming first, then newest, undated last; stable', () => {
  const pubs = publicationsFromEntries(parseBibtex(`
    @misc{old, title={o}, year={2001}, date={2001-05-01}}
    @misc{nodate, title={n}}
    @misc{zero, title={z}, year={0000}}
    @misc{soon, title={s}, pubstate={forthcoming}}
    @misc{new1, title={a}, year={2024}, date={2024-03-01}}
    @misc{new2, title={b}, year={2024}, date={2024-03-01}}
    @misc{mism, title={m}, year={2024}, date={2023-12-31}}
    @misc{y2023, title={y}, year={2023}, date={2023-12-01}}
    @misc{partial, title={p}, date={2022-06}}
  `));
  assert.deepEqual(pubs.map((p) => p.key), ['soon', 'new1', 'new2', 'mism', 'y2023', 'partial', 'old', 'nodate', 'zero']);
  assert.equal(pubs.find((p) => p.key === 'partial').date, '2022-06-01');
  assert.equal(pubs.find((p) => p.key === 'partial').year, 2022);
  // Re-sorting a sorted list is a no-op (stable).
  assert.deepEqual(sortPublications([...pubs].reverse()).map((p) => p.key), pubs.map((p) => p.key));

  const html = renderPublicationList(pubs, { idPrefix: 'x' });
  const headings = [...html.matchAll(/<h3 class="tp_h3" id="([^"]+)">([^<]+)<\/h3>/g)].map((m) => m[2]);
  assert.deepEqual(headings, ['Forthcoming', '2024', '2023', '2022', '2001', 'Undated']);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
});

test('real data: one heading per year, ids unique', () => {
  const pubs = publicationsFromEntries(parseBibtex(bib));
  for (let i = 1; i < pubs.length; i++) assert.ok(pubs[i - 1].date >= pubs[i].date || pubs[i - 1].year > pubs[i].year, pubs[i].key);
  const html = renderPublicationList(pubs, { idPrefix: 'p', showTags: true });
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  // The forthcoming paper has a year and stays in it; the one entry without a year comes last.
  assert.equal(pubs.find((p) => p.key === 'McMahon:2022aa').heading, '2022');
  assert.equal(pubs.at(-1).key, 'Dobson:2014ac');
  assert.equal(pubs.at(-1).heading, 'Undated');
});

test('year heading level is configurable', () => {
  const p = pub('@misc{a, title={x}, year={2020}}');
  assert.match(renderPublicationList([p]), /<h3 class="tp_h3" id="tp_h3_2020">2020<\/h3>/);
  assert.match(renderPublicationList([p], { headingLevel: 2, idPrefix: 'p' }), /<h2 class="tp_h3" id="p_tp_h3_2020">2020<\/h2>/);
  assert.equal(publistRenderOptions({ filters: true, headingLevel: 2 }).headingLevel, 2);
});

// ----------------------------------------------------------- links and XSS

test('links: multiple URLs, labels, DOI, entities', () => {
  const links = parseLinks('https://arxiv.org/abs/1\n\nhttps://x.org/p.pdf, Paper PDF\\nhttp://a.org/?x=1\\&amp;amp;y=2', '10.1/a_b#c?d');
  assert.deepEqual(links.map((l) => l.icon), ['ai ai-arxiv', 'fas fa-file-pdf', 'fas fa-globe', 'ai ai-doi']);
  assert.equal(links[1].label, 'Paper PDF');
  assert.equal(links[2].url, 'http://a.org/?x=1&y=2');
  assert.equal(links[3].url, 'https://dx.doi.org/10.1/a_b%23c%3Fd');
  assert.equal(parseLinks('', 'https://doi.org/10.5/x')[0].url, 'https://dx.doi.org/10.5/x');
  assert.equal(parseLinks('', 'doi:10.5/x')[0].label, 'doi:10.5/x');
});

test('unsafe URLs never reach href or src', () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' java\tscript:alert(1)', 'java\nscript:x', 'data:text/html,<script>', 'vbscript:x', 'javascript&#58;alert(1)', '\u0001javascript:x']) {
    assert.equal(safeUrl(bad), '', bad);
    // (The url field holds one link per line, so "java\nscript:x" is two links: "java" and a blocked one.)
    for (const l of parseLinks(bad)) assert.ok(!/script:|data:/i.test(l.url.replace(/[\s\u0000-\u001f]/g, '')), bad);
  }
  for (const ok of ['https://a.org/x', 'http://a.org', 'mailto:a@b.org', '/papers/', '?tag=x', '#top', 'ftp://f.org/x', 'a/b:c']) assert.equal(safeUrl(ok), ok, ok);
  const p = pub('@misc{a, title={T}, keywords={Tag}, url={javascript:alert(1)}, image={javascript:alert(2)}}');
  const html = renderPublication(p, { showImages: true, tagHref: () => 'javascript:alert(3)', showTags: true });
  const attrs = [...html.matchAll(/ (?:href|src)="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(attrs, ['#'], html); // only the neutralised tag link
});

test('every value reaching the HTML is escaped', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const p = pub(`@misc{k"><x, title={<script>alert(1)</script>}, author={A ${evil}}, keywords={${evil}, ok},
    url={https://a.org/"onmouseover="x, label ${evil}}, abstract={${evil}}, note={${evil}}, pubstate={x"y}, year={2020}}`);
  const html = renderPublicationList([p], { showTags: true, idPrefix: '"x' });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!/ onerror=| onmouseover=/.test(html.replace(/&quot;/g, '')) || !html.includes('"onmouseover'), html);
  assert.ok(!html.includes('"onmouseover="'));
  for (const m of html.matchAll(/ id="([^"]*)"/g)) assert.match(m[1], /^[A-Za-z0-9_-]+$/);
});

test('element ids are valid and unique for awkward keys', () => {
  const keys = ['a:b', 'a/b', 'a b', 'a_b', 'a+b', 'Dobson:2017aa', 'ünï', '', '1abc', 'x'.repeat(200)];
  const ids = keys.map((k) => publicationDomId(k, 'p'));
  assert.equal(new Set(ids).size, keys.length);
  for (const id of ids) assert.match(id, /^p-[A-Za-z0-9_-]+$/);
  assert.equal(publicationDomId('mpc_gnn_iros26', 'p'), 'p-mpc_gnn_iros26');
  const html = renderPublication(pub('@misc{a:b, title={T}, url={https://x.org}, abstract={x}}'), { idPrefix: 'p' });
  const id = publicationDomId('a:b', 'p');
  for (const panel of ['abstract', 'links', 'bibtex']) {
    assert.ok(html.includes(`id="${id}-${panel}"`));
    assert.ok(html.includes(`aria-controls="${id}-${panel}"`));
  }
});

test('panels: close buttons are named, abstracts keep paragraphs only', () => {
  const p = pub('@misc{a, title={  Model  Predictive\n Control  }, abstract={line one\ncontinues here\n\nSecond paragraph}, url={https://x.org}}');
  assert.equal(p.title, 'Model Predictive Control');
  const html = renderPublication(p);
  assert.ok(html.includes('line one continues here<br><br>Second paragraph'));
  assert.ok(html.includes('aria-label="Close abstract"'));
  assert.ok(html.includes('aria-label="Close links"'));
  assert.ok(html.includes('aria-label="Close BibTeX"'));
});

test('prototype-like values do not leak into the markup', () => {
  const p = pub('@misc{a, title={T}, tppubtype={constructor}, pubstate={constructor}}');
  assert.equal(p.type, 'misc');
  assert.ok(!renderPublication(p).includes('native code'));
});

// ------------------------------------------------------------------- pager

test('pager markup and labels', () => {
  assert.equal(renderPager(1, 1, 50), '<div class="tablenav"><div class="tablenav-pages"><span class="displaying-num">1 entry</span></div></div>');
  const html = renderPager(198, 2, 50, { label: PAGER_LABELS.bottom, href: (n) => `?tag=a&page=${n}` });
  assert.match(html, /aria-label="Publication pages \(bottom\)"/);
  assert.match(html, /<span class="paging-input">2 of 4<\/span>/);
  assert.match(html, /href="\?tag=a&amp;page=3" data-page="3" title="next page" aria-label="Next page"/);
  assert.match(renderPager(198, 99, 50), /4 of 4/);
  assert.match(renderPager(10, 1, 0), /10 entries/);
});
