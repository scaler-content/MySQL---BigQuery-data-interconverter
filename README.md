# MySQL ⇄ BigQuery Converter

Static, browser-only tool. Drop in a ZIP, download the converted ZIP.

- **BigQuery CSVs → MySQL CSVs:** empty → `NULL`, `TRUE/FALSE` → `1/0`, ` UTC` dropped
- **MySQL CSVs → BigQuery CSVs:** `NULL` / `\N` → empty; `is_` / `has_` columns holding only 1/0 → `TRUE/FALSE`
- **MySQL `.sql` dump → BigQuery CSVs** (plus `schema/<table>.json`) also works

## Host on GitHub Pages
1. Put `index.html` and `converter.js` in a repo (root).
2. Settings → Pages → Deploy from branch → `main` / `(root)`.
3. Open `https://<user>.github.io/<repo>/`.

`leela_palace_bigquery_to_mysql.py` is the original hardcoded script; the web tool replaces it for any dataset.
