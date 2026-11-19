import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBibtexWithErrors } from '../assets/js/lib/bibtex.js';
import { publicationsFromEntries } from '../assets/js/lib/publications.js';

/**
 * All publications, parsed from data/publications.bib (the single source of
 * truth). Sorted newest first. Parse problems fail the build loudly so a bad
 * upload from the admin editor never silently drops papers.
 */
export default function () {
  const path = fileURLToPath(new URL('../../data/publications.bib', import.meta.url));
  const { entries, errors } = parseBibtexWithErrors(readFileSync(path, 'utf8'));
  if (errors.length) {
    throw new Error(`data/publications.bib has ${errors.length} malformed entr${errors.length === 1 ? 'y' : 'ies'}:\n`
      + errors.map((e) => `  - ${e.message}`).join('\n'));
  }
  return publicationsFromEntries(entries);
}
