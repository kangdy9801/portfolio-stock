/*
 * 경제 보고서 PDF 파서 (산업활동동향 · 수출입동향 · 소비자물가동향)
 * - 브라우저(index.html)와 GitHub Actions(scripts/parse_reports.js)가 같은 코드를 써요.
 * - 입력: pdf.js로 뽑은 텍스트. 페이지마다 "[pN]" 줄로 시작하고, 같은 높이의 글자를 한 줄로 이어 붙인 형태.
 * - 외부 서비스나 AI 없이 정해진 표·문장 패턴만으로 숫자를 읽어요.
 */
(function (root) {
  "use strict";

  /* ───────── 공통 도구 ───────── */
  // 한글 사이 공백 제거("광 공 업" → "광공업"), 가운뎃점·세모 통일
  function norm(s) {
    return String(s || "")
      .replace(/[‧ㆍ･・]/g, "·")
      .replace(/△[ \t]*/g, "-")
      .replace(/([가-힣])[ \t]+(?=[가-힣])/g, "$1");
  }
  const compact = s => norm(s).replace(/\s+/g, "");
  const lines = t => norm(t).split("\n").map(x => x.trim()).filter(Boolean);
  function nums(s) {
    const out = [];
    String(s).replace(/(^|[^\d.])(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)/g, (m, pre, n) => { out.push(parseFloat(n.replace(/,/g, ""))); return m; });
    return out;
  }
  const r1 = v => (v == null || !isFinite(v)) ? null : Math.round(v * 10) / 10;
  const pad = n => String(n).padStart(2, "0");
  function monthsEnding(m, n) {
    let [y, mm] = m.split("-").map(Number); const out = [];
    for (let k = n - 1; k >= 0; k--) { let yy = y, m2 = mm - k; while (m2 <= 0) { m2 += 12; yy--; } out.push(`${yy}-${pad(m2)}`); }
    return out;
  }
  const signed = (v, word) => (v == null ? null : (/감소|하락/.test(word || "") ? -Math.abs(v) : v));
  function released(t) {
    const m = compact(t.slice(0, 3000)).match(/보도시점(\d{4})\.(\d{1,2})\.(\d{1,2})/);
    return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
  }
  const fmt = (v, d = 1) => v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + "%";

  /* ───────── 종류·기준월 판별 ───────── */
  function detect(text) {
    const head = compact(text.slice(0, 6000));
    let m = head.match(/(\d{4})년(\d{1,2})월(산업활동동향|소비자물가동향|수출입물가|수출입동향)/);
    let type = null;
    if (m) type = m[3] === "산업활동동향" ? "ip" : m[3] === "소비자물가동향" ? "cpi" : m[3] === "수출입물가" ? "tp" : "trade";
    else type = /산업활동동향/.test(head) ? "ip" : /소비자물가동향/.test(head) ? "cpi" : /수출입동향/.test(head) ? "trade" : null;
    return { type, month: m ? `${m[1]}-${pad(m[2])}` : null };
  }

  /* ───────── 산업활동동향 ───────── */
  // 요약의 작은 표: "’25. 8 -0.1 0.2 / ’26. 5 -0.4 1.9 / 6 2.6 4.5 ..." → [{m, mom, yoy}]
  function summaryBlock(L, title) {
    for (let i = 0; i < L.length; i++) if (compact(L[i]) === title) { const r = summaryBlockAt(L, i); if (r.length >= 2) return r; }
    return [];
  }
  function summaryBlockAt(L, i) {
    let year = null; const rows = [];
    for (let k = i + 1; k < Math.min(L.length, i + 16); k++) {
      const l = L[k];
      if (/^-\s*\d+\s*-$/.test(l) || /^□/.test(l) || /^\[p\d+\]/.test(l)) break;
      if (/^p$/.test(l) || /전월비/.test(l)) continue;
      let m = l.match(/^[’‘']\s*(\d{2})\s*\.\s*(\d{1,2})\s+(-?[\d.]+)\s+(-?[\d.]+)$/);
      if (m) { year = 2000 + +m[1]; rows.push({ m: `${year}-${pad(m[2])}`, mom: +m[3], yoy: +m[4] }); continue; }
      m = l.match(/^(\d{1,2})\s*p?\s+(-?[\d.]+)\s+(-?[\d.]+)$/);
      if (m && year) { rows.push({ m: `${year}-${pad(m[1])}`, mom: +m[2], yoy: +m[3] }); continue; }
      if (rows.length && !/^[\d’‘'p]/.test(l)) break;
    }
    // 연도가 바뀌는 경우(12월 → 1월) 보정
    for (let k = 1; k < rows.length; k++) if (rows[k].m < rows[k - 1].m && !/^\d{4}-01$/.test(rows[k].m)) {
      const [y, mm] = rows[k].m.split("-"); rows[k].m = `${+y + 1}-${mm}`;
    }
    return rows;
  }
  function moverPairs(s) {
    const out = []; const re = /([가-힣A-Za-z·\d]+?)\(\s*(-?[\d.]+)\s*%?\s*\)/g; let m; const c = compact(s).replace(/^[.․·]?(증가|감소):?/, "");
    while ((m = re.exec(c))) out.push({ name: m[1].replace(/^(증가|감소):?/, ""), v: +m[2] });
    return out;
  }
  function parseIP(text, month) {
    const L = lines(text), C = compact(text);
    const rec = { month, released: released(text), source: `국가데이터처 ${+month.slice(0, 4)}년 ${+month.slice(5)}월 산업활동동향` };
    const blk = {
      all: summaryBlock(L, "전산업생산"), mining: summaryBlock(L, "광공업생산"), service: summaryBlock(L, "서비스업생산"),
      retail: summaryBlock(L, "소매판매"), facility: summaryBlock(L, "설비투자"), construction: summaryBlock(L, "건설기성(불변)")
    };
    const last = (arr) => { const x = arr.find(r => r.m === month) || arr[arr.length - 1]; return x ? { mom: x.mom, yoy: x.yoy } : null; };
    rec.headline = {};
    Object.keys(blk).forEach(k => { const v = last(blk[k]); if (v) rec.headline[k] = v; });
    // 제조업·공공행정: 전산업생산지수 표 (전월(기)비 → 동월(기)비 순서)
    const idx = L.findIndex((l, k) => compact(l).startsWith("전산업생산지수") && L.slice(k, k + 5).some(x => /전월\(기\)비/.test(compact(x))));
    if (idx >= 0) {
      let mode = null;
      for (let k = idx; k < Math.min(L.length, idx + 40); k++) {
        const c = compact(L[k]);
        if (/전월\(기\)비/.test(c)) mode = "mom";
        if (/동월\(기\)비/.test(c)) mode = "yoy";
        const m = c.match(/^(광공업|제조업|건설업|서비스업|공공행정)(-?[\d.].*)$/);
        if (m && mode) {
          const v = nums(L[k].replace(/^[^\d-]+/, "")); const val = v[v.length - 1];
          const key = { 광공업: "mining", 제조업: "manu", 건설업: "construction", 서비스업: "service", 공공행정: "public" }[m[1]];
          rec.headline[key] = rec.headline[key] || {};
          if (rec.headline[key][mode] == null) rec.headline[key][mode] = val;
        }
        if (mode === "yoy" && /^1\)|^-\d+-$/.test(c)) break;
      }
    }
    // 수주
    const ord = {};
    let m = C.match(/\(국내기계수주\)(.{0,120}?)전년동월대비(-?[\d.]+)%(증가|감소)/);
    if (m) {
      ord.machinery_yoy = signed(+m[2], m[3]);
      const pub = m[1].match(/공공\((-?[\d.]+)%\)/), pri = m[1].match(/민간\((-?[\d.]+)%\)/), both = m[1].match(/공공및민간\)?\((-?[\d.]+)%\)\((-?[\d.]+)%\)/);
      if (pub) ord.public_yoy = +pub[1]; if (pri) ord.private_yoy = +pri[1];
      if (both) { ord.public_yoy = +both[1]; ord.private_yoy = +both[2]; }
    }
    m = C.match(/\(건설수주(?:경상)?\)(.{0,120}?)전년동월대비(-?[\d.]+)%(증가|감소)/) || C.match(/건설수주.{0,10}?\)(.{0,120}?)전년동월대비(-?[\d.]+)%(증가|감소)/);
    if (m) ord.construction_yoy = signed(+m[2], m[3]);
    rec.orders = ord;
    // 경기종합지수
    const cyc = {}, ccSeries = {};
    ["동행지수순환변동치", "선행지수순환변동치"].forEach(key => {
      const i = L.findIndex(l => compact(l).startsWith(key));
      if (i < 0) return;
      const lv = nums(L[i].slice(L[i].indexOf("치") + 1)); const ch = nums(L[i + 1] || "");
      const o = { level: lv[lv.length - 1], chg: ch[ch.length - 1] };
      if (key[0] === "동") { cyc.coincident = o; const ms = monthsEnding(month, ch.length); ch.forEach((v, k) => ccSeries[ms[k]] = v); }
      else cyc.leading = o;
    });
    rec.cycle = cyc;
    m = C.match(/제조업평균가동률은([\d.]+)%로전월대비([\d.]+)%p(상승|하락)/);
    if (m) rec.utilization = { rate: +m[1], chg: signed(+m[2], m[3]) };
    m = C.match(/제조업재고는전월대비([\d.]+)%(증가|감소),전년동월대비([\d.]+)%(증가|감소)/);
    if (m) rec.inventory = { mom: signed(+m[1], m[2]), yoy: signed(+m[3], m[4]) };
    // 출하
    const sh = {};
    m = C.match(/□제조업출하는.{0,80}?전월대비([\d.]+)%(증가|감소).{0,10}?전년동월대비로는.{0,80}?([\d.]+)%(증가|감소)/);
    if (m) sh.total = { mom: signed(+m[1], m[2]), yoy: signed(+m[3], m[4]) };
    m = C.match(/내수출하는전월대비([\d.]+)%(증가|감소),수출출하는전월대비([\d.]+)%(증가|감소)/);
    const m2 = C.match(/전년동월대비로는내수출하는([\d.]+)%(증가|감소),수출출하는([\d.]+)%(증가|감소)/);
    if (m) { sh.domestic = { mom: signed(+m[1], m[2]) }; sh.export = { mom: signed(+m[3], m[4]) }; }
    if (m2) { sh.domestic = Object.assign(sh.domestic || {}, { yoy: signed(+m2[1], m2[2]) }); sh.export = Object.assign(sh.export || {}, { yoy: signed(+m2[3], m2[4]) }); }
    rec.shipment = sh;
    // 수출출하 증감 업종
    const ex = L.findIndex(l => compact(l).includes("<수출전월대비주요증감업종>"));
    if (ex >= 0) {
      const up = [], down = []; let mode = null;
      for (let k = ex + 1; k < Math.min(L.length, ex + 6); k++) {
        const c = compact(L[k]);
        if (/증가/.test(c)) mode = "up"; if (/감소/.test(c)) mode = "down";
        if (/^</.test(c) && k > ex + 1) break;
        moverPairs(L[k]).forEach(p => (mode === "down" ? down : up).push(`${p.name}(${p.v > 0 ? "+" : ""}${p.v}%)`));
        if (!moverPairs(L[k]).length && mode) { const names = c.replace(/^.*?(증가|감소):?/, "").replace(/등$/, "").split(/,/).filter(x => /[가-힣]/.test(x)); if (names.length > 1) names.forEach(n => (mode === "down" ? down : up).push(n)); }
      }
      rec.exportMovers = { up: up.slice(0, 4), down: down.slice(0, 4) };
    }
    // 서비스업 업종별 (전년동월비 표) + 전월비 주요 증감업종
    const svIdx = L.findIndex(l => compact(l) === "다.서비스업");
    const svc = [];
    if (svIdx >= 0) {
      for (let k = svIdx; k < Math.min(L.length, svIdx + 60); k++) {
        const l = L[k];
        const mm = l.match(/^-\s*([가-힣·\s]+?)\s+(-?[\d.]+(?:\s+-?[\d.]+){3,})$/);
        if (mm) { const v = nums(mm[2]); svc.push({ name: compact(mm[1]), mom: null, yoy: v[v.length - 1] }); }
        if (svc.length && /^-\s*\d+\s*-$/.test(l)) break;
      }
      const mi = L.findIndex((l, k) => k > svIdx && compact(l).includes("<전월대비주요증감업종>"));
      if (mi >= 0) for (let k = mi + 1; k < mi + 6; k++) { if (/전년동월대비/.test(compact(L[k] || ""))) break; moverPairs(L[k] || "").forEach(p => { const s = svc.find(x => x.name === compact(p.name)); if (s) s.mom = p.v; }); }
    }
    rec.serviceSectors = svc;
    // 소매판매 재화별
    const rt = { 내구재: {}, 준내구재: {}, 비내구재: {} };
    const rsIdx = C.indexOf("(소매판매)");
    if (rsIdx >= 0) {
      const seg = C.slice(rsIdx, rsIdx + 400);
      const cut = seg.indexOf("전년동월대비로는");
      const a = seg.slice(0, cut), b = seg.slice(cut, cut + 250);
      const grab = (s, key) => { const re = new RegExp("(?:^|[^준비])" + (key === "내구재" ? "내구재" : key) + "\\((-?[\\d.]+)%\\)"); const x = s.match(key === "내구재" ? /(?<![준비])내구재\((-?[\d.]+)%\)/ : re); return x ? +x[1] : null; };
      Object.keys(rt).forEach(k => { rt[k].mom = grab(a, k); rt[k].yoy = grab(b, k); });
      if (/준내구재는보합/.test(a)) rt.준내구재.mom = 0;
    }
    rec.retailTypes = Object.entries(rt).map(([name, v]) => ({ name, mom: v.mom, yoy: v.yoy }));
    // 업종별 생산·출하·재고 통계표
    let ti = -1; L.forEach((l, k) => { if (compact(l).includes("광공업업종별생산.출하.재고증감률")) ti = k; });
    const ind = [];
    if (ti >= 0) for (let k = ti; k < Math.min(L.length, ti + 50); k++) {
      const mm = L[k].match(/^(?:\d+\.|[BCD]\.)\s*(.+?)\s+([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+))?/);
      if (mm) {
        const d = { name: compact(mm[1]).replace(/\./g, "·"), weight: +mm[2], prod_mom: +mm[3], prod_yoy: +mm[4], ship_mom: +mm[6], ship_yoy: +mm[7] };
        if (mm[8]) { d.inv_mom = +mm[9]; d.inv_yoy = +mm[10]; }
        ind.push(d);
      }
      if (ind.length && /^-\s*\d+\s*-$/.test(L[k])) break;
    }
    rec.industries = ind;
    rec.manuSectors = [];
    // 설비투자 기계류·운송장비
    const fi = C.indexOf("(설비투자)");
    if (fi >= 0) {
      const seg = C.slice(fi, fi + 400), cut = seg.indexOf("전년동월대비로는");
      const a = seg.slice(0, cut), b = seg.slice(cut);
      const g = (s, k) => { const x = s.match(new RegExp(k + "\\((-?[\\d.]+)%\\)")); return x ? +x[1] : null; };
      rec.facilityDetail = { machinery_mom: g(a, "기계류"), transport_mom: g(a, "운송장비"), machinery_yoy: g(b, "기계류"), transport_yoy: g(b, "운송장비") };
    }
    // 월별 추이
    const ms = new Set(); Object.values(blk).forEach(a => a.forEach(r => ms.add(r.m)));
    rec.series = [...ms].sort().map(mm => {
      const r = { m: mm };
      Object.entries(blk).forEach(([k, a]) => { const x = a.find(y => y.m === mm); if (x) { r[k + "_mom"] = x.mom; r[k + "_yoy"] = x.yoy; } });
      if (ccSeries[mm] != null) r.coincident_chg = ccSeries[mm];
      if (mm === month && sh.export && sh.export.yoy != null) r.export_ship_yoy = sh.export.yoy;
      return r;
    });
    rec.summary = summaryIP(rec);
    return rec;
  }
  function summaryIP(r) {
    const h = r.headline || {}, out = [], mo = +r.month.slice(5);
    const top = (r.industries || []).filter(x => !/^(광업|제조업|전기·가스업)$/.test(x.name) && x.weight > 100);
    const ups = top.slice().sort((a, b) => b.prod_mom - a.prod_mom).slice(0, 2), dns = top.slice().sort((a, b) => a.prod_mom - b.prod_mom).slice(0, 2);
    if (h.all) out.push(`${mo}월 전산업생산은 전월대비 ${fmt(h.all.mom)}, 전년동월대비 ${fmt(h.all.yoy)}예요. 광공업 ${fmt(h.mining && h.mining.mom)}, 서비스업 ${fmt(h.service && h.service.mom)}(전월비)이에요.`);
    if (ups.length) out.push(`제조업에서는 ${ups.map(x => `${x.name}(${fmt(x.prod_mom)})`).join("·")} 생산이 늘고, ${dns.map(x => `${x.name}(${fmt(x.prod_mom)})`).join("·")} 생산이 줄었어요.`);
    if (h.retail) out.push(`소매판매는 전월대비 ${fmt(h.retail.mom)}, 설비투자는 ${fmt(h.facility && h.facility.mom)}, 건설기성은 ${fmt(h.construction && h.construction.mom)}예요.`);
    if (r.shipment && r.shipment.export) out.push(`수출출하는 전월대비 ${fmt(r.shipment.export.mom)}, 전년동월대비 ${fmt(r.shipment.export.yoy)}이고, 내수출하는 전년동월대비 ${fmt(r.shipment.domestic && r.shipment.domestic.yoy)}예요.${r.utilization ? ` 제조업 가동률은 ${r.utilization.rate}%(${r.utilization.chg > 0 ? "+" : ""}${r.utilization.chg}%p)예요.` : ""}`);
    if (r.cycle && r.cycle.coincident) out.push(`동행지수 순환변동치 ${r.cycle.coincident.chg > 0 ? "+" : ""}${r.cycle.coincident.chg}p, 선행지수 순환변동치 ${r.cycle.leading ? (r.cycle.leading.chg > 0 ? "+" : "") + r.cycle.leading.chg + "p" : "—"}예요.`);
    return out;
  }

  /* ───────── 수출입동향 ───────── */
  const ITEMS = ["반도체", "자동차", "일반기계", "석유제품", "석유화학", "선박", "철강", "자동차부품", "무선통신기기", "디스플레이", "전기기기", "바이오헬스", "비철금속", "컴퓨터", "농수산식품", "화장품", "섬유", "생활용품", "가전", "이차전지"];
  const REGS = ["중국", "미국", "일본", "아세안", "EU(27)", "중동", "중남미", "CIS", "베트남", "인도"];
  function rowAfter(L, anchor, label, from) {
    const i = L.findIndex((l, k) => k >= (from || 0) && compact(l).includes(anchor));
    if (i < 0) return null;
    for (let k = i; k < Math.min(L.length, i + 12); k++) {
      if (compact(L[k]).startsWith(label)) {
        const v = nums(L[k].replace(/^[^\d-]+/, ""));
        if (v.length >= 13) return v.slice(-13);
      }
    }
    return null;
  }
  function blocks(seg) {
    const Ls = seg.split("\n"), out = [];
    for (let i = 0; i < Ls.length; i++) {
      const raw = Ls[i].replace(/\([^)]*\)/g, "");
      const toks = raw.split(/\s+/).filter(x => /^\d[\d,]*$/.test(x));
      if (toks.length >= 14 && !/\d\.\d/.test(raw)) {
        const amt = toks.slice(-14).map(x => +x.replace(/,/g, ""));
        let yoy = null;
        for (let j = i + 1; j < Math.min(Ls.length, i + 4); j++) {
          const p = [...Ls[j].replace(/△[ \t]*/g, "-").matchAll(/\(\s*(-?[\d.]+)\s*\)/g)].map(x => +x[1]);
          if (p.length >= 14) { yoy = p.slice(-14); i = j; break; }
        }
        if (yoy) out.push([amt, yoy]);
      }
    }
    return out;
  }
  function parseTrade(text, month) {
    const raw = text.replace(/△[ \t]*/g, "-"), L = lines(text), C = compact(text);
    const rec = { month, released: released(text), source: `산업통상부 ${+month.slice(0, 4)}년 ${+month.slice(5)}월 수출입 동향` };
    const ms = monthsEnding(month, 13);
    const iImp = L.findIndex(l => compact(l).startsWith("II.수입동향"));
    const ex = rowAfter(L, "①월별수출실적", "수출액"), exy = rowAfter(L, "①월별수출실적", "증감률"), dl = rowAfter(L, "①월별수출실적", "일평균");
    const ev = rowAfter(L, "③수출물량추이", "물량"), evy = rowAfter(L, "③수출물량추이", "증감률");
    const im = rowAfter(L, "①월별수입실적", "수입액", iImp), imy = rowAfter(L, "①월별수입실적", "증감률", iImp);
    const ivy = rowAfter(L, "③수입물량추이", "증감률", iImp), iv = rowAfter(L, "③수입물량추이", "물량", iImp);
    const bal = rowAfter(L, "①월별무역수지", "무역수지");
    const g = (a, k) => a ? a[k] : null;
    rec.series = ms.map((m, k) => ({ m, export: g(ex, k), export_yoy: g(exy, k), daily: g(dl, k), export_vol_yoy: g(evy, k), import: g(im, k), import_yoy: g(imy, k), import_vol_yoy: g(ivy, k), balance: g(bal, k) }));
    // 헤드라인
    let m = C.match(/수출([\d,.]+)억달러\((-?\+?[\d.]+)%\),수입([\d,.]+)억달러\((-?\+?[\d.]+)%\),수지(-?[\d,.]+)억달러(흑자|적자)/);
    const last = rec.series[12] || {};
    rec.export = { amount: m ? +m[1].replace(/,/g, "") : last.export, yoy: m ? +m[2] : last.export_yoy, volume: g(ev, 12), volume_yoy: last.export_vol_yoy, daily: last.daily };
    const dm = C.match(/일평균수출은([\d.]+)%(증가|감소)한([\d.]+)억달러/);
    if (dm) { rec.export.daily_yoy = signed(+dm[1], dm[2]); rec.export.daily = +dm[3]; }
    rec.import = { amount: m ? +m[3].replace(/,/g, "") : last.import, yoy: m ? +m[4] : last.import_yoy, volume: g(iv, 12), volume_yoy: last.import_vol_yoy };
    rec.balance = m ? (m[6] === "적자" ? -1 : 1) * Math.abs(+m[5].replace(/,/g, "")) : last.balance;
    const en = C.match(/에너지수입\+?(-?[\d.]+)%(증가|감소)?한([\d.]+)억달러/);
    if (en) { rec.import.energy = +en[3]; rec.import.energy_yoy = signed(+en[1], en[2]); }
    const ne = C.match(/비에너지수입은.{0,30}?([\d.]+)%(증가|감소)한([\d.]+)억달러/);
    if (ne) { rec.import.nonenergy = +ne[3]; rec.import.nonenergy_yoy = signed(+ne[1], ne[2]); }
    // 원유 (도입단가·물량 표: 마지막 두 칸이 전년동월비·전월비)
    const crude = {};
    L.forEach(l => {
      const c = compact(l);
      if (/^국제유가\(Dubai/.test(c)) { const v = nums(l.replace(/^[^)]*\)/, "")); crude.dubai = v[v.length - 3]; crude.dubai_yoy = v[v.length - 2]; }
      if (/^도입단가\(\$\/B\)/.test(c)) { const v = nums(l.replace(/^[^)]*\)/, "")); crude.intro_price = v[v.length - 3]; crude.intro_price_yoy = v[v.length - 2]; }
      if (/^도입물량\(백만B\)/.test(c)) { const v = nums(l.replace(/^[^)]*\)/, "")); crude.intro_volume_yoy = v[v.length - 2]; }
    });
    rec.crude = crude;
    // 20대 품목·지역 추이
    const segI = text.slice(text.indexOf("품목별 수출 추이") >= 0 ? text.indexOf("품목별 수출 추이") : 0);
    const iStart = text.search(/②\s*20\s*대\s*품목별\s*수출\s*추이/), iEnd = text.search(/③\s*유망\s*품목별/);
    const bI = iStart >= 0 ? blocks(text.slice(iStart, iEnd > iStart ? iEnd : undefined)) : [];
    rec.itemSeries = {}; ITEMS.forEach((n, k) => { if (bI[k]) rec.itemSeries[n] = ms.map((mm, j) => ({ m: mm, amt: r1(bI[k][0][j + 1] / 100), yoy: bI[k][1][j + 1] })); });
    const rStart = text.search(/②\s*주요\s*지역별\s*수출\s*추이/), rEnd = text.search(/II\s*\.\s*수입\s*동향/);
    const bR = rStart >= 0 ? blocks(text.slice(rStart, rEnd > rStart ? rEnd : undefined)) : [];
    rec.regionSeries = {}; REGS.forEach((n, k) => { if (bR[k]) rec.regionSeries[n] = ms.map((mm, j) => ({ m: mm, amt: r1(bR[k][0][j + 1] / 100), yoy: bR[k][1][j + 1] })); });
    rec.items = Object.entries(rec.itemSeries).map(([name, a]) => ({ name, amt: a[12].amt, yoy: a[12].yoy }));
    rec.regions = Object.entries(rec.regionSeries).map(([name, a]) => ({ name, amt: a[12].amt, yoy: a[12].yoy }));
    // 물량·단가가 따로 나온 품목
    const pv = [];
    [["석유제품", "석유제품"], ["석유화학", "석유화학"]].forEach(([key, name]) => {
      const x = C.match(new RegExp("\\d+월" + key + "수출액([\\d.]+)억불\\((-?\\+?[\\d.]+)%\\)/물량([\\d,]+)만톤\\((-?\\+?[\\d.]+)%\\)/단가([\\d,]+)\\$/톤\\((-?\\+?[\\d.]+)%\\)"));
      if (x) pv.push({ name, amt_yoy: +x[2], vol_yoy: +x[4], price_yoy: +x[6], note: `물량 ${x[3]}만 톤, 단가 ${x[5]}달러/톤` });
    });
    const st = C.match(/철강수출단가\(\$\/톤\):\([’‘']?\d{2}\.\d{1,2}\.[^)]*\)([\d,]+)→\([’‘']?\d{2}\.\d{1,2}\.[^)]*\)([\d,]+)\((-?\+?[\d.]+)%\)/);
    if (st) { const it = rec.items.find(x => x.name === "철강"); pv.push({ name: "철강", amt_yoy: it ? it.yoy : null, vol_yoy: null, price_yoy: +st[3], note: `수출단가 ${st[2]}달러/톤` }); }
    rec.priceVolume = pv;
    // 주요 가격
    const kps = {}, kp = [];
    const memM = raw.replace(/\n/g, " ").match(/메모리\s*고정가격\s*추이\s*\(\s*\$\s*,\s*[’‘']?\s*(\d{2})\s*\.\s*(\d{1,2})\s*월(.*?)\)\s*:(.{0,200})/);
    if (memM) {
      const n = (memM[3].match(/월/g) || []).length + 1;
      const end = `20${memM[1]}-${pad(+memM[2] + n - 1 > 12 ? +memM[2] + n - 13 : +memM[2] + n - 1)}`;
      const months = monthsEnding(end <= month ? end : month, n);
      const chains = [...memM[4].matchAll(/(\d+\.\d+(?:\s*→\s*\d+\.\d+)+)/g)].map(x => x[1].split("→").map(Number));
      if (chains[0]) kps["DDR5 16Gb 고정가($)"] = chains[0].slice(-n).map((v, k) => ({ m: months[k], v }));
      if (chains[1]) kps["NAND 128Gb 고정가($)"] = chains[1].slice(-n).map((v, k) => ({ m: months[k], v }));
    }
    if (crude.dubai != null) { kp.push({ name: "두바이유($/b)", val: crude.dubai, yoy: crude.dubai_yoy }); kps["두바이유($/b)"] = [{ m: month, v: crude.dubai }]; }
    Object.entries(kps).forEach(([k, a]) => { if (k.startsWith("DDR5") || k.startsWith("NAND")) kp.push({ name: k, val: a[a.length - 1].v, yoy: null }); });
    rec.keyPrices = kp; rec.keyPriceSeries = kps;
    // 주요 수입 품목 (수입 문단)
    const si = C.indexOf("(수입)에너지"), se = C.indexOf("(수지)", si);
    const imSeg = si >= 0 ? C.slice(si, se > si ? se : si + 800) : "";
    const imp = []; const seen = new Set();
    for (const x of imSeg.matchAll(/([가-힣]+)\(([\d.]+)억달러,(-?\+?[\d.]+)%\)/g)) if (!seen.has(x[1])) { seen.add(x[1]); imp.push({ name: x[1], amt: +x[2], yoy: +x[3] }); }
    rec.importItems = imp;
    rec.itemNotes = {};
    const rawFlat = text.replace(/△\s*/g, "-").replace(/[‧ㆍ･・]/g, "·").replace(/\n/g, " ").replace(/\s+/g, " ");
    const cutAt = rawFlat.search(/【\s*수\s*입\s*】/);
    const flat = cutAt > 0 ? rawFlat.slice(0, cutAt) : rawFlat;
    ITEMS.concat(["이차전지"]).forEach(name => {
      const re = new RegExp(name + "\\s*(?:수출\\s*)?\\(\\s*[\\d.,]+\\s*억\\s*달러\\s*,\\s*[+\\-]?[\\d.]+\\s*%?\\s*\\)\\s*(?:수출\\s*(?:액)?\\s*)?(?:은|는|도)?\\s*(.{8,170}?)(?:기록했다|기록했으며|이어갔다|경신했다|증가했다|감소했다|유지됐다)");
      const m = flat.match(re);
      if (m && !rec.itemNotes[name]) {
        let n = m[1].replace(/^및\s*[가-힣]+\s*\([^)]*\)\s*수출액은\s*/, "");
        n = n.split(/,\s*[가-힣A-Za-z·\s]{2,12}\s*\(\s*[\d.]+\s*억/)[0];
        n = n.replace(/\s+([,.)%])/g, "$1").replace(/\(\s+/g, "(").replace(/\s*·\s*/g, "·").replace(/\s+/g, " ").trim();
        n = n.replace(/\s*(을|를|으로|로|며|면서|고|해|하여|으나|했으나|했으며)$/, "").trim();
        if (n.length >= 8) rec.itemNotes[name] = n;
      }
    });
    rec.summary = summaryTrade(rec);
    return rec;
  }
  function summaryTrade(r) {
    const out = [], mo = +r.month.slice(5), e = r.export || {}, i = r.import || {};
    const price = (e.yoy != null && e.volume_yoy != null) ? ((1 + e.yoy / 100) / (1 + e.volume_yoy / 100) - 1) * 100 : null;
    out.push(`${mo}월 수출은 ${e.amount != null ? e.amount.toLocaleString("ko-KR") + "억 달러" : "—"}로 전년동월대비 ${fmt(e.yoy)}, 수입은 ${fmt(i.yoy)}, 무역수지는 ${r.balance != null ? (r.balance > 0 ? "+" : "") + r.balance + "억 달러" : "—"}예요.`);
    const it = (r.items || []).slice().sort((a, b) => b.amt - a.amt);
    if (it.length) {
      const up = it.filter(x => x.yoy > 0).sort((a, b) => b.yoy - a.yoy).slice(0, 3), dn = it.filter(x => x.yoy < 0).sort((a, b) => a.yoy - b.yoy).slice(0, 3);
      out.push(`20대 품목 중 ${it.filter(x => x.yoy > 0).length}개가 늘었어요. 많이 늘어난 품목: ${up.map(x => `${x.name}(${fmt(x.yoy)})`).join(", ")}${dn.length ? `. 줄어든 품목: ${dn.map(x => `${x.name}(${fmt(x.yoy)})`).join(", ")}` : ""}.`);
      out.push(`최대 품목 ${it[0].name}은 ${it[0].amt}억 달러로 전체 수출의 ${e.amount ? (it[0].amt / e.amount * 100).toFixed(1) : "—"}%예요.`);
    }
    if (e.volume_yoy != null) out.push(`수출물량(톤)은 ${fmt(e.volume_yoy)}, 금액과 물량으로 계산한 추정 단가는 ${fmt(price)}예요.`);
    (r.priceVolume || []).filter(x => x.vol_yoy != null).forEach(x => out.push(`${x.name}: 수출액 ${fmt(x.amt_yoy)} = 물량 ${fmt(x.vol_yoy)} · 단가 ${fmt(x.price_yoy)}.`));
    return out;
  }

  /* ───────── 소비자물가동향 ───────── */
  function parseCPI(text, month) {
    const L = lines(text), C = compact(text);
    const rec = { month, released: released(text), source: `국가데이터처 ${+month.slice(0, 4)}년 ${+month.slice(5)}월 소비자물가동향` };
    const ms = monthsEnding(month, 13);
    const tbl = (anchor) => {
      const i = L.findIndex(l => compact(l).includes(anchor)); if (i < 0) return null;
      const o = {};
      for (let k = i; k < Math.min(L.length, i + 10); k++) {
        const c = compact(L[k]);
        const v = nums(L[k].replace(/^[^\d-]+/, ""));
        if (v.length >= 13) { if (c.startsWith("지수")) o.idx = v.slice(-13); if (c.startsWith("전월비")) o.mom = v.slice(-13); if (c.startsWith("전년동월비")) o.yoy = v.slice(-13); }
      }
      return o;
    };
    const h = tbl("<월별소비자물가지수동향>"), fe = tbl("<월별식료품및에너지제외지수동향>"), ap = tbl("<월별농산물및석유류제외지수동향>");
    rec.series = ms.map((m, k) => ({ m, mom: h && h.mom ? h.mom[k] : null, yoy: h && h.yoy ? h.yoy[k] : null, core: fe && fe.yoy ? fe.yoy[k] : null }));
    const lastS = rec.series[12];
    rec.headline = { mom: lastS.mom, yoy: lastS.yoy, index: h && h.idx ? h.idx[12] : null };
    rec.core = { fe: { mom: fe && fe.mom ? fe.mom[12] : null, yoy: fe && fe.yoy ? fe.yoy[12] : null }, ap: { mom: ap && ap.mom ? ap.mom[12] : null, yoy: ap && ap.yoy ? ap.yoy[12] : null } };
    const pick = (label) => { const l = L.find(x => compact(x).startsWith(label)); if (!l) return null; const v = nums(l.replace(/^[^\d-]+/, "")); return v.length >= 2 ? { mom: v[v.length - 2], yoy: v[v.length - 1] } : null; };
    const lv = L.find(x => compact(x).startsWith("생활물가지수") && nums(x).length === 11);
    if (lv) { const v = nums(lv); rec.living = { mom: v[v.length - 2], yoy: v[v.length - 1] }; }
    const fr = L.find(x => compact(x).startsWith("신선식품지수") && nums(x).length === 11);
    if (fr) { const v = nums(fr); rec.fresh = { mom: v[v.length - 2], yoy: v[v.length - 1] }; }
    // 지출목적별 (품목수 가중치 지수 전월비 전년비 기여도 기여도)
    const sec = [];
    const si = L.findIndex(l => compact(l).includes("<지출목적별등락률및기여도>"));
    if (si >= 0) for (let k = si + 1; k < Math.min(L.length, si + 25); k++) {
      const mm = L[k].match(/^([가-힣,\s및]+?)\s+(\d+)\s+([\d.,]+)\s+([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)$/);
      if (mm && !/총지수/.test(compact(mm[1]))) sec.push({ name: mm[1].replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").replace(/([가-힣]) (?=[가-힣])/g, (a, b, o, s) => a).trim().replace(/^(보|교|통|교|건)\s/, "$1"), weight: +mm[3].replace(/,/g, ""), mom: +mm[5], yoy: +mm[6], contrib: +mm[8] });
      if (sec.length >= 12) break;
    }
    sec.forEach(x => { x.name = x.name.replace(/\s+/g, " "); if (/^[가-힣]( [가-힣])+$/.test(x.name)) x.name = x.name.replace(/ /g, ""); });
    rec.sectors = sec;
    // 품목성질별
    const types = [];
    const ti = L.findIndex(l => compact(l).includes("<품목성질별등락률및기여도>"));
    if (ti >= 0) for (let k = ti + 1; k < Math.min(L.length, ti + 30); k++) {
      const mm = L[k].match(/^[-.․·]?\s*\(?\s*([가-힣·\s]+?)\s*\)?\s*(\d+)\s+([\d.,]+)\s+([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)$/);
      if (mm && !/총지수/.test(compact(mm[1]))) types.push({ name: compact(mm[1]), weight: +mm[3].replace(/,/g, ""), mom: +mm[5], yoy: +mm[6], contrib: +mm[8] });
      if (/^주\s*1\)/.test(L[k])) break;
    }
    rec.types = types;
    // 주요 등락품목
    const mi = L.findIndex(l => compact(l).includes("<주요등락품목>"));
    const pairs = [];
    if (mi >= 0) for (let k = mi + 1; k < Math.min(L.length, mi + 30); k++) {
      if (/^-\s*\d+\s*-$/.test(L[k])) break;
      moverPairs(L[k]).forEach(p => { p.name = p.name.replace(/^(농축수산물|공업제품|전기·가스·수도|집세)/, "").replace(/^[서비스]?(개인|공공)(서비스)?/, ""); if (p.name) pairs.push(p); });
    }
    const uniq = (arr) => { const s = new Set(); return arr.filter(p => (s.has(p.name) ? false : (s.add(p.name), true))); };
    rec.movers = { up: uniq(pairs.filter(p => p.v > 0).sort((a, b) => b.v - a.v)).slice(0, 9).map(p => `${p.name}(${p.v})`), down: uniq(pairs.filter(p => p.v < 0).sort((a, b) => a.v - b.v)).slice(0, 8).map(p => `${p.name}(${p.v})`) };
    rec.sectorSeries = {};
    rec.summary = summaryCPI(rec);
    return rec;
  }
  function summaryCPI(r) {
    const out = [], mo = +r.month.slice(5), s = r.series || [], prev = s[s.length - 2];
    out.push(`${mo}월 소비자물가는 전년동월대비 ${fmt(r.headline.yoy)}${prev ? `(전월 ${prev.yoy}%)` : ""}, 전월대비 ${fmt(r.headline.mom)}예요.`);
    if (r.core && r.core.fe) out.push(`근원물가(식료품·에너지 제외)는 ${fmt(r.core.fe.yoy)}, 농산물·석유류 제외는 ${fmt(r.core.ap && r.core.ap.yoy)}예요.`);
    const top = (r.sectors || []).slice().sort((a, b) => b.contrib - a.contrib).slice(0, 2);
    if (top.length) out.push(`물가를 가장 많이 끌어올린 부문은 ${top.map(x => `${x.name}(${fmt(x.yoy)}, 기여도 ${x.contrib.toFixed(2)}%p)`).join(", ")}이에요.`);
    const pet = (r.types || []).find(x => x.name === "석유류");
    if (pet) out.push(`석유류는 ${fmt(pet.yoy)}(기여도 ${pet.contrib.toFixed(2)}%p)예요.`);
    if (r.living || r.fresh) out.push(`생활물가 ${fmt(r.living && r.living.yoy)}, 신선식품 ${fmt(r.fresh && r.fresh.yoy)}예요.`);
    return out;
  }

  function parse(text) {
    const d = detect(text);
    if (!d.type || !d.month) throw new Error("산업활동동향·수출입동향·소비자물가동향 보도자료가 아니에요.");
    if (d.type === "tp") throw new Error("수출입물가지수는 아직 지원하지 않아요.");
    const rec = d.type === "ip" ? parseIP(text, d.month) : d.type === "trade" ? parseTrade(text, d.month) : parseCPI(text, d.month);
    rec.via = "parser";
    return { type: d.type, month: d.month, rec };
  }

  const api = { detect, parse, parseIP, parseTrade, parseCPI, maxPages: { ip: 60, trade: 30, cpi: 17 } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReportParser = api;
})(typeof window !== "undefined" ? window : globalThis);
