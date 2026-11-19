/**
 * /data/publications.json — the published publication set, consumed by the
 * interactive lists and by the admin editor (which layers local edits on top).
 */
export const data = {
  permalink: '/data/publications.json',
  eleventyExcludeFromCollections: true,
};

export function render({ publications, env }) {
  const entries = [...publications]
    .sort((a, b) => a.order - b.order)
    .map((p) => ({ type: p.entryType, key: p.key, fields: p.fields }));
  return JSON.stringify({ generated: env.buildTime, count: entries.length, entries });
}
