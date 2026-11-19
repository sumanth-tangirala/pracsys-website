# PRACSYS Lab website

A static rebuild of [pracsys.cs.rutgers.edu](https://pracsys.cs.rutgers.edu/) — Prof. Kostas Bekris' robotics group at Rutgers — that runs on GitHub Pages with no server, plus a browser-based **publication editor** so the lab can add and update papers without touching code.

- **Live site:** https://sumanth-tangirala.github.io/pracsys-website/
- **Publication editor:** https://sumanth-tangirala.github.io/pracsys-website/admin/

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
- **Member pages** — by author name, e.g. `S Tangirala` (listed in `authors` in `src/_data/members.json`). Write names the same way on every paper.

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
npm test           # BibTeX parsing/rendering tests (also run in CI)
npm run build      # outputs _site/
```

`PATH_PREFIX` sets the base URL. CI uses `/<repo-name>/` for the GitHub Pages project URL. If the site moves to a custom domain served from `/`, set a repository variable `PATH_PREFIX` to `/`.

## Notes on the migration

- Content, images and URLs follow the WordPress site, including the old news permalinks and `/members/…`, `/projects/…` paths.
- A few broken links on the old site now point to working pages: the footer's *Openings* links (the old `robotics.cs.rutgers.edu` page is offline; its text, from the Internet Archive, is at `/openings/`), the *Projects* page tiles, and the sidebar's *Map* link (the Contact section now has a map).
- The old site's `#tppubs` filter URLs (`?tgid=…&auth=…`) use internal teachPress IDs and aren't supported; the new Papers page uses readable ones, e.g. `/papers/?tag=Planning&author=Bekris%2C%20K`.
