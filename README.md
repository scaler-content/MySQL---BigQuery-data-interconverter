# MySQL ⇄ BigQuery Converter

Static, browser-only tool. Drop in a ZIP, download the converted ZIP.

- **BigQuery → MySQL:** ZIP of `.csv` files (one per table) → ZIP with one `.sql` file
- **MySQL → BigQuery:** ZIP containing a `.sql` dump → ZIP of `.csv` files + `schema/<table>.json`

## Host on GitHub Pages
1. Put `index.html` and `converter.js` in a repo (root).
2. Settings → Pages → Deploy from branch → `main` / `(root)`.
3. Open `https://<user>.github.io/<repo>/`.

`leela_palace_bigquery_to_mysql.py` is the original hardcoded script; the web tool replaces it for any dataset.
