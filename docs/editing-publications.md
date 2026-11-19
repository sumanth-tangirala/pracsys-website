# Editing publications

A guide for Prof. Bekris and anyone else who keeps the lab's paper list up to date. No coding needed.

| You want to… | Go to |
| --- | --- |
| Open the editor | https://www.sumanthtangirala.com/pracsys-website/admin/ (or click **Lab admin** at the bottom of any page) |
| Publish your changes | https://github.com/sumanth-tangirala/pracsys-website/upload/main/data |
| Check that the site updated | https://github.com/sumanth-tangirala/pracsys-website/actions |

## How it works

- All papers are kept in one file, `publications.bib`, stored on GitHub.
- The editor changes that list **in your browser only**. You see your changes on the site as a preview; nobody else does.
- To make them public, you download the updated file and upload it to GitHub. The site rebuilds itself in about two minutes.

You need an editor account (username and password; ask Sumanth) and, to publish, a GitHub account that has been given write access to the repository.

## 1. Sign in

1. Open the editor and enter your username (yours is `kbekris`) and password.
2. On your own computer, tick **Keep me signed in on this device for 14 days**. Otherwise you are signed out after 8 hours.
3. After 5 wrong passwords the form locks for one minute.

To change your password, use **Account → Change password**. The new password works right away on that computer. To use it on other computers too, send the block of text the page shows you to a student (it is a scrambled form of the password, safe to share).

## 2. Add a paper

1. Click **Add publication**.
2. Fill in the form. These fields matter most:

   | Field | What to enter |
   | --- | --- |
   | Type | *Proceedings Article* for conference papers, *Journal Article* for journals, etc. |
   | Title | The paper title. |
   | Authors | One per line, in order. See "Writing author names" below. |
   | Year | Four digits, e.g. `2026`. Decides which year heading the paper sits under. |
   | Date | The conference or publication date. Decides the order within the year (see below). |
   | Conference / book title (or Journal) | The venue, e.g. `IEEE International Conference on Robotics and Automation (ICRA)`. |
   | Location | City and country, shown after the venue. |
   | Status | *Published*, or *Forthcoming*, *Accepted*, etc. (see FAQ). |
   | Tags | Decide which project pages list the paper (see below). |
   | Links | arXiv, PDF, project page, video, code. One per line. |
   | DOI | Just the DOI, e.g. `10.1109/ICRA.2012.6224582`. |
   | Abstract | Optional. Adds an "Abstract" button under the paper. |
   | Note | Optional. Shown in brackets after the year, e.g. `Best Paper Award`. |
   | Citation key | Filled in for you. Leave it alone. |

3. Check the right-hand side of the page while you type:
   - **Preview** shows the paper exactly as it will look on the site.
   - **Appears on** lists every page that will show it (Papers, project pages, member pages).
   - **Checks** shows problems. Red items must be fixed before you can save; yellow items are advice.
4. Click **Save** (or **Save & add another**). The paper now appears under **Pending changes**.

Shortcuts: to start from an existing paper (for example the journal version of a conference paper), click the copy icon next to it in **Publications**. If you already have a BibTeX entry for a single paper, click **Edit as BibTeX**, paste it over the text, and click **Apply to form**.

### Writing author names

Write each author as **first initial, a space, last name, with no full stops**: `K Bekris`, `S Tangirala`, `R Kramer-Bottiglio`.

This matters because each member's page lists the papers whose author list contains their name in exactly this form. `Kostas Bekris`, `K. Bekris` or `K E Bekris` will **not** appear on the member page. The editor warns you when a name is written differently from other papers. Follow its advice.

### Tags and project pages

| Tag | Project page that lists the paper |
| --- | --- |
| `Manipulation` | Vision-driven and Learned Manipulation |
| `Planning` | Planning |
| `Perception` | Perception |
| `Soft-Robots` | Soft Robots |
| `Verification` | Verification of Robot Control |
| `Dynamics` | None on its own. The Dynamics page shows a hand-picked list; ask a student to add a paper there. |

A paper can have several tags. Other tags (e.g. `Learning`, `Estimation`) only work as filters on the Papers page. Spell tags exactly as above, or tick the existing tag buttons rather than typing new ones.

### How papers are ordered

- Lists are **newest first**, grouped under **Year** headings.
- Inside a year, papers are ordered by **Date**. A paper without a date counts as 1 January and drops to the bottom of its year.
- If the date and the year disagree, the editor warns you.

## 3. Edit or delete a paper

1. Click **Publications**, type a few words of the title in the search box, and click the title.
2. Make your changes and click **Save**.
3. To delete, click **Delete** on the paper's page (or the bin icon in the list). Until you publish, you can bring it back from **Pending changes → Restore**.
4. To undo your edits to one paper, click **Revert to live version**, or use **Revert** in **Pending changes**.

## 4. Import BibTeX from Google Scholar, DBLP or Overleaf

1. Copy the BibTeX:
   - **Google Scholar:** click **Cite** (the quotation mark) under the paper, then **BibTeX**, and copy the text.
   - **DBLP:** click the download arrow next to the paper, choose **BibTeX**, and copy the text.
   - **Overleaf:** open your project's `.bib` file and copy the entries you want.
   You can paste many entries at once.
2. In the editor, click **Import BibTeX** and paste the text (or drop a `.bib` file on the box).
3. Optionally type a tag in **Add a tag to every imported entry** (e.g. `Planning`).
4. Click **Review import**. Each entry is marked *New*, *Updates existing*, *Already identical* or *Cannot import*. Untick anything you don't want. If an entry says **Same title as existing**, it is probably a duplicate: untick it.
5. Click **Import**.
6. **Tidy each imported paper.** Scholar and DBLP give full names (e.g. `Kostas E. Bekris`), so open each new paper and rewrite the authors as `K Bekris`. If DBLP has put a number after a name (e.g. `0001`), delete it. Also add the Date, Tags and Links, which these sites leave out.

## 5. Preview on the site

1. Click **View site** at the top of the editor, or open any page of the site **in the same browser**.
2. A yellow bar at the bottom says *Preview: this page includes N unpublished publication changes*. The Papers page, project pages and member pages include your changes.
3. Click **Hide preview** to see what the public sees, and **Show preview** to switch back.

Only you can see the preview, and only in this browser.

## 6. Publish

1. In the editor, click **Export & publish → Download publications.bib**.
2. Make sure the downloaded file is named exactly `publications.bib`. If your browser saved it as `publications (1).bib`, rename it.
3. Click **Open GitHub upload page** (sign in to GitHub if asked) and drag the file onto the page.
4. In the box under it, optionally describe the change (e.g. `Add ICRA 2027 papers`). Leave **Commit directly to the main branch** selected and click **Commit changes**. This replaces the old file.
5. Wait about two minutes. On the [Actions page](https://github.com/sumanth-tangirala/pracsys-website/actions), a yellow dot means it is still working, a green tick means it is live, and a red cross means it was stopped (see section 7).
6. Open the editor again. It notices that your changes are live, clears them from **Pending changes**, and the yellow bar goes away.

**Option without downloading:** click **Copy to clipboard**, then **Or paste into the file editor**. On GitHub, select all the old text, paste, and click **Commit changes**.

## 7. If GitHub finds an error in the file

Before publishing, GitHub checks that the file can be read: braces match, no two papers share a citation key, every paper has a title. If the check fails, **the update is stopped and the live site stays exactly as it was.** Nothing breaks.

1. You'll see a red cross on the Actions page, and GitHub usually emails you.
2. Click the failed run, then **build**, then the step **Run npm test**. It names the problem and the line, e.g. `Unbalanced braces (line 3035)`.
3. Your edits are still in the editor, because they stay pending until they are live. Fix the problem there, download the file again and upload it again.
4. If it isn't clear what went wrong, forward the email to a student.

A file downloaded from the editor normally passes. Errors usually come from editing the file by hand on GitHub or uploading a different file.

## 8. Working from two computers

Pending changes are stored in **one browser on one computer**, not in your account.

- **Simplest:** publish before you switch computers.
- **To move unpublished work:** on the first computer, click **Export & publish → Backup of everything (.json)**. On the second computer, sign in, open **Import BibTeX**, choose that `.json` file, then **Review import → Import**. Only your new and edited papers show up as changes.
- **Deletions do not travel** in the backup. Delete those papers again on the second computer.
- **Two people editing at the same time:** if someone else published while you were working, reload the editor before you download the file. Otherwise your upload can undo their changes.
- Clearing your browser history/data or using a private window loses pending changes. Make a JSON backup if you stop halfway.

## FAQ

**I don't see my change.**
- Have you published yet? Until then, only your browser shows it (with the yellow bar).
- Wait two minutes and look for a green tick on the Actions page.
- Reload with **Cmd-Shift-R** (Mac) or **Ctrl-Shift-R** (Windows). Browsers can keep the old list for up to 10 minutes.
- Was the uploaded file named exactly `publications.bib`? A file called `publications (1).bib` is ignored.
- On the Papers page but not on a student's page? An author name is written differently (e.g. `Sumanth Tangirala` instead of `S Tangirala`).
- Not on a project page? It is missing the tag.
- Your own member page doesn't list papers; it would list all of them. Use the Papers page filtered by author instead: `/papers/?author=Bekris%2C%20K`.
- For a new student's very first paper, the publication list on their page appears only after you publish, not in the preview.

**How do I mark a paper as forthcoming?**
Set **Status** to *Forthcoming*. The year in the citation is replaced by "Forthcoming", and a label appears next to the title. Still fill in the Year (and the Date if you know it) so the paper is listed in the right place. Without a year it goes to the bottom under "Undated". When it comes out, set Status back to *Published* and add the pages, DOI and so on. *Accepted*, *Submitted*, *In press*, *In review* and *Preprint* work the same way.

**How do I show an award?**
Type it in **Note**, e.g. `Best Paper Award` or `Nomination for Best Paper Award`. It appears in brackets after the year.

**How do I add a PDF, project page, code or video link?**
Put each link on its own line in **Links**. To give it a label, add a comma and the label: `https://example.org/paper.pdf, PDF` or `https://example.org/project, Project page`. PDF, arXiv, GitHub and YouTube links get their own icons. Clicking the paper's title opens its links. The DOI goes in the **DOI** field. The editor cannot upload files: link to arXiv or the publisher, or send the PDF to a student to put on the site.

**I made a mistake.**
Before publishing, use **Pending changes → Revert** (or **Discard all**). After publishing, fix it in the editor and publish again, or ask a student to undo the change on GitHub.

**Can I share a filtered list?**
Yes. Filters on the Papers page update the web address. Copy it, e.g. `/papers/?tag=Planning&author=Bekris%2C%20K`.

**Who can change the site?**
Anyone can open the editor page, but it asks for a password. The real protection is GitHub: only people with write access to the repository can change the live site.
