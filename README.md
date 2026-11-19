# PRACSYS Lab website

A static rebuild of [pracsys.cs.rutgers.edu](https://pracsys.cs.rutgers.edu/) — Prof. Kostas Bekris' robotics group at Rutgers — that runs on GitHub Pages with no server, plus a browser-based **publication editor** so the lab can add and update papers without touching code.

- **Live site:** https://www.sumanthtangirala.com/pracsys-website/
- **Publication editor:** https://www.sumanthtangirala.com/pracsys-website/admin/

## Documentation

- [Editing publications](docs/editing-publications.md): for the PI and editors. Sign in, add, import and publish papers, plus an FAQ.
- [Publication data review](docs/publication-data-review.md): errors in the imported teachPress data worth fixing (all left as they were on the old site).
- [Maintaining the site](docs/maintaining-the-site.md): for students. Members, news, projects, site settings, editor accounts, hosting, and how the editor works under the hood.

## What's here

| Path | What it is |
| --- | --- |
| `data/publications.bib` | **The list of publications.** The single source of truth for the Papers page, project pages and member pages (originally the teachPress export). |
| `src/_data/site.json` | Navigation, hero text, contact details, footer links. |
| `src/_data/members.json` | Current members (team grid + member pages) and alumni. |
| `src/_includes/bios/*.html` | The text of each member page. |
| `src/_data/projects.json` | Project pages: titles, images, and which papers each lists (by tag). |
| `src/_includes/projects/*.html` | Project page descriptions. |
| `src/news/posts/` | News posts (kept at their original URLs, e.g. `/2019/03/08/456/`). |
| `src/pages/` | Other pages: datasets, libraries, gallery, openings, seminar, courses… |
| `src/uploads/` | Images and media mirrored from the WordPress site. |
| `src/admin/` | The publication editor page and its account list. |
| `src/assets/js/lib/` | BibTeX parser and the teachPress-style renderer, shared by the build and the browser. |

Built with [Eleventy](https://www.11ty.dev/) — templates are plain HTML/Nunjucks.

## Updating publications (for the lab)

1. Open **`/admin/`** and sign in.
2. Add, edit, delete or bulk-import papers. Edits are saved in your browser and every page of the site shows them to you as a preview (look for the yellow bar at the bottom).
3. Go to **Export & publish** → *Download publications.bib*.
4. Click *Open GitHub upload page*, drop the file into `data/`, and commit.
5. GitHub Actions validates the file and redeploys in ~2 minutes. Your pending list clears itself once the changes are live.

Where a paper appears:

- **Papers** — all of them, newest first by `date`, grouped by `year`.
- **Project pages** — by tag (`keywords`): Manipulation, Verification, Soft-Robots, Perception, Planning. The Dynamics page lists a fixed set of papers, as on the old site; change `filter` in `src/_data/projects.json` to `{ "tags": ["Dynamics"] }` to make it tag-based.
- **Member pages** — by author name (`authors` in `src/_data/members.json`, e.g. `Tangirala, S`), matched on last name + first initial, so `S Tangirala`, `Sumanth Tangirala` and `Tangirala, S.` all count. The lab convention is still `S Tangirala`; the editor offers a one-click fix for other spellings.

To publish, an editor needs **write access to this GitHub repository** (Settings → Collaborators).

### About sign-in

The site is static, so the sign-in runs in the browser against salted PBKDF2 hashes in `src/admin/users.json`. It keeps the editor out of casual view but it is **not** a security boundary: anyone could read the JavaScript, and nothing they do leaves their own browser. Real protection comes from GitHub — only people with write access to this repository can change the live site.

Add or reset an editor account:

```sh
node scripts/hash-password.mjs <username> "Full Name" [admin|editor]
git add src/admin/users.json && git commit -m "Update editor accounts"
```

Default accounts (change these): `kbekris` and `stangirala`, password `praxis-2026`.

When a backend exists, replace `src/assets/js/store.js` (data) and `src/assets/js/admin/auth.js` (sign-in); the editor UI only talks to those two modules.

## Development

```sh
npm install
npm start          # http://localhost:8080 with live reload
npm run validate   # check data/publications.bib (CI runs this before deploying)
npm test           # code tests, run against a frozen copy of the data in tests/fixtures/
npm run build      # outputs _site/
```

`site.noindex` in `src/_data/site.json` is `true` while this is a staging copy, so search engines don't index it alongside the official site. Set it to `false` when this becomes the lab's real site.

`PATH_PREFIX` sets the base URL. CI uses `/<repo-name>/` for the GitHub Pages project URL. If the site moves to a custom domain served from `/`, set a repository variable `PATH_PREFIX` to `/`.

## Notes on the migration

- Content, images and URLs follow the WordPress site, including the old news permalinks and `/members/…`, `/projects/…` paths.
- A few broken links on the old site now point to working pages: the footer's *Openings* links (the old `robotics.cs.rutgers.edu` page is offline; its text, from the Internet Archive, is at `/openings/`), the *Projects* page tiles, and the sidebar's *Map* link (the Contact section now has a map).
- Old teachPress filter links (`/papers/?tgid=2&auth=189&yr=2024#tppubs`) still work: they are translated to the new readable filters, e.g. `/papers/?tag=Learning&author=Granados%2C%20E`. Old WordPress URLs (`/portfolio/…`, `/category/pracsys-news/`, `/kevin-chen/`) redirect to their new pages.
- Images and links that pointed at the offline `robotics.cs.rutgers.edu` server were recovered from the Internet Archive where a copy exists, or replaced with local thumbnails.
