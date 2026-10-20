"""
매일 종가·재무지표·공포탐욕지수를 받아 data/market.json을 갱신하는 스크립트.

- 국내 주식(KRX:xxxxxx): 네이버 증권 모바일 API에서 종가·EPS·BPS·주당배당금 등을 읽고,
  실패하면 yfinance(xxxxxx.KS / .KQ)로 종가만 받아요.
- 미국 주식(NASDAQ:/NYSE:): yfinance에서 종가·EPS·BPS·배당금을 받아요.
- 공포·탐욕 지수: CNN Business 데이터 엔드포인트.
- 원/달러 환율: yfinance KRW=X.

- 종목코드가 비어 있는 data/stocks.json 항목은 KRX 상장법인 목록(KIND)과 네이버 자동완성으로
  이름을 찾아 코드를 채워 넣어요. 3번 찾지 못하면 비상장으로 보고 더 찾지 않아요.

어떤 항목을 못 받아와도 기존 값은 그대로 두고 다음 종목으로 넘어가요.
업데이트할 종목은 data/stocks.json(사이트 기본 종목 목록 전체), data/portfolio.json(보유·장기·비교 종목), data/market.json에 이미 있는 종목이에요.
"""
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
MARKET = ROOT / "data" / "market.json"
PORTFOLIO = ROOT / "data" / "portfolio.json"
STOCKS = ROOT / "data" / "stocks.json"
KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
HISTORY_DAYS = 250

try:
    import yfinance as yf
except Exception:  # yfinance가 없어도 국내 주식은 네이버로 동작
    yf = None


def log(*a):
    print(*a, flush=True)


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def to_num(s):
    """'22,292원', '9.78배', '-7,193', '1,262조 7,962억' 같은 문자열을 숫자로."""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).strip()
    if "조" in s or "억" in s:
        total = 0.0
        m = re.search(r"([\d,\.]+)\s*조", s)
        if m:
            total += float(m.group(1).replace(",", "")) * 1e12
        m = re.search(r"([\d,\.]+)\s*억", s)
        if m:
            total += float(m.group(1).replace(",", "")) * 1e8
        return total or None
    m = re.search(r"-?[\d,]*\.?\d+", s.replace(" ", ""))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def push_history(q, date, price):
    hist = [h for h in q.get("history", []) if h and h[0] != date]
    hist.append([date, price])
    hist.sort(key=lambda h: h[0])
    q["history"] = hist[-HISTORY_DAYS:]


# ───────── 국내 주식 ─────────
def naver_kr(code):
    base = f"https://m.stock.naver.com/api/stock/{code}"
    out = {}
    r = requests.get(base + "/basic", headers=UA, timeout=15)
    r.raise_for_status()
    b = r.json()
    out["price"] = to_num(b.get("closePrice"))
    traded = b.get("localTradedAt") or ""
    out["date"] = traded[:10] if traded else datetime.now(KST).strftime("%Y-%m-%d")
    out["name"] = b.get("stockName")

    try:
        r = requests.get(base + "/integration", headers=UA, timeout=15)
        r.raise_for_status()
        info = r.json()
        f = {}
        for it in info.get("totalInfos", []) or []:
            code_ = (it.get("code") or "").lower()
            key = (it.get("key") or "").replace(" ", "")
            val = to_num(it.get("value"))
            if val is None:
                continue
            if code_ == "eps" or key == "EPS":
                f["eps"] = val
            elif code_ == "cnseps" or key == "추정EPS":
                f["fwdEps"] = val
            elif code_ == "bps" or key == "BPS":
                f["bps"] = val
            elif code_ == "dividend" or key == "주당배당금":
                f["dps"] = val
            elif code_ == "highpriceof52weeks" or key == "52주최고":
                f["high52"] = val
            elif code_ == "lowpriceof52weeks" or key == "52주최저":
                f["low52"] = val
            elif code_ == "foreignrate" or key == "외인소진율":
                f["foreignPct"] = val
            elif code_ == "marketvalue" or key == "시총":
                f["marketCap"] = val
        out["fund"] = f
    except Exception as e:
        log(f"  · {code} 재무 정보 실패: {e}")
    return out


def yf_close(ticker):
    if yf is None:
        return None
    h = yf.Ticker(ticker).history(period="7d", auto_adjust=False)
    if h is None or h.empty:
        return None
    last = h.dropna(subset=["Close"]).iloc[-1]
    return float(last["Close"]), h.dropna(subset=["Close"]).index[-1].strftime("%Y-%m-%d")


def update_kr(code6, quotes, funds, key):
    try:
        d = naver_kr(code6)
        if d.get("price"):
            q = quotes.setdefault(key, {})
            q.update(price=d["price"], asOf=d["date"], src="auto")
            push_history(q, d["date"], d["price"])
            f = funds.setdefault(key, {})
            f.update({k: v for k, v in (d.get("fund") or {}).items() if v is not None})
            if f.get("marketCap") and d["price"]:
                f["shares"] = round(f["marketCap"] / d["price"])
                f.pop("marketCap", None)
            f["asOf"] = d["date"]
            f["source"] = "네이버 증권 (자동 갱신)"
            if d.get("name") and not f.get("name"):
                f["name"] = d["name"]
            log(f"  ✓ {key} {d['price']:,.0f}원 ({d['date']})")
            return True
    except Exception as e:
        log(f"  · {key} 네이버 실패: {e}")
    for suffix in (".KS", ".KQ"):
        try:
            res = yf_close(code6 + suffix)
            if res:
                price, date = res
                q = quotes.setdefault(key, {})
                q.update(price=price, asOf=date, src="auto")
                push_history(q, date, price)
                log(f"  ✓ {key} {price:,.0f}원 ({date}, yfinance)")
                return True
        except Exception as e:
            log(f"  · {key}{suffix} yfinance 실패: {e}")
    return False


# ───────── 미국 주식 ─────────
def update_us(symbol, quotes, funds, key):
    if yf is None:
        log(f"  · {key} 건너뜀: yfinance 미설치")
        return False
    ysym = symbol.replace(".", "-")  # BRK.B → BRK-B
    try:
        res = yf_close(ysym)
        if not res:
            raise RuntimeError("시세 없음")
        price, date = res
        q = quotes.setdefault(key, {})
        q.update(price=price, asOf=date, src="auto")
        push_history(q, date, price)
        try:
            info = yf.Ticker(ysym).info or {}
            f = funds.setdefault(key, {})
            mapping = {"trailingEps": "eps", "forwardEps": "fwdEps", "bookValue": "bps", "dividendRate": "dps",
                       "fiftyTwoWeekHigh": "high52", "fiftyTwoWeekLow": "low52", "sharesOutstanding": "shares"}
            for src, dst in mapping.items():
                v = info.get(src)
                if isinstance(v, (int, float)):
                    f[dst] = float(v)
            # ETF는 EPS·배당금 항목이 비어 있는 경우가 많아 대체 항목으로 채워요
            if "dps" not in f or f.get("dps") is None:
                v = info.get("trailingAnnualDividendRate")
                if isinstance(v, (int, float)) and v > 0:
                    f["dps"] = float(v)
                else:
                    y = info.get("yield") or info.get("dividendYield")
                    if isinstance(y, (int, float)) and y > 0:
                        y = y / 100 if y > 1 else y
                        f["dps"] = round(price * y, 4)
            pe = info.get("trailingPE")
            if f.get("eps") is None and isinstance(pe, (int, float)) and pe > 0:
                f["eps"] = round(price / pe, 4)
            er = info.get("netExpenseRatio") or info.get("annualReportExpenseRatio")
            if isinstance(er, (int, float)):
                f["expense"] = float(er)
            if info.get("quoteType") == "ETF":
                f["etf"] = True
            f["asOf"] = date
            f["source"] = "Yahoo Finance (자동 갱신)"
        except Exception as e:
            log(f"  · {key} 재무 정보 실패: {e}")
        log(f"  ✓ {key} ${price:,.2f} ({date})")
        return True
    except Exception as e:
        log(f"  · {key} 실패: {e}")
        return False


# ───────── 공포·탐욕 / 환율 ─────────
def update_feargreed(market):
    url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
    try:
        r = requests.get(url, headers={**UA, "Referer": "https://edition.cnn.com/", "Origin": "https://edition.cnn.com"}, timeout=20)
        r.raise_for_status()
        j = r.json()
        fg = j.get("fear_and_greed", {})
        hist = (j.get("fear_and_greed_historical") or {}).get("data", []) or []
        ts = fg.get("timestamp")
        as_of = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=-5))).strftime("%Y-%m-%d") if isinstance(ts, str) else datetime.now(KST).strftime("%Y-%m-%d")
        pts = []
        for p in hist[-8:]:
            d = datetime.fromtimestamp(p["x"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
            pts.append({"d": d, "v": round(float(p["y"]), 1)})
        market["feargreed"] = {
            "value": round(float(fg["score"]), 1),
            "asOf": as_of,
            "prevClose": fg.get("previous_close"),
            "weekAgo": fg.get("previous_1_week"),
            "monthAgo": fg.get("previous_1_month"),
            "yearAgo": fg.get("previous_1_year"),
            "history": pts or market.get("feargreed", {}).get("history", []),
        }
        log(f"  ✓ 공포·탐욕 {market['feargreed']['value']} ({as_of})")
    except Exception as e:
        log(f"  · 공포·탐욕 실패: {e}")


def update_fx(market):
    try:
        res = yf_close("KRW=X")
        if res:
            market.setdefault("fx", {})["USDKRW"] = round(res[0], 2)
            log(f"  ✓ 원/달러 {res[0]:,.2f}")
    except Exception as e:
        log(f"  · 환율 실패: {e}")


def _nz(name):
    return re.sub(r"\s+", "", str(name or "")).upper().replace("(주)", "")


def krx_listing():
    """KRX KIND 상장법인 목록 → {정규화된 회사명: 종목코드}"""
    url = "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13"
    try:
        r = requests.get(url, headers=UA, timeout=30)
        r.raise_for_status()
        html = r.content.decode("euc-kr", errors="ignore")
    except Exception as e:
        log(f"  · KRX 상장법인 목록 실패: {e}")
        return {}
    out = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S | re.I)]
        if len(cells) < 3:
            continue
        code = next((c for c in cells[1:4] if re.fullmatch(r"[0-9A-Z]{6}", c)), None)
        if code:
            out[_nz(cells[0])] = code
    log(f"  · KRX 상장법인 {len(out)}개 불러옴")
    return out


def naver_lookup(name):
    """네이버 증권 자동완성에서 이름이 정확히 같은 국내 종목 코드를 찾아요."""
    try:
        r = requests.get("https://ac.stock.naver.com/ac", params={"q": name, "target": "stock"}, headers=UA, timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception:
        return None
    found = []

    def walk(o):
        if isinstance(o, dict):
            c, n = o.get("code"), o.get("name")
            if isinstance(c, str) and isinstance(n, str) and re.fullmatch(r"[0-9A-Z]{6}", c):
                nation = str(o.get("nationCode") or o.get("nation") or "KOR")
                if nation in ("KOR", "KR", "") or str(o.get("typeCode", "")).upper() in ("KOSPI", "KOSDAQ", "KONEX"):
                    found.append((n, c))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(data)
    for n, c in found:
        if _nz(n) == _nz(name):
            return c
    return None


def resolve_codes(stocks):
    """코드가 없는 종목을 찾아 채워요. 바뀐 게 있으면 True."""
    todo = [s for s in stocks if not s.get("code") and s.get("listed") is not False]
    if not todo:
        return False
    log(f"종목코드 찾기: {len(todo)}개")
    listing = krx_listing()
    changed = False
    for s in todo:
        names = [s["name"]] + list(s.get("aliases", []))
        code = None
        for n in names:
            code = listing.get(_nz(n))
            if code:
                break
        if not code:
            for n in names:
                code = naver_lookup(n)
                time.sleep(0.2)
                if code:
                    break
        if code:
            s["code"] = f"KRX:{code}"
            s.pop("tries", None)
            s["listed"] = True
            log(f"  ✓ {s['name']} → {code}")
        else:
            s["tries"] = int(s.get("tries", 0)) + 1
            if s["tries"] >= 3:
                s["listed"] = False
            log(f"  · {s['name']} 코드를 찾지 못함 ({s['tries']}회)")
        changed = True
    return changed


def main():
    market = load(MARKET, {"quotes": {}, "fundamentals": {}, "feargreed": None, "fx": {}})
    pf = load(PORTFOLIO, {})
    quotes = market.setdefault("quotes", {})
    funds = market.setdefault("fundamentals", {})

    stocks = load(STOCKS, [])
    if resolve_codes(stocks):
        STOCKS.write_text(json.dumps(stocks, ensure_ascii=False, indent=1), encoding="utf-8")
    codes = set(quotes) | set(funds) | set(pf.get("watch", []))
    for st in stocks:
        if st.get("code"):
            codes.add(st["code"])
            f = funds.setdefault(st["code"], {})
            f.setdefault("name", st.get("name"))
            f.setdefault("sector", st.get("sector"))
    for h in (pf.get("holdings", []) or []) + (pf.get("longHoldings", []) or []):
        if h.get("code"):
            codes.add(h["code"])
            f = funds.setdefault(h["code"], {})
            f.setdefault("name", h.get("name"))
            f.setdefault("sector", h.get("sector"))

    log(f"종목 {len(codes)}개 업데이트 시작")
    ok = 0
    for key in sorted(codes):
        ex, _, sym = key.partition(":")
        if ex == "KRX" and re.fullmatch(r"[0-9A-Z]{6}", sym):
            ok += update_kr(sym, quotes, funds, key)
        elif ex in ("NASDAQ", "NYSE", "NYSEARCA", "AMEX"):
            ok += update_us(sym, quotes, funds, key)
        else:
            log(f"  · {key} 알 수 없는 코드 형식, 건너뜀")
        time.sleep(0.25)

    update_feargreed(market)
    update_fx(market)
    market["updatedAt"] = datetime.now(KST).isoformat(timespec="seconds")

    MARKET.write_text(json.dumps(market, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"완료: {ok}/{len(codes)} 종목 갱신")
    return 0


if __name__ == "__main__":
    sys.exit(main())
