# Publication data: things worth fixing

An automated review of `data/publications.bib` (198 entries, exported from teachPress) found the issues below. **None of them were changed** — the list on the new site matches the old one exactly. Fix them in the [publication editor](https://www.sumanthtangirala.com/pracsys-website/admin/) when convenient; search for the key in the Publications list. The editor's dashboard also lists the most common problems under **Data checks**.

## Shows incorrectly on the site today

| Problem | Entries | Fix |
| --- | --- | --- |
| No year or date — listed under "Undated" at the very bottom | `Dobson:2014ac` (arXiv 1404.2166) | Year 2014, date 2014-04-08 |
| Venue stored in a field the type doesn't display, so the venue line is blank | `Hodan:2018aa`, `Kimmel:2016aa` (article with only a booktitle) | Change type to Proceedings Article |
| | `Kimmel:2013aa` (venue in *school*) | Proceedings Article, move text to *Conference / book title* |
| | `Azizi:2017aa` (venue in *journal*) | Move it to *Conference / book title* |
| | `Sivaramakrishnan:2019aa` (tech report with venue in *school*) | Workshop with a book title |
| | `Dobson:2012aa`, `Kimmel:2012aa` (MS theses without school) | Add *School* |
| | `Wang:2021aa` (book chapter without book title) | Add the book title |
| Page numbers stored as *chapter*, so they never show | `distributed_kinodynamic`, `Plaku:2005aa`, `Argyros:2005aa`, `Ladd:2004aa` | Move the value to *Pages* |
| Award text printed twice ("[Best Paper Award] [Best Paper Award]") | `Dobson:2017aa`, `172`, `Krontiris:2015ab` (also has volume "1123"); `Vieira:2024aa` has it inside *Location* | Put the award in *Note* only (like `Wen:2022ab`) |
| Same person written two ways (split in the author filter) | "A Dobson A." in `Dobson:2014aa`; "Frederick H." in `Motwani:2010aa`; "D K Grady" vs "D Grady" | "A Dobson"; check Frederick C. Harris → "F Harris"; pick one Grady |
| Duplicate paper | `Dobson:2013aa` and `Dobson:2013ab` (same IROS 2013 paper) | Merge the DOI/pages into one, delete the other |
| Wrong link | `Alterovitz:2018aa` links to an unrelated IJRR article (its DOI is right); author list may be incomplete | Remove the link, check authors |
| Dead links (404) | `Dobson:2014aa`, `DBLP:conf/socs/LunaB11` (old aaai.org/ocs), first link of `granados2025kinodynamic` | Replace with arXiv/DOI or the project home page |
| Status out of date | `McMahon:2022aa` is still *Forthcoming*; `Bekris:2015aa` has volume "(accepted)" | Set to Published, add volume/pages |
| ISBN stored as ISSN | `Kallmann:2012aa` | Move to *ISBN* |
| Status value "published, manipulation" | `Gao:2022aa` | Set Status to Published (the tag belongs in Tags) |
| Acronyms lower-cased by teachPress | `Lu:2023aa` (Ovir-3d, 3d), `Lu:2022aa` (6n-Dof), `Wen:2021aa` (Bundletrack, 6d, 3d), `Wen:2020ab`, `Mitash:2020aa`, `Mitash:2018aa`, `Hodan:2018aa` (6d), `Motwani:2010aa` (3d), `Wang:2023aa` (Real2sim2real), `Feng:2021aa` (Ariac) | Fix the capitalisation in the title |
| No link at all (title isn't clickable) | `mpc_gnn_iros26`, `multi_robot_ordered_storage_retrieval`, `granados_factor_graph_tensegrity`, `Li:2023aa`, `Vieira:2023aa`, `Lu:2022aa`, `Wang:2022aa`, `Morgan:2021aa`, `Wang:2020aa`, `Motwani:2010aa` | Add arXiv / PDF / DOI links |

## Consistency (cosmetic)

- **Conference vs. proceedings article:** 93 entries are *Conference* and 45 are *Proceedings Article*, often for the same venue (ICRA appears as both). The type filter on the Papers page splits them, and only Proceedings Articles get the "In:" prefix. Pick one.
- **Venue spellings:** ICRA is written 9 ways, IROS 10, ISRR 6, RA-L 5. Typos: "Robotics and Automatics" (`Nakhimovich:2023aa`), "IEEE/RJS" (`Bekris:2003aa`, `Ladd:2002aa`), "Symosium" (`Littlefield:2017aa`), "Robotic Research" (`Littlefield:2015aa`), "Sienna" → Siena (`Akinc:2003aa`).
- **Placeholder dates:** 38 entries use January 1, so they sort to the bottom of their year.
- **Old links:** 67 links use `http://www.cs.rutgers.edu/~kb572/…`; they redirect fine but could be updated to `https://people.cs.rutgers.edu/~kb572/…`.
- **Possible duplicates to confirm:** `Luna:2011ab` / `DBLP:conf/socs/LunaB11`; `Krontiris:2014ab` (arXiv) / `Krontiris:2014aa`.
- **Leftover DBLP fields:** 11 entries have a `crossref` pointing to nothing; remove it under *More fields*.
