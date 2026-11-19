#!/usr/bin/env node
/**
 * Check data/publications.bib before it is deployed.
 *
 *   node scripts/validate-publications.mjs [path/to/file.bib]
 *
 * Errors (exit code 1, the deploy stops and the live site stays as it was):
 *   - BibTeX that cannot be parsed
 *   - an entry without a citation key, or a key used twice
 *   - an entry without a title
 *   - an empty file
 * Warnings (printed, deploy continues): missing year, unknown type, etc.
 *
 * This deliberately does not test *content* (how many papers, which ones),
 * so ordinary edits from the publication editor can never block a deploy.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBibtexWithErrors } from '../src/assets/js/lib/bibtex.js';
import { TYPES } from '../src/assets/js/lib/publications.js';

const file = process.argv[2] || fileURLToPath(new URL('../data/publications.bib', import.meta.url));
let text;
try {
  text = readFileSync(file, 'utf8');
} catch (err) {
  console.error(`✖ Cannot read ${file}: ${err.message}`);
  process.exit(1);
}

const errors = [];
const warnings = [];
const { entries, errors: parseErrors } = parseBibtexWithErrors(text);
for (const e of parseErrors) errors.push(`Syntax: ${e.message}`);
if (!entries.length) errors.push('The file contains no publications.');

const seen = new Map();
for (const e of entries) {
  const label = e.key || `(entry with title "${String(e.fields.title || '').slice(0, 60)}")`;
  if (!e.key) errors.push(`${label}: missing citation key.`);
  else if (seen.has(e.key)) errors.push(`${e.key}: citation key is used twice.`);
  else seen.set(e.key, true);
  if (!String(e.fields.title || '').trim()) errors.push(`${label}: missing title.`);
  const type = String(e.fields.tppubtype || e.type).toLowerCase();
  if (!TYPES[type]) warnings.push(`${label}: unknown type "${type}" (shown as Miscellaneous).`);
  const year = String(e.fields.year || '').trim();
  const forthcoming = /forthcoming/i.test(String(e.fields.pubstate || ''));
  if (!/^\d{4}$/.test(year) && !forthcoming) warnings.push(`${label}: no four-digit year (listed under "Undated").`);
  if (e.fields.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.fields.date).trim())) warnings.push(`${label}: date "${e.fields.date}" is not YYYY-MM-DD.`);
}

for (const w of warnings) console.warn(`⚠ ${w}`);
if (errors.length) {
  console.error(`\n✖ ${file} has ${errors.length} problem(s) that would break the site:`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nThe deploy was stopped; the live site is unchanged. Fix the file (or re-export it from the publication editor) and commit again.');
  process.exit(1);
}
console.log(`✔ ${entries.length} publications OK${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}.`);
