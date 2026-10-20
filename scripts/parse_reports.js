/*
 * reports/ 폴더의 PDF(산업활동동향·수출입동향·소비자물가동향)를 읽어 data/reports.json에 반영해요.
 * GitHub Actions(.github/workflows/parse-reports.yml)가 PDF가 올라올 때마다 실행해요.
 * 로컬 실행: npm install pdfjs-dist@2.16.105 && node scripts/parse_reports.js
 */
const fs = require("fs");
const path = require("path");
let pdfjs; try { pdfjs = require("pdfjs-dist/build/pdf.js"); } catch (_) { pdfjs = require("pdfjs-dist/legacy/build/pdf.js"); }
const P = require("./report_parser.js");

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "reports");
const OUT = path.join(ROOT, "data", "reports.json");

async function pdfText(file, maxPages) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const n = Math.min(doc.numPages, maxPages || doc.numPages), pages = [];
  for (let p = 1; p <= n; p++) {
    const pg = await doc.getPage(p), tc = await pg.getTextContent(), rows = {};
    tc.items.forEach(it => { if (!it.str || !it.str.trim()) return; const y = Math.round(it.transform[5] / 3); (rows[y] = rows[y] || []).push(it); });
    const lines = Object.keys(rows).map(Number).sort((a, b) => b - a)
      .map(y => rows[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(" ").replace(/\s+/g, " ").trim());
    pages.push(`[p${p}]\n` + lines.join("\n"));
  }
  return pages.join("\n");
}

(async () => {
  let data = { ip: {}, trade: {}, cpi: {}, tp: {} };
  try { data = Object.assign(data, JSON.parse(fs.readFileSync(OUT, "utf8"))); } catch (_) {}
  if (!fs.existsSync(DIR)) { console.log("reports 폴더가 없어요"); return; }
  const files = fs.readdirSync(DIR).filter(f => /\.pdf$/i.test(f)).sort();
  let ok = 0;
  for (const f of files) {
    const full = path.join(DIR, f);
    try {
      const head = await pdfText(full, 3);
      const d = P.detect(head);
      if (!d.type || d.type === "tp") { console.log(`· ${f}: 지원하지 않는 보고서`); continue; }
      const text = await pdfText(full, P.maxPages[d.type] || 30);
      const res = P.parse(text);
      data[res.type] = data[res.type] || {};
      data[res.type][res.month] = res.rec;
      ok++;
      console.log(`✓ ${f} → ${res.type} ${res.month}`);
    } catch (e) {
      console.log(`· ${f}: 분석 실패 (${e.message})`);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(data));
  console.log(`완료: ${ok}/${files.length}개 반영`);
})();
