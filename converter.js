/* Core conversion logic: BigQuery (CSV per table) <-> MySQL (.sql dump).
   Pure functions, no DOM, so it runs in the browser and in Node for tests. */
(function (root) {
  "use strict";

  /* ---------------------------------------------------------------- CSV */

  /** nullTokens (optional): unquoted fields equal to one of these become null. */
  function parseCSV(text, nullTokens) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [], field = "", inQ = false, quoted = false;
    const end = () => {
      row.push(!quoted && nullTokens && nullTokens.indexOf(field) >= 0 ? null : field);
      field = ""; quoted = false;
    };
    const n = text.length;
    for (let i = 0; i < n; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') { inQ = true; quoted = true; }
      else if (c === ",") end();
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        end();
        rows.push(row); row = [];
      } else field += c;
    }
    if (field !== "" || quoted || row.length) { end(); rows.push(row); }
    // drop fully blank trailing lines
    while (rows.length && rows[rows.length - 1].every((v) => v === "" || v === null)) rows.pop();
    return rows;
  }

  function csvField(v, nullText) {
    if (v === null || v === undefined) return nullText || "";
    v = String(v);
    if (nullText && v === nullText) return '"' + v + '"';
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function toCSV(header, rows, nullText) {
    const out = [header.map((h) => csvField(h)).join(",")];
    for (const r of rows) out.push(r.map((v) => csvField(v, nullText)).join(","));
    return out.join("\n") + "\n";
  }

  /* ------------------------------------------- BigQuery CSV  ->  MySQL */

  const RE_INT = /^-?(0|[1-9]\d*)$/;
  const RE_DEC = /^-?(\d+\.\d+|\.\d+|\d+\.)$|^-?(0|[1-9]\d*)$/;
  const RE_EXP = /^-?(\d+\.?\d*|\.\d+)[eE][+-]?\d+$/;
  const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const RE_DT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?( ?(UTC|Z))?$/;
  const RE_TIME = /^\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

  function inferColumn(values) {
    const vals = values.filter((v) => v !== "");
    const maxLen = vals.reduce((m, v) => Math.max(m, v.length), 0);
    if (!vals.length) return { type: "VARCHAR(255)", kind: "str" };

    const all = (re) => vals.every((v) => re.test(v));
    if (vals.every((v) => /^(true|false)$/i.test(v))) return { type: "TINYINT(1)", kind: "bool" };
    if (all(RE_INT) && maxLen <= 18) {
      const big = vals.some((v) => Math.abs(Number(v)) > 2147483647);
      return { type: big ? "BIGINT" : "INT", kind: "num" };
    }
    if (all(RE_DEC) && maxLen <= 30) {
      let maxInt = 1, maxScale = 0;
      for (const v of vals) {
        const [a, b = ""] = v.replace("-", "").split(".");
        maxInt = Math.max(maxInt, a.length);
        maxScale = Math.max(maxScale, b.length);
      }
      return { type: `DECIMAL(${Math.min(65, maxInt + maxScale + 4)},${maxScale})`, kind: "num" };
    }
    if (vals.every((v) => RE_DEC.test(v) || RE_EXP.test(v))) return { type: "DOUBLE", kind: "num" };
    if (all(RE_DATE)) return { type: "DATE", kind: "str" };
    if (all(RE_DT)) {
      const frac = vals.some((v) => /\.\d/.test(v));
      return { type: frac ? "DATETIME(6)" : "DATETIME", kind: "dt" };
    }
    if (all(RE_TIME)) return { type: vals.some((v) => /\./.test(v)) ? "TIME(6)" : "TIME", kind: "str" };

    if (maxLen > 16777215) return { type: "LONGTEXT", kind: "str" };
    if (maxLen > 65535) return { type: "MEDIUMTEXT", kind: "str" };
    if (maxLen > 255) return { type: "TEXT", kind: "str" };
    const size = [20, 50, 100, 255].find((s) => maxLen <= s);
    return { type: `VARCHAR(${size})`, kind: "str" };
  }

  const qid = (s) => "`" + String(s).replace(/`/g, "``") + "`";
  const qstr = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";

  function sqlValue(v, col) {
    if (v === "" || v === undefined) return "NULL";
    switch (col.kind) {
      case "bool": return /^true$/i.test(v) ? "1" : "0";
      case "num": return v;
      case "dt": return qstr(v.replace(/ ?(UTC|Z)$/, "").replace(/^(\d{4}-\d{2}-\d{2})T/, "$1 "));
      default: return qstr(v);
    }
  }

  /** files: [{name, text}] (CSV files). Returns {sql, tables:[{name, rows, cols}]}. */
  function bigqueryToMysql(files, label) {
    const tables = [];
    for (const f of files) {
      const rows = parseCSV(f.text);
      if (!rows.length) continue;
      const header = rows[0].map((h) => h.trim());
      const data = rows.slice(1).map((r) => {
        const x = r.slice(0, header.length);
        while (x.length < header.length) x.push("");
        return x;
      });
      const cols = header.map((name, i) => ({ name, ...inferColumn(data.map((r) => r[i])) }));
      // primary key: first *id column that is unique and never empty
      const first = data.length ? 0 : -1;
      let pk = -1;
      if (first === 0 && /(^|_)id$/i.test(header[0]) && cols[0].type.indexOf("TEXT") < 0) {
        const seen = new Set(data.map((r) => r[0]));
        if (seen.size === data.length && !seen.has("")) pk = 0;
      }
      tables.push({ name: f.name, header, data, cols, pk });
    }

    const out = [
      `-- ${label || "Data"} — MySQL schema + data`,
      "-- Converted from BigQuery CSV export\n",
      "SET NAMES utf8mb4;",
      "SET FOREIGN_KEY_CHECKS=0;\n",
    ];
    for (const t of tables) out.push(`DROP TABLE IF EXISTS ${qid(t.name)};`);
    out.push("");
    for (const t of tables) {
      const defs = t.cols.map((c, i) => `  ${qid(c.name)} ${c.type}${i === t.pk ? " NOT NULL" : " NULL"}`);
      if (t.pk >= 0) defs.push(`  PRIMARY KEY (${qid(t.cols[t.pk].name)})`);
      out.push(`CREATE TABLE ${qid(t.name)} (\n${defs.join(",\n")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n`);
    }
    const CHUNK = 500;
    for (const t of tables) {
      if (!t.data.length) continue;
      out.push(`-- ${t.name}: ${t.data.length} rows`);
      const colList = t.cols.map((c) => qid(c.name)).join(", ");
      for (let i = 0; i < t.data.length; i += CHUNK) {
        const vals = t.data.slice(i, i + CHUNK).map(
          (r) => "  (" + r.map((v, j) => sqlValue(v, t.cols[j])).join(", ") + ")"
        );
        out.push(`INSERT INTO ${qid(t.name)} (${colList}) VALUES\n${vals.join(",\n")};\n`);
      }
    }
    out.push("SET FOREIGN_KEY_CHECKS=1;\n");
    return {
      sql: out.join("\n"),
      tables: tables.map((t) => ({ name: t.name, rows: t.data.length, cols: t.cols.length })),
    };
  }


  /* ------------------------------ CSV <-> CSV (NULL text, booleans 1/0) */

  const NULL_TOKENS = ["NULL", "\\N"];

  function readCsvTable(f, nullTokens) {
    const rows = parseCSV(f.text, nullTokens);
    if (!rows.length) return null;
    const header = rows[0].map((h) => String(h).trim());
    const data = rows.slice(1).map((r) => {
      const x = r.slice(0, header.length);
      while (x.length < header.length) x.push(nullTokens ? null : "");
      return x;
    });
    return { name: f.name, header, data };
  }

  /** BigQuery CSVs -> MySQL CSVs: empty -> NULL, " UTC" dropped. Everything else (booleans included) is kept as-is. */
  function bigqueryToMysqlCsv(files) {
    const outFiles = [], tables = [];
    for (const f of files) {
      const t = readCsvTable(f, null);
      if (!t) continue;
      const out = t.data.map((r) => r.map((v) =>
        v.trim() === "" ? null
          : v.replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?) ?(UTC|Z)$/, "$1")));
      outFiles.push({ name: f.name + ".csv", text: toCSV(t.header, out, "NULL") });
      tables.push({ name: t.name, rows: out.length, cols: t.header.length });
    }
    return { files: outFiles, tables };
  }

  /** MySQL CSVs -> BigQuery CSVs: NULL/\N -> empty. Values (booleans included) are kept as-is. */
  function mysqlCsvToBigquery(files) {
    const outFiles = [], tables = [];
    for (const f of files) {
      const t = readCsvTable(f, NULL_TOKENS);
      if (!t) continue;
      const out = t.data.map((r) => r.map((v) =>
        v === null || /^0000-00-00/.test(v) ? "" : v));
      outFiles.push({ name: f.name + ".csv", text: toCSV(t.header, out) });
      tables.push({ name: t.name, rows: out.length, cols: t.header.length });
    }
    return { files: outFiles, tables };
  }

  /** Is a set of CSVs MySQL-style ("mysql") or BigQuery-style ("bq")? null if unclear. */
  function detectCsvFlavor(files) {
    let nulls = 0, bools = 0;
    for (const f of files) {
      for (const r of parseCSV(f.text, NULL_TOKENS).slice(1)) {
        for (const v of r) {
          if (v === null) nulls++;
          else if (/^(true|false)$/.test(v)) bools++;
        }
      }
      if (nulls) return "mysql";
    }
    return bools ? "bq" : null;
  }

  /* ------------------------------------------- MySQL dump  ->  BigQuery */

  /** Split a dump into statements, ignoring comments and respecting quotes. */
  function splitStatements(sql) {
    const stmts = [];
    let buf = "", seg = 0, i = 0;
    const n = sql.length;
    const flush = (end) => { buf += sql.slice(seg, end); };
    while (i < n) {
      const c = sql[i];
      if (c === "'" || c === '"' || c === "`") {
        i++;
        while (i < n) {
          if (sql[i] === "\\" && c !== "`") i += 2;
          else if (sql[i] === c) { if (sql[i + 1] === c) i += 2; else break; }
          else i++;
        }
        i++;
      } else if (c === "#" || (c === "-" && sql[i + 1] === "-" && /\s/.test(sql[i + 2] || "\n"))) {
        flush(i);
        const e = sql.indexOf("\n", i);
        i = e < 0 ? n : e;
        seg = i;
      } else if (c === "/" && sql[i + 1] === "*") {
        flush(i);
        const e = sql.indexOf("*/", i + 2);
        i = e < 0 ? n : e + 2;
        seg = i;
      } else if (c === ";") {
        flush(i);
        if (buf.trim()) stmts.push(buf.trim());
        buf = ""; i++; seg = i;
      } else i++;
    }
    flush(n);
    if (buf.trim()) stmts.push(buf.trim());
    return stmts;
  }

  /** Split on commas that are not inside parentheses or quotes. */
  function splitTopLevel(s) {
    const parts = [];
    let depth = 0, cur = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "'" || c === '"' || c === "`") {
        let j = i + 1;
        while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1;
        cur += s.slice(i, j + 1); i = j; continue;
      }
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (c === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += c;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  }

  const unq = (s) => s.trim().replace(/^[`"]|[`"]$/g, "");

  const ESC = { 0: "\0", b: "\b", n: "\n", r: "\r", t: "\t", Z: "\x1a" };

  /** Parse the tuples after VALUES into arrays (null for SQL NULL). */
  function parseTuples(s, pos) {
    const rows = [];
    const n = s.length;
    while (pos < n) {
      while (pos < n && s[pos] !== "(") pos++;
      if (pos >= n) break;
      pos++;
      const row = [];
      for (;;) {
        while (pos < n && /\s/.test(s[pos])) pos++;
        let val;
        if (s[pos] === "'" || s[pos] === '"') {
          const q = s[pos++];
          let out = "";
          while (pos < n) {
            const c = s[pos];
            if (c === "\\") {
              const e = s[pos + 1];
              out += e in ESC ? ESC[e] : e;
              pos += 2;
            } else if (c === q) {
              if (s[pos + 1] === q) { out += q; pos += 2; } else { pos++; break; }
            } else { out += c; pos++; }
          }
          val = out;
        } else {
          let depth = 0, start = pos;
          while (pos < n && !(depth === 0 && (s[pos] === "," || s[pos] === ")"))) {
            if (s[pos] === "(") depth++;
            if (s[pos] === ")") depth--;
            pos++;
          }
          const raw = s.slice(start, pos).trim();
          if (/^_\w+$/.test(raw)) continue; // charset introducer like _binary 'x'
          val = /^null$/i.test(raw) ? null : raw;
        }
        row.push(val);
        while (pos < n && /\s/.test(s[pos])) pos++;
        if (s[pos] === ",") { pos++; continue; }
        if (s[pos] === ")") { pos++; break; }
        break;
      }
      rows.push(row);
    }
    return rows;
  }

  function bqType(mysqlType) {
    const t = mysqlType.toLowerCase();
    if (/^(tinyint\(1\)|bool|boolean|bit\(1\))/.test(t)) return "BOOL";
    if (/^(tinyint|smallint|mediumint|int|integer|bigint|year)/.test(t)) return "INT64";
    if (/^(decimal|numeric|dec|fixed)/.test(t)) return "NUMERIC";
    if (/^(float|double|real)/.test(t)) return "FLOAT64";
    if (/^datetime/.test(t)) return "DATETIME";
    if (/^timestamp/.test(t)) return "TIMESTAMP";
    if (/^date/.test(t)) return "DATE";
    if (/^time/.test(t)) return "TIME";
    if (/^json/.test(t)) return "JSON";
    if (/(blob|binary)/.test(t)) return "BYTES";
    return "STRING";
  }

  function bqValue(v, type) {
    if (v === null || v === undefined) return "";
    if (type === "BOOL") return v === "1" ? "TRUE" : v === "0" ? "FALSE" : v;
    if ((type === "DATE" || type === "DATETIME" || type === "TIMESTAMP") && /^0000-00-00/.test(v)) return "";
    return v;
  }

  const bqName = (s) => {
    const x = s.replace(/[^A-Za-z0-9_]/g, "_");
    return /^[0-9]/.test(x) ? "_" + x : x;
  };

  /** Returns {files:[{name,text}], tables:[{name,rows,cols}]}. */
  function mysqlToBigquery(sql) {
    const tables = new Map(); // name -> {cols:[{name,mysql,type}], rows:[]}
    const get = (name) => {
      if (!tables.has(name)) tables.set(name, { cols: [], rows: [], map: null });
      return tables.get(name);
    };

    for (const st of splitStatements(sql)) {
      let m = /^CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:`[^`]+`|[\w$]+)(?:\.(?:`[^`]+`|[\w$]+))?)\s*\(/i.exec(st);
      if (m) {
        const name = unq(m[1].split(".").pop());
        const open = m[0].length;
        let depth = 1, end = open;
        for (; end < st.length && depth; end++) {
          const c = st[end];
          if (c === "'" || c === '"' || c === "`") {
            let j = end + 1;
            while (j < st.length && st[j] !== c) j += st[j] === "\\" ? 2 : 1;
            end = j; continue;
          }
          if (c === "(") depth++;
          if (c === ")") depth--;
        }
        const body = st.slice(open, end - 1);
        const t = get(name);
        t.cols = [];
        for (const def of splitTopLevel(body)) {
          const d = def.trim();
          if (/^(PRIMARY|KEY|UNIQUE|CONSTRAINT|FOREIGN|INDEX|FULLTEXT|SPATIAL|CHECK)\b/i.test(d)) continue;
          const cm = /^(`[^`]+`|"[^"]+"|[\w$]+)\s+([A-Za-z]+(?:\s*\([^)]*\))?)/.exec(d);
          if (cm) t.cols.push({ name: unq(cm[1]), mysql: cm[2], type: bqType(cm[2]) });
        }
        continue;
      }
      m = /^INSERT\s+(?:IGNORE\s+)?INTO\s+((?:`[^`]+`|[\w$]+)(?:\.(?:`[^`]+`|[\w$]+))?)\s*(\([^)]*\))?\s*VALUES\b/i.exec(st);
      if (m) {
        const name = unq(m[1].split(".").pop());
        const t = get(name);
        const given = m[2] ? m[2].slice(1, -1).split(",").map(unq) : null;
        if (!t.cols.length && given) given.forEach((g) => t.cols.push({ name: g, mysql: "text", type: "STRING" }));
        const rows = parseTuples(st, m[0].length);
        for (const r of rows) {
          if (!t.cols.length) for (let i = 0; i < r.length; i++) t.cols.push({ name: "col" + (i + 1), mysql: "text", type: "STRING" });
          let out = r;
          if (given) {
            const idx = new Map(given.map((g, i) => [g, i]));
            out = t.cols.map((c) => (idx.has(c.name) ? r[idx.get(c.name)] : null));
          }
          t.rows.push(out);
        }
      }
    }

    const files = [], summary = [];
    for (const [name, t] of tables) {
      if (!t.cols.length) continue;
      const header = t.cols.map((c) => bqName(c.name));
      const rows = t.rows.map((r) => t.cols.map((c, i) => bqValue(r[i], c.type)));
      files.push({ name: `${bqName(name)}.csv`, text: toCSV(header, rows) });
      files.push({
        name: `schema/${bqName(name)}.json`,
        text: JSON.stringify(t.cols.map((c, i) => ({ name: header[i], type: c.type, mode: "NULLABLE" })), null, 2) + "\n",
      });
      summary.push({ name, rows: rows.length, cols: t.cols.length });
    }
    return { files, tables: summary };
  }

  const api = { parseCSV, toCSV, inferColumn, bigqueryToMysql, mysqlToBigquery, splitStatements,
    bigqueryToMysqlCsv, mysqlCsvToBigquery, detectCsvFlavor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Converter = api;
})(typeof self !== "undefined" ? self : this);
