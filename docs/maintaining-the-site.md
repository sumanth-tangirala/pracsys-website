# Maintaining the site

For lab members who look after the website. You need git and Node 20 or later. For day-to-day paper edits, see [editing-publications.md](editing-publications.md). Most publication work happens in the browser editor, not here.

## Project layout

| Path | What it holds |
| --- | --- |
| `data/publications.bib` | Every publication. The only source for the Papers, project and member lists. |
| `src/_data/site.json` | Nav, hero, contact, footer, `noindex`, GitHub repo/branch used by the editor. |
| `src/_data/members.json` | Current members (`current`), Members-page grouping (`groups`), alumni (`alumni`). |
| `src/_data/projects.json` | Project pages and which papers each lists. |
| `src/_data/redirects.json` | Old URL → new URL pairs (rendered by `src/redirects.njk`). |
| `src/_data/publications.js` | Parses the `.bib` at build time. Fails the build on malformed entries. |
| `src/_includes/bios/<slug>.html` | Body text of each member page. |
| `src/_includes/projects/<slug>.html` | Description at the top of each project page. |
| `src/_includes/layouts/`, `partials/` | Page shells (`base`, `page`, `post`), header, footer, sidebar. |
| `src/index.njk` | Home page (hero, team grid, software, projects, contact). |
| `src/members/`, `src/projects/`, `src/papers/` | Templates that generate member, project and paper pages. |
| `src/news/posts/` | News posts. `src/news/index.njk` is the `/news/` list. |
| `src/pages/` | Stand-alone pages (datasets, libraries, gallery, openings, seminar, courses…). |
| `src/uploads/` | Images and media, served at `/uploads/…`. |
| `src/admin/` | Editor page (`index.njk`) and accounts (`users.json`). |
| `src/assets/js/lib/` | BibTeX parser (`bibtex.js`) and renderer (`publications.js`), shared by the build and the browser. |
| `src/assets/js/store.js`, `publist.js`, `site.js` | Browser data store, interactive lists, preview banner. |
| `src/assets/js/admin/` | The editor app (`app.js` router, `auth.js`, `editor.js`, `import.js`, `views.js`, `model.js`, `ui.js`). |
| `src/data-publications.11ty.js` | Writes `/data/publications.json` for the browser. |
| `scripts/hash-password.mjs` | Adds or resets editor accounts. |
| `tests/publications.test.js` | Parser/renderer tests. CI runs them before every deploy. |
| `.github/workflows/deploy.yml` | Build and deploy to GitHub Pages on every push to `main`. |

## Running locally

```sh
npm install
npm start              # http://localhost:8080 with live reload; editor at /admin/
npm test               # BibTeX parsing/rendering tests
npm run build          # _site/ for serving at /
npm run build:pages    # _site/ with the /pracsys-website/ prefix, as CI builds it
```

The editor works on `localhost` over plain http. Anywhere else it needs https, because browsers only allow the sign-in crypto there. Pending edits made on `localhost:8080` are stored apart from the ones made on the live site.

**Deploying:** push to `main`. The workflow runs `npm ci`, `npm test` and the build, then publishes `_site/`. If the tests or the build fail, nothing is deployed. To redeploy without a change, use *Actions → Build and deploy site → Run workflow*.

## Members

### Add a member

1. Put a square photo (about 300×300) under `src/uploads/`, following the existing `src/uploads/<year>/<month>/` folders, e.g. `src/uploads/2024/12/`.
2. Add an entry to `current` in `src/_data/members.json`. Its position in the array sets the order in the home-page team grid.

   ```json
   {
     "slug": "jane-doe",
     "name": "Jane Doe",
     "title": "Jane Doe",
     "position": "PhD Student",
     "group": "phd",
     "photo": "/uploads/2026/09/jane-doe.jpg",
     "authors": ["Doe, J"],
     "links": { "website": "https://janedoe.github.io/" },
     "note": "Co-advising with Dr. X",
     "showPublications": true,
     "gridLinks": ["website"],
     "current": true
   }
   ```

   | Field | Used for |
   | --- | --- |
   | `slug` | URL `/members/<slug>/` and the bio file name. |
   | `name` / `title` | Name in the grid and lists / heading of the member page. |
   | `position` | Shown under the name in the grid. |
   | `photo` | Grid photo. Root-relative `/uploads/…` path (no `src/`, no prefix). |
   | `authors` | Names in `Last, F` form whose papers appear on the member page (see below). |
   | `showPublications` | `false` hides the list (used for Prof. Bekris, whose page would list everything). |
   | `links` + `gridLinks` | URLs, and which of them show as icons on the grid photo. Only `website`, `linkedin` and `email` render. |
   | `note` | Shown after the name on `/members/`, e.g. co-advisor. |
   | `group`, `current` | Kept for reference. No template reads them today. |

3. Add the slug to the right `groups[].slugs` list in the same file. That list drives `/members/` and its order.
4. Create `src/_includes/bios/jane-doe.html` (photo, links, a few paragraphs). See `src/_includes/bios/sumanth-tangirala.html`. **The file must exist**, even empty. Without it the build fails with `template not found: bios/jane-doe.html`.
5. Run `npm start` and check `/`, `/members/` and `/members/jane-doe/`, then commit and push.

**`authors` matching.** A paper author written `J Doe` (or `Doe, J`) is displayed as `Doe, J`, and that must equal an entry in `authors`. Matching ignores case and accents but nothing else: `Jane Doe`, `J. Doe` and `J A Doe` do not match. List each variant that appears in the `.bib` if there are several, e.g. `["Bekris, K", "Bekris, K E"]`. A member page only gets a publication list if at least one paper matches when the site is built.

### Remove a member or move them to alumni

1. Delete their entry from `current` **and** their slug from `groups[].slugs`. A leftover slug renders an empty bullet on `/members/`.
2. Delete `src/_includes/bios/<slug>.html` (optional).
3. Add them to the right `alumni` group (see below).
4. Keep their old URL working by adding `{ "from": "/members/<slug>/", "to": "/members/" }` to `src/_data/redirects.json`.
5. Search for hard-coded links: `grep -rn "members/<slug>" src`. The landing page `src/papers/the-state-of-robot-motion-generation.njk` links to several members.

### Add an alumnus

Append to the `people` list of a group in `alumni` (`PostDoc`, `Ph.D. Students`, `MS Students with Thesis`, `Undergraduates`):

```json
{ "name": "Jane Doe", "url": "https://janedoe.github.io/", "note": "Joined Example Robotics upon completion" }
```

`url` may be `""`. A `note` that starts with `(` is printed after a space, e.g. `(Fall 2023 – Spring 2024)`. Any other note follows a colon. For custom markup, give `"html"` instead of `name`/`url`/`note` (one MS entry does this).

## News posts

Create `src/news/posts/YYYY-MM-DD-<slug>.html`. Markdown (`.md`) works too.

```yaml
---
title: "PRACSYS papers at ICRA 2027"
date: 2027-05-20
permalink: /2027/05/20/icra-2027/
image: "/uploads/2027/05/icra-300x150.jpg"
excerpt: "One-sentence summary shown on the News page."
tags: news
layout: layouts/post.njk
---
<p>Post body…</p>
```

| Field | Notes |
| --- | --- |
| `date` | Sorts the posts and is shown on the post. |
| `permalink` | `/YYYY/MM/DD/<slug>/`. Imported posts keep their WordPress IDs (e.g. `/2019/03/08/456/`); don't change those. New posts use a short slug. |
| `image` | Thumbnail on `/news/` (300×150), or `""` for none. |
| `excerpt` | Summary text on `/news/`. |
| `tags: news` | Required. This puts the post in the News list, prev/next links and the "Recent News" sidebar. |
| `layout` | Always `layouts/post.njk`. |

News isn't in the top nav. It is reached via `/news/`.

## Project pages

1. Add an entry to `src/_data/projects.json`. Array order = order of the home-page tiles and `/projects/`.

   | Field | Used for |
   | --- | --- |
   | `slug` | URL `/projects/<slug>/` and the description file name. |
   | `title` | Page heading. Also how the editor's "Appears on" names the page. |
   | `cardTitle` + `thumb` | Home-page tile (thumb is 300×194). |
   | `listTitle` + `listImage` | Tile on `/projects/`. |
   | `cover` | Header background of the project page. |
   | `filter` | Which papers are listed (below). |
   | `filterNote` | Free-text comment for maintainers. Not rendered. |

2. Choose the filter:
   - `{ "tags": ["Learning"] }`: papers with any of these tags (case-insensitive). The PI controls these from the editor.
   - `{ "keys": ["Bekris:2012aa", "..."] }`: a fixed list of citation keys, as on the Dynamics page.
   - Both together: only papers that match **both** (key in the list and tag present).
3. Create `src/_includes/projects/<slug>.html`. **Required**, even empty, or the build fails with `template not found`.
4. After deploy, the editor highlights the new project tag and includes the page in "Appears on". It reads `projects.json` from the build.

To rename a tag, change `keywords` on every paper (edit `data/publications.bib`, or re-import entries with the same keys in the editor) **and** update `projects.json`.

## Site settings (`src/_data/site.json`)

| Key | Where it shows |
| --- | --- |
| `title`, `description` | Browser titles, meta/OpenGraph description. |
| `logo`, `favicon`, `appleIcon` | Header logo and icons. The editor hard-codes the logo path in `src/assets/js/admin/app.js`, and `base.njk` hard-codes the 192px icon. Update those too. |
| `nav` | Top menu. |
| `hero` | Home banner: `image`, `logo`, `tagline`, `subtitle`, `buttons` (`style` is `danger`/`info`). |
| `software`, `cta` | Home "Software" icons and the "All Members" banner. |
| `contact` | Home Contact section and map (`mapQuery`). The email is split into `emailUser`/`emailDomain` to deter scrapers. |
| `openings`, `funding`, `affiliations`, `copyright` | Footer columns and bottom line. The "About Pracsys" text is in `src/_includes/partials/footer.njk`. |
| `url` | Absolute site URL, used in `/sitemap.xml`. |
| `repo`, `branch` | The editor's GitHub links (upload page, file editor, Actions). Update them if the repo moves. |
| `noindex` | `true` adds `<meta name="robots" content="noindex">` to every page. |

## Editor accounts

| Task | How |
| --- | --- |
| Add or reset an account | `node scripts/hash-password.mjs <username> "Full Name" [admin\|editor]`, enter a password (8+ characters), then commit `src/admin/users.json`. Running it for an existing username replaces that account's password. |
| Non-interactive | `ADMIN_PASSWORD='…' node scripts/hash-password.mjs <username> "Full Name"` |
| Remove an account | Delete its object from `src/admin/users.json` and commit. |
| User changed password in the browser | *Account* shows a JSON record. Replace that user's entry in `users.json` with it. |
| Let someone publish | Add them as a collaborator with write access on GitHub (*Settings → Collaborators*). |

`role` is only displayed; admins and editors can do the same things. The default accounts and password are listed in `README.md`. Change them. `users.json` is public (served at `/admin/users.json`), so use passwords that aren't used anywhere else. The sign-in only hides the editor: write access on GitHub is the real gate.

## URLs, `PATH_PREFIX` and hosting

Templates use root-relative links (`/papers/`, `/uploads/…`). At build time, Eleventy's HTML base plugin prefixes them with `PATH_PREFIX` (default `/`), and browser code reads the same value from `window.PRACSYS_BASE` via `siteBase()` in `store.js`. Never hard-code `/pracsys-website/`. URLs inside inline CSS need the `htmlBaseUrl` filter (see `cover` in `src/_includes/layouts/page.njk`).

| Move to… | Steps |
| --- | --- |
| A custom domain on GitHub Pages (served from `/`) | 1. Repo *Settings → Secrets and variables → Actions → Variables*: add `PATH_PREFIX` = `/`. 2. *Settings → Pages → Custom domain*, and point DNS at GitHub. No `CNAME` file is needed for Actions deploys. 3. Set `url` in `site.json`. 4. Push or re-run the workflow. |
| A different repo or org | Transfer the repo, set `repo`/`branch` in `site.json`, set *Settings → Pages → Source* to *GitHub Actions*. The default prefix becomes `/<new-repo-name>/`. |
| Rutgers or any static host | `PATH_PREFIX=/ npm run build` (or the subfolder, e.g. `PATH_PREFIX=/pracsys/`), then upload the **contents** of `_site/`. The host must serve https (the editor needs it). Point its 404 page at `/404.html` (Apache: `ErrorDocument 404 /404.html`). Redirects are plain HTML pages and work anywhere. |

The editor's publish flow always ends in a GitHub commit. If the site is hosted somewhere other than GitHub Pages, every commit must be followed by a rebuild and re-upload. Do it by hand, or add an rsync/SFTP step with repository secrets to `deploy.yml`.

**When this becomes the official site:** set `noindex` to `false` (the editor page stays noindex), update `url`, change the default passwords, redirect the old WordPress site, and optionally submit `/sitemap.xml` to Google Search Console.

## How publications and the preview work

```
data/publications.bib
 └─ src/_data/publications.js        parse (throws on malformed entries) → `publications`
     ├─ {% publist %} shortcode       eleventy.config.js: pre-renders page 1 of each list (works without JS)
     └─ src/data-publications.11ty.js → /data/publications.json
browser
 site.js     preview banner; loads publist.js when a .tp-publist is on the page
 publist.js  paging, filters, URL sync, re-render with pending edits
 store.js    fetches publications.json and merges this browser's pending edits
 lib/        the same parser and renderer as the build, so markup is identical
```

- **Overlay.** Editor changes live in `localStorage` under `pracsys.publications.overlay.v1` as `{ version: 1, startedAgainst, changes: { <key>: { op: "upsert" | "delete", at, user, entry?, renamedFrom?, renamedTo? } } }`. `entries()` applies them to the published set. Tabs stay in sync through the `storage` event and the `pracsys:publications-changed` event.
- **Preview.** If the overlay is non-empty, `site.js` shows the yellow banner (not on `/admin/`), and each list fetches the data and re-renders with the overlay. *Hide preview* sets `pracsys.preview.off` in `sessionStorage`.
- **Pruning.** When the editor loads, it fetches `publications.json` with `no-cache` and drops overlay changes that already match the live data. Public pages use normal caching: GitHub Pages sends `max-age=600`.
- **Export.** `exportBibtex()` sorts the merged set newest first and writes it in teachPress field order. `exportJson()` is the cross-computer backup. Importing it only upserts, so deletions don't carry over.
- **Limits.** The preview can only update lists that the build rendered. A member with `showPublications: false`, or with no matching paper at build time, has no list to update.
- Old teachPress links (`/papers/?tgid=…&auth=…`) are translated in `publist.js` using `src/assets/js/teachpress-ids.json`.
- If you change `src/assets/js/lib/`, add a case to `tests/publications.test.js`.

## Swapping in a real backend

The editor UI talks to data and identity only through two modules.

**`src/assets/js/store.js`.** `getStore()` returns an object with: `load({ fresh })`, `published`, `publishedVersion`, `entries({ includeOverlay })`, `publications()`, `get(key)`, `has(key)`, `statusOf(key)` (`published`/`new`/`edited`/`deleted`), `upsert(entry, { previousKey, user })`, `remove(key, { user })`, `revert(key)`, `discardAll()`, `prune()`, `changes()`, `changeCount`, `exportBibtex({ onlyChanged })`, `exportJson()`, `onChange(fn)`. Other modules also import `siteBase`, `readOverlay`, `previewDisabled`, `setPreviewDisabled`, `CHANGE_EVENT` and `entriesEqual`.

**`src/assets/js/admin/auth.js`.** Exports `signIn(username, password, { remember })`, `currentUser()` (returns `{ username, name, role, expiresAt }` or `null`), `signOut()`, `lockRemaining()`, `loadUsers()`, `changePassword(current, next)` and `hasLocalPasswordOverride(username)`.

Suggested path:
1. **Publishing:** add a small server or serverless function that holds a GitHub token and commits `data/publications.bib` through the GitHub contents API. CI still validates and deploys, and the public site stays static. Then replace the manual upload steps in `renderExport()` (`src/assets/js/admin/views.js`) with a *Publish* button.
2. **Store:** write a class with the methods above and return it from `getStore()`. Writes are **synchronous** today: `editor.js`, `import.js` and `views.js` call `upsert`/`remove`/`revert`/`discardAll` without `await`. Either keep a local optimistic copy and sync in the background, or make them async and add `await` at those call sites.
3. **Auth:** back `auth.js` with a real identity provider. GitHub OAuth is a natural fit, since repo write access already decides who may publish. Then drop `src/admin/users.json`, its passthrough in `eleventy.config.js`, and `scripts/hash-password.mjs`.
