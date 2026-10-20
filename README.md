# 내 주식 포트폴리오

공포·탐욕 지수, 보유 종목, 섹터별 PER·PBR 비교, 장기 프로젝트와 배당·실현수익을 한 페이지에서 보는 개인 대시보드예요.
GitHub Pages로 공개하고, GitHub Actions가 평일마다 종가를 자동으로 받아 `data/market.json`을 갱신해요.

## 폴더 구성

```
index.html                         사이트 본체 (이 파일 하나로 동작)
data/market.json                   종가·재무지표·공포탐욕지수·환율 (Actions가 자동 갱신)
data/portfolio.json                처음 열었을 때 불러올 포트폴리오 + 자동 갱신할 종목 목록
scripts/update_prices.py           시세를 받아오는 스크립트
.github/workflows/update-prices.yml  매일 스크립트를 실행하는 예약 작업
```

## 1. 저장소 만들고 올리기

1. GitHub에서 **New repository** → 이름 입력(예: `my-portfolio`) → Create.
2. 이 폴더의 파일을 모두 올려요. `.github` 폴더도 꼭 함께 올려야 해요.
   - 웹에서 올릴 때: **Add file → Upload files**에 폴더째 끌어다 놓기
   - 터미널에서 올릴 때:
     ```bash
     git init
     git add .
     git commit -m "첫 업로드"
     git branch -M main
     git remote add origin https://github.com/내아이디/my-portfolio.git
     git push -u origin main
     ```

## 2. 사이트 공개 (GitHub Pages)

**Settings → Pages → Build and deployment**에서 Source를 **Deploy from a branch**, Branch를 **main / (root)**로 두고 Save.
1~2분 뒤 `https://내아이디.github.io/my-portfolio/`에서 열려요.

> 공개 저장소면 `data/portfolio.json`의 보유 종목·수량·평단을 누구나 볼 수 있어요. 숨기고 싶으면 아래 “개인정보” 항목을 보세요.

## 3. 자동 주가 업데이트 켜기

1. **Settings → Actions → General → Workflow permissions**에서 **Read and write permissions**를 선택하고 Save.
   (Actions가 `data/market.json`을 커밋할 수 있게 하는 설정이에요.)
2. **Actions** 탭 → 왼쪽 **주가 자동 업데이트** → **Run workflow**로 한 번 직접 실행해 봐요.
   초록색 체크가 뜨고 `시세 업데이트 …` 커밋이 생기면 성공이에요.
3. 그다음부터는 자동으로 실행돼요.
   - 평일 16:30 (한국장 마감 후)
   - 평일 다음 날 07:30 (미국장 마감 후)

GitHub 예약 작업은 몇 분~수십 분 늦게 시작될 수 있어요. 공휴일에는 바뀐 시세가 없어서 커밋이 생기지 않아요.

## 4. 종목을 추가했을 때

사이트에서 입력한 내용은 **그 브라우저에만** 저장돼요. 자동 업데이트 대상 종목을 바꾸려면:

1. Claude 사이트(또는 GitHub 사이트) 맨 아래 **백업 내보내기**를 눌러 `portfolio.json`을 받아요.
2. 저장소의 `data/portfolio.json`을 이 파일로 바꿔서 커밋해요.
3. 다음 업데이트부터 새 종목의 종가·재무지표가 들어와요. (바로 보고 싶으면 Actions에서 **Run workflow**)

다른 컴퓨터나 휴대폰에서도 같은 포트폴리오를 보려면 그 기기에서 **백업 불러오기**로 같은 파일을 열면 돼요.
처음 여는 브라우저는 `data/portfolio.json`을 자동으로 불러와요.

## 5. 내 컴퓨터에서 직접 업데이트하기 (선택)

```bash
pip install requests yfinance
python scripts/update_prices.py
git add data/market.json && git commit -m "시세 업데이트" && git push
```

## 경제 일정·금리 데이터

`data/market.json`의 `macro` 항목에 들어 있어요. 자동 업데이트 스크립트는 이 항목을 건드리지 않고 그대로 둬요.

- 새 일정 추가: `macro.events`에 `{"d":"2026-12-17","t":"10:00","c":"KR","k":"rate","title":"…"}` 형식으로 추가 (k는 rate·cpi·jobs·pce 중 하나, 시간은 한국 시간)
- 발표가 끝나면 그 일정에 `"result":"3.00%"`, `"prev":"…"`를 채우면 ‘지난 발표 결과’로 넘어가요
- 금리가 바뀌면 `macro.rates.kr` 또는 `macro.rates.us`에 한 줄 추가
- 사이트에서 ‘내 일정 추가’로 넣은 일정은 브라우저(백업 파일)에 저장돼요

## 경제 보고서 (산업활동동향·소비자물가동향)

`data/reports.json`에 월별로 쌓여요. GitHub Pages에서는 Claude가 없어서 PDF 자동 분석이 동작하지 않아요.
새 달 보고서는 Claude 사이트에서 PDF를 올려 분석한 뒤 **백업 내보내기**로 받은 파일의 `reports` 항목을 `data/reports.json`에 옮기면 돼요.

## 데이터 출처

| 항목 | 출처 |
| --- | --- |
| 국내 주식 종가·EPS·BPS·배당금 | 네이버 증권 모바일 API (실패 시 Yahoo Finance 종가) |
| 미국 주식 종가·EPS·BPS·배당금 | Yahoo Finance (`yfinance`) |
| 공포·탐욕 지수 | CNN Business |
| 원/달러 환율 | Yahoo Finance `KRW=X` |

이 출처들은 공식 공개 API가 아니어서 사이트 구조가 바뀌면 일부 항목이 갱신되지 않을 수 있어요.
그럴 땐 Actions 실행 기록의 로그에 `· 실패`로 표시되고, 기존 값은 그대로 남아요.

## 세금 계산 기준 (2026년)

- 배당소득세: 국내 15.4%, 미국 15% 원천징수 (종목별로 바꿀 수 있어요)
- 국내 상장주식 매매차익: 일반 개인 비과세, 매도 시 증권거래세 0.20%
- 해외 주식 매매차익: 연간 손익 합산 후 250만 원 공제, 22% (다음 해 5월 직접 신고)
- 이자·배당 합계가 연 2,000만 원을 넘으면 금융소득종합과세 대상이 될 수 있어요

참고용 계산이에요. 실제 세액은 증권사 내역과 세무 신고 기준으로 확인하세요.

## 개인정보

보유 내역을 공개하고 싶지 않다면:

- `data/portfolio.json`에는 종목 코드만 남기고 수량·평단을 0으로 두세요. (실제 수량·평단은 브라우저에만 저장돼요)
- 또는 저장소를 **Private**로 만드세요. 무료 계정의 Private 저장소는 GitHub Pages를 쓸 수 없어서, 이 경우엔 `index.html`을 내 컴퓨터에서 열고 시세만 Actions로 갱신해 받아 쓰는 방식이 돼요.
