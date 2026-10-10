# 내러티브 레짐 트래커 (Macro Narrative Tracker)

경기순환 / 구조테마 / 정치제도 3개 층위로 시장 내러티브를 기록하고,
정량 지표(VIX·금·WTI·달러인덱스·美10년물)를 매일 자동 수집해 GitHub Pages로 시각화합니다.

## 1. 저장소 세팅 (최초 1회)

1. GitHub에서 새 저장소 생성 (예: `narrative-tracker`, Public 권장 — Pages 무료 사용 조건)
2. 이 폴더 전체를 저장소에 push:
   ```bash
   cd narrative-tracker
   git init
   git add .
   git commit -m "init: narrative tracker"
   git branch -M main
   git remote add origin https://github.com/<본인계정>/narrative-tracker.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages** 에서:
   - Source: `Deploy from a branch`
   - Branch: `main` / 폴더: `/docs`
   - 저장하면 몇 분 내로 `https://<본인계정>.github.io/narrative-tracker/` 에서 대시보드 확인 가능

4. 저장소 **Settings → Actions → General → Workflow permissions** 에서
   `Read and write permissions` 로 설정 (자동 수집 스크립트가 커밋/푸시하려면 필요)

## 2. 자동 수집 확인

- `.github/workflows/collect.yml` 이 매일 UTC 22:30(한국시간 07:30)에 실행되어
  `docs/data/market_snapshot.csv` 의 최근 14일 치를 데이터 기준일로 갱신하고,
  레짐 판정을 `regime_log.csv` 에 한 줄 쌓은 뒤 자동 커밋합니다.
- 이어서 7일이 지나 값이 확정된 행을 구글 시트로 보냅니다 (아래 "구글 시트 사본" 참고).
- 바로 테스트하려면: 저장소 **Actions 탭 → Collect Market Data → Run workflow** 로 수동 실행

## 3. 자동화 구조

| 단계 | 대상 | 주체 | 주기 |
|---|---|---|---|
| 수집 | 정량 지표 (VIX·달러·금·WTI·금리·신용·유동성) | Actions + FRED API(키 있을 때)/fdr/Stooq | 매일 07:30 KST |
| 수집 | 내러티브 언급량 (기사 수) | Actions + Google News RSS | 매일 07:30 KST |
| 갱신 | 정량 지표 다시 받기 (FRED가 밤에 올리는 전일 값 반영) | `fred_refresh.yml` | 매일 23:30 KST |
| 수집 | 기업 재무 (요약재무제표·재무상태표·손익계산서) | Actions + 금융위원회 API | 매주 월 06:45 KST · 수동 추가 |
| 판정 | 레짐(성장·물가 / 신용 / 정책) | `compute_regime.py` (규칙 기반) | 매일 07:30 KST |
| 자동 전환 | 이벤트 상태 active ↔ dormant (명백한 경우만) | `auto_transition.py` (규칙 기반) | 매일 07:30 KST |
| 기록 | 내러티브 이벤트 추가·수정·강도 | **사용자** — `events.json` 직접 편집 | 필요할 때 |

**설계**: 매주 GitHub Issue로 제안(Gemini 웹 대조·신규 내러티브 탐지)을 올리고 사람이 승인하던 주간 리뷰는
2026-10에 없앴습니다 — 제안을 사람이 일일이 정리해야 해서 처리되지 않은 Issue만 쌓였기 때문입니다.
이제 이벤트 상태는 아래 규칙에 걸리는 명백한 경우만 `auto_transition.py`가 바꾸고(Issue 알림 없음 — 바뀐 내역은
이벤트의 `last_auto` 필드와 git 이력에 남음), 새 내러티브 추가와 강도 판단은 `events.json`을 직접 고칩니다.

### 자동 상태 전환 규칙 (`auto_transition.py` — 코드가 계산, LLM 판단 아님)

기사 수 7일 이동평균의 역대 정점 대비로 판정하며, 보수적으로 잡아 애매한 구간은 건드리지 않습니다.

| 전환 | 조건 |
|---|---|
| active → dormant | 관측 10일 이상 · 정점 ≥ 10건/일 · 최근 7개 관측 모두 정점의 15% 미만 |
| dormant → active (재점화) | 최근 3개 관측 모두 정점의 50% 이상 · 최근값 ≥ 10건/일 |

- 잘못 전환됐으면 `events.json`에서 `status`를 되돌리고 그 이벤트에 `"auto_lock": true`를 넣으면 이후 제외됩니다.
- 대시보드 언급량 차트의 점선(정점 대비 50% 반감기 · 25% 휴면 검토선)은 눈으로 보는 참고선이고 자동 전환에는 쓰지 않습니다.

### FRED API 키 설정 (선택 — 없어도 수집은 동작)

FRED 시리즈(VIX·금리·스프레드·BEI·연준 대차대조표 등 `FRED:` 심볼 전부)는 키가 있으면 **FRED 공식 API**
(`api.stlouisfed.org`)로, 없으면 지금처럼 FinanceDataReader가 감싼 `fredgraph.csv`로 받습니다. 값은 같은
FRED 원본이고, 공식 API를 쓰면 다음이 달라집니다.

- 시리즈 메타데이터(제목·단위·주기·마지막 관측일·**FRED 최종 갱신 시각**)를 매일 `docs/data/fred_series.json`에 기록
  → 대시보드 **데이터 소스 — FRED** 표에 시리즈별 수집 경로(FRED API / fdr)와 함께 표시
- 연준 유동성 카드가 단위(백만/십억 달러)를 메타데이터로 확인해 환산 (키가 없으면 기본 단위로 가정하고 '단위 가정' 배지)
- 오류가 HTTP 코드·FRED 오류 메시지로 로그에 남음. API가 실패한 시리즈만 fdr로 자동 재시도

1. https://fredaccount.stlouisfed.org/apikeys 에서 무료 API 키 발급 (32자리 영문 소문자+숫자)
2. 저장소 **Settings → Secrets and variables → Actions → New repository secret**
3. Name: `FRED_API_KEY` / Secret: 발급받은 키 → **Add secret**
4. **Actions → Collect Market Data → Run workflow** 로 확인 — 로그에 `via FRED API`가 찍히고
   대시보드 표의 수집 경로가 `FRED API`로 바뀝니다

`collect.yml`·`backfill.yml`이 이 Secret을 환경변수로 넘깁니다. 키는 로그·오류 메시지에서 `***`로 가려집니다.
로컬 실행은 `FRED_API_KEY=... python scripts/collect_market_data.py`. 메타데이터만 다시 받으려면
`FRED_API_KEY=... python scripts/fred_catalog.py`.

**FRED 원본과 대조·재동기화** — `scripts/resync_fred.py`가 CSV의 FRED 컬럼을 FRED API 값과 날짜별로 비교합니다.
PR마다 `test.yml`이 전체 컬럼을 dry-run으로 대조해 결과를 주석으로 남기고, 맞추려면 **Actions → Backfill Market
History → `resync_columns`**에 `vix`(또는 `all`)를 넣어 실행합니다. 기존 행만 다루며(행 추가·삭제 없음), FRED 값이 있는
날은 FRED 값으로, FRED에 관측이 없는 날(미국 휴장일)에 남아 있던 값은 비웁니다. 주간 지수(NFCI·STLFSI4)는 FRED가
과거 값을 매주 수정하므로 최신 수정값으로 바뀝니다.

**VIX 기준일** — VIX는 FRED `VIXCLS`(CBOE 종가)입니다. FRED는 미국 장 마감 다음 날 아침(한국시간 22~23시)에
올리므로, 아침 수집(07:30 KST)에서는 하루 전 종가가 최신이고 `fred_refresh.yml`(23:30 KST)이 그날 밤 반영합니다.
아침 뉴스의 'VIX 종가'와 하루 차이가 나는 것은 이 발표 시차 때문입니다 — 카드의 '기준' 날짜를 확인하세요.

### 기업 재무 (금융위원회 API — 선택)

공공데이터포털 **금융위원회_기업 재무정보**로 요약재무제표(연도별 매출·영업이익·순이익·자산·부채·자본·부채비율,
연결/별도)와 최신 연도 재무상태표·손익계산서를 받아 대시보드 **기업 재무**에 표·차트로 보여줍니다.

1. data.go.kr에서 활용신청: **금융위원회_기업 재무정보**(필수), **금융위원회_기업기본정보**(사업자등록번호로 찾을 때·회사명 표시용)
2. 저장소 Secret `DATA_GO_KR_KEY` = 마이페이지의 일반 인증키 (Encoding·Decoding 어느 쪽이든 됨)
3. 기업 추가: **Actions → Company Financials → Run workflow**
   - `number`: 법인등록번호 13자리 또는 사업자등록번호 10자리 (하이픈 무관, 쉼표로 여러 개)
   - `name`: 회사명 (선택) — 사업자등록번호로 찾을 때 함께 넣으면 확실합니다
4. 1~2분 뒤 대시보드 기업 재무에서 회사명·사업자등록번호·법인등록번호로 검색

재무정보 API는 **법인등록번호로만** 조회됩니다. 사업자등록번호는 기업기본정보 API로 법인등록번호를 찾아 바꾸는데,
이 API의 공식 검색 조건이 법인등록번호·회사명이라 사업자등록번호로 바로 안 걸리면 회사명으로 찾은 결과에서
사업자등록번호가 같은 법인을 고릅니다. 개인사업자는 법인등록번호가 없어 대상이 아닙니다.
목록은 `config/companies.json`, 결과는 `docs/data/financials/`에 쌓입니다. 키·응답 필드 점검은 `scripts/fsc_check.py`
(`test.yml`의 `fsc-api-check` 잡)가 실제 API로 합니다.

## 4. 과거 데이터 채우기 (최초 1회 권장)

FRED와 Stooq에는 수년치 과거 데이터가 있으므로 한 번에 소급 수집할 수 있습니다.
설치 직후 실행하면 대시보드에 바로 몇 년치 추이가 나타납니다.

**GitHub에서 실행 (로컬 환경 불필요)**
1. **Actions** 탭 → **Backfill Market History** 선택
2. **Run workflow** 클릭
3. `years` 칸에 원하는 연수 입력 (기본 3) 또는 `start`에 `2020-01-01` 형식으로 시작일 입력
4. **Run workflow** → 1~2분 후 `market_snapshot.csv`가 자동 갱신·커밋됨

**로컬에서 실행**
```bash
python scripts/backfill_market_data.py --years 3
python scripts/backfill_market_data.py --start 2020-01-01
```

### 새 컬럼만 과거치 채우기 (`--merge`)

`COLUMNS`에 지표를 추가하면 일일 수집이 헤더를 새로 쓰면서 **과거 행의 새 컬럼은 빈칸**으로 남습니다
(최근 14일 창만 채워짐). 위의 기본 backfill은 파일 전체를 덮어쓰므로, 이럴 땐 병합 모드를 씁니다:
이력이 없는 컬럼의 **빈칸만** 채우고, 값이 있는 칸·기존 컬럼·행(날짜)은 건드리지 않습니다.
한 번 채우면 다음 실행부터 대상에서 빠져 같은 명령을 다시 돌려도 안전합니다.

```bash
python scripts/backfill_market_data.py --merge --dry-run   # 먼저: 어떤 컬럼에 몇 칸 채워지는지만 출력
python scripts/backfill_market_data.py --merge             # 실제 기록
python scripts/backfill_market_data.py --merge --columns wti_front,kospi   # 대상 직접 지정 (그래도 빈칸만)
```

GitHub에서는 **Backfill Market History → Run workflow**에서 `merge`(와 먼저 `dry_run`)를 체크합니다.
`wti_front_4w`(28일 전 대비)는 `wti_front`에 28일치 이상 이력이 쌓여야 `no_data`를 벗어나므로,
새 컬럼을 추가한 뒤에는 이 병합을 한 번 돌려 두세요.

> ⚠️ **뉴스 언급량(attention.csv)은 소급 불가입니다.** Google News RSS가 과거 데이터를
> 제공하지 않기 때문이며, 오늘부터 매일 쌓입니다. 반감기 판정은 최소 1~2주치가
> 모여야 의미 있는 값이 나옵니다.

### 데이터는 누적됩니다

일일 수집 스크립트는 매번 **최근 14일 치를 원천에서 다시 받아 데이터 기준일로 덮어쓰고**
그 이전 행은 그대로 둡니다. 그래서 며칠 늦게 발표되는 FRED 값도 나중에 채워지고,
예약 실행이 늦거나 하루 빠져도 날짜가 비지 않습니다. 파일은 계속 쌓이며 git 이력에도 전부 남습니다.
`backfill`은 기존 파일 전체를 덮어쓰므로 최초 1회만 실행하세요.

`regime_state.json`은 매일 덮어써지는 '지금 판정'이고, 판정 이력은 `regime_log.csv`에
데이터 기준일 한 줄씩 쌓입니다 (같은 기준일로 다시 돌면 그 줄을 덮어씀).

### 구글 시트 사본 (선택)

시트에 붙인 Apps Script 웹 앱으로 `market_snapshot`·`attention`·`watchlist_attention`·`regime_log`를
탭별로 누적합니다 (`scripts/push_to_sheets.py`). 시트는 이미 있는 키(날짜 등)를 다시 쓰지 않고
새 행만 추가하므로, 늦게 채워지는 값이 반영되도록 **7일이 지나 확정된 행만** 보냅니다.
저장소 Secrets에 `SHEETS_WEBAPP_URL`·`SHEETS_TOKEN`이 없으면 이 단계는 건너뜁니다.

`events` 탭은 다릅니다. `events.json`은 날짜별 기록이 아니라 상태가 바뀌는 목록(자동 전환으로
active→dormant 등)이라, 이벤트당 한 줄로 두고 **id가 같은 줄을 매번 덮어써서** 현재 상태를 그대로
비춥니다 (확정 대기 없음). 상태 변경 이력이 필요하면 git 이력을 보세요. 목록·dict 필드는
`a | b | c` 문자열과 JSON 문자열로 펼쳐 담깁니다.

시트 쪽 코드의 원본은 `scripts/sheets_webapp.gs`입니다. 설정 방법:
1. 시트 → **확장 프로그램 → Apps Script**에 이 파일 내용을 붙여넣고 저장
2. **프로젝트 설정 → 스크립트 속성**에 `TOKEN` = 임의의 긴 문자열
3. **배포 → 새 배포 → 웹 앱** (실행: 나, 액세스: 모든 사용자) → 웹 앱 URL 복사
4. 저장소 Secrets: `SHEETS_WEBAPP_URL` = 그 URL, `SHEETS_TOKEN` = 2번 값
   (배포 창에 함께 뜨는 **배포 ID**(`AKfycb…`)는 URL 안에 이미 들어 있는 값이라 토큰으로 쓰면 안 됨)

수집 컬럼이 늘어도 시트 탭은 알아서 따라옵니다 — 새 열 이름을 머리글에 달고(기본 26열을 넘으면 열도 늘림),
이미 쌓인 행은 **빈칸만** 같은 날짜의 값으로 채웁니다(값이 있는 칸은 절대 덮어쓰지 않음). 그래서
`backfill --merge`를 시트 전송보다 나중에 돌려도 과거치가 시트에 따라옵니다. 이 동작은 새 열이 기존 열
**뒤에** 붙고 앞 열 순서가 같을 때만 합니다 — `COLUMNS`를 바꿀 땐 기존 컬럼 순서를 건드리지 마세요.

코드를 고친 뒤에는 **배포 → 배포 관리 → 수정(연필) → 버전: 새 버전**으로 다시 배포해야
반영됩니다 (이렇게 하면 URL이 그대로라 Secrets를 바꿀 필요가 없음).

> ⚠️ 컬럼이 늘어난 CSV를 처음 보내기 **전에** 갱신된 `sheets_webapp.gs`를 먼저 배포하세요. 옛 코드는 26열을 넘는
> 새 행을 쓰지 못해 전송이 실패합니다(수집·커밋에는 영향 없고, 재배포 후 다음 실행에서 이어 붙음).
> ⚠️ `watchlist_attention`·`events` 탭을 쓰려면 이 갱신된 `sheets_webapp.gs`로 **먼저 다시 배포**하세요.
> 예전 코드가 배포된 채로 두면 `watchlist_attention`이 날짜 하나만으로 중복 판정돼 키워드 대부분이
> 빠진 채 쌓이고, `events`는 새 이벤트만 추가될 뿐 상태 변경이 반영되지 않습니다
> (재배포 후 다음 실행에서 빠진 행은 자동으로 채워지지만 시트 안의 행 순서는 날짜순이 아닐 수 있음).

## 5. 이벤트 기록 방법 (수동)

`docs/data/events.json` 을 직접 편집 후 커밋하면 대시보드에 즉시 반영됩니다.

```json
{
  "id": "고유id-연도",
  "name": "내러티브명",
  "layer": "political | cyclical | structural",
  "trigger_date": "YYYY-MM-DD",
  "peak_date": "YYYY-MM-DD 또는 null",
  "half_life_date": "YYYY-MM-DD 또는 null",
  "status": "active | dormant | ended",
  "intensity": "high | mid | low",
  "assets": ["dollar", "gold", "oil", "us10y", "equity_bigtech", "..."],
  "keywords": ["워치리스트 키워드"],
  "reignition_triggers": ["재점화 조건"],
  "notes": "메모"
}
```

강도(intensity) 판정 기준은 아래를 참고해 주관을 최소화하세요:

| 등급 | 기준 |
|---|---|
| high(상) | 당일 VIX 15%+ 급등 또는 자산 5%+ 변동, 2개 이상 자산군 동시반응, 헤드라인 2주+ 지속 |
| mid(중) | 특정 자산군 국한 2~5% 변동, 1~2주 지속 |
| low(하) | 1~2% 이내 노이즈, 며칠 내 소멸 |

## 6. 폴더 구조

```
narrative-tracker/
├── README.md
├── requirements.txt
├── scripts/
│   ├── collect_market_data.py       # 일일 시장 지표 수집
│   ├── backfill_market_data.py      # 과거 데이터 일괄 소급 (최초 1회) · 수집 심볼 목록(FDR_SYMBOLS)
│   ├── fred_api.py                  # FRED 공식 API 클라이언트 (FRED_API_KEY 있을 때)
│   ├── fred_catalog.py              # 시리즈별 수집 경로·FRED 메타데이터 → fred_series.json
│   ├── fred_check.py                # FRED API 점검 (CI)
│   ├── resync_fred.py               # CSV의 FRED 컬럼을 FRED 원본과 대조·재동기화
│   ├── fsc_api.py                   # 공공데이터포털 금융위원회 API 클라이언트 (DATA_GO_KR_KEY)
│   ├── fsc_check.py                 # 금융위원회 API 점검 (CI)
│   ├── collect_financials.py        # 기업 재무 수집 → docs/data/financials/
│   ├── collect_news.py              # 일일 뉴스 언급량 수집
│   ├── auto_transition.py           # 언급량 규칙으로 이벤트 상태 자동 전환 (명백한 경우만)
│   ├── compute_regime.py            # 레짐 판정 → regime_state.json + regime_log.csv
│   ├── push_to_sheets.py            # 확정된 행을 구글 시트로 누적 (선택)
│   └── deploy_web.py                # web/out/ → docs/ 병합 (docs/data/는 보존)
├── .github/workflows/
│   ├── collect.yml                  # 매일 자동 실행 (수집 + 레짐 판정)
│   ├── backfill.yml                 # 수동 실행 (과거 데이터 소급)
│   ├── fred_refresh.yml             # 매일 밤 시장 지표·레짐만 다시 갱신 (FRED 전일 값 반영)
│   ├── financials.yml               # 기업 재무 수집 (주 1회 + 수동 추가)
│   ├── deploy_web.yml               # web/ 변경 시 자동 빌드 후 docs/에 병합
│   └── test.yml                     # scripts/·tests/ 변경 시 파이썬 테스트 + FRED·금융위 API 점검
├── config/
│   ├── regime_thresholds.json       # 레짐 판정 임계값 (locked:false 첫 초안)
│   └── companies.json               # 기업 재무 조회 목록 (법인번호·사업자번호·회사명)
├── tests/                           # python -m unittest discover -s tests
│   ├── test_fred.py                 # FRED API 경로
│   └── test_fsc.py                  # 금융위원회 API·기업 재무 수집·FRED 재동기화
├── web/                              # Next.js 대시보드 소스 — CoreUI 기반 (web/README.md 참고)
└── docs/                            # GitHub Pages 배포 폴더 — web/ 빌드 결과가 여기 들어감
    ├── index.html                   # web/의 next build 결과 (deploy_web.py가 병합)
    ├── _next/                       # 위와 동일
    └── data/
        ├── events.json              # 내러티브 이벤트 기록
        ├── market_snapshot.csv      # 자동 수집되는 정량 지표
        ├── manual_inputs.json       # ISM PMI 등 수동 갱신값
        ├── regime_state.json        # compute_regime.py 출력 (오늘의 레짐 판정)
        ├── regime_log.csv           # 레짐 판정 이력 (데이터 기준일 한 줄씩)
        ├── fred_series.json         # FRED 시리즈별 수집 경로·메타데이터 (fred_catalog.py)
        └── financials/              # 기업 재무 (index.json + 법인번호별 JSON)
```

> `docs/` 안에서 `data/`만 파이썬 스크립트가 쓰는 실데이터라 절대 안 건드림.
> 나머지(`index.html`, `_next/` 등)는 `web/`을 빌드할 때마다 통째로 교체됨 —
> 직접 편집하지 말 것(다음 배포 때 사라짐). 화면을 고치려면 `web/` 소스를 고칠 것.

## 7. 데이터 소스 (전부 무료 · FRED는 API 키가 있으면 공식 API, 없으면 fdr)

| 지표 | 심볼 (`FRED:`는 FRED API/fdr, 나머지는 fdr) | 설명 |
|---|---|---|
| VIX | `FRED:VIXCLS` | CBOE 변동성지수 |
| 달러(DXY) | Stooq `dx.f` | **ICE 달러인덱스** — 6개 통화(유로 약 58%), 1973 = 100. 뉴스에서 말하는 '달러인덱스'. 99~105 대역. |
| 달러(광의) | `FRED:DTWEXBGS` | **연준 광의 달러지수** — 26개 통화, 2006.1 = 100. 원화·위안 포함. 118~122 대역. |

| WTI 원유 | `FRED:DCOILWTICO` | WTI 현물 가격 |
| 美 10년물 금리 | `FRED:DGS10` | 국채 10년물 수익률 |
| **연준 기준금리** | `FRED:DFEDTARU` | 연방기금금리 목표 상단 — FOMC 결정 시에만 값이 바뀌는 계단형 시계열 |
| 금 | `GC=F` | fdr이 야후를 경유해 조회 (FRED에 무료 실시간 금 시리즈 없음) |
| 美 2년물 금리 | `FRED:DGS2` | 10Y와 묶어 2s10y 스프레드(장단기 역전 여부) 계산용 |
| 하이일드 스프레드 | `FRED:BAMLH0A0HYM2` | ICE BofA 하이일드 옵션조정스프레드 — 신용스트레스 판정용 |
| 10년 기대인플레이션(BEI) | `FRED:T10YIE` | 레짐 판정(골디락스/인플레/스태그플레/디플레) 축 중 하나 |
| NFCI | `FRED:NFCI` | 시카고연은 금융여건지수 — 주간(금요일) 갱신, 0=평균 |
| STLFSI4 | `FRED:STLFSI4` | 세인트루이스연은 금융스트레스지수 — 주간(금요일) 갱신, 0=평균 |
| WTI 근월물 | `CL=F` → `wti_front` | 리포트 1차 소스와 맞춘 선물가. 위 `wti`(FRED 현물)는 교차확인용으로 유지 |
| 브렌트 근월물 | `BZ=F` → `brent_front` | |
| 원/달러 · KOSPI | `USD/KRW` → `usdkrw`, `KS11` → `kospi` | 한국 시장 값만 있는 날은 행을 새로 만들지 않음(아래 참고) |
| 원/달러(연준) | `FRED:DEXKOUS` → `usdkrw_fred` | H.10 — 야후 값과 교차확인, 발표 지연 있음 |
| 美 30년물 · 실질 10년 · 기간프리미엄 | `FRED:DGS30` `DFII10` `THREEFYTP10` → `us30y` `real10y` `term_premium10y` | 일간 |
| 신용 | `FRED:BAMLC0A0CM` `BAMLH0A3HYC` → `ig_oas` `ccc_oas` | 투자등급 OAS · CCC 이하 OAS (일간) |
| 단기자금 | `FRED:SOFR` `IORB` `RRPONTSYD` → `sofr` `iorb` `rrp` | SOFR·역레포 일간, **IORB는 FOMC 때만 바뀌는 계단형(ffill)** |
| 연준 대차대조표 | `FRED:WALCL` `WRESBAL` `WTREGEN` → `fed_assets` `reserves` `tga` | **주간(수요일)이라 ffill**. 단위는 FRED 원본 그대로(시리즈마다 백만/십억 달러) — 대시보드가 십억 달러로 환산 |

> 두 지수는 **서로 다른 지표**입니다. 2026년 4월 기준 광의 118.9 vs DXY 98.9로 20p 넘게 차이 납니다.
> 헤드라인 대조용은 DXY, 한국 매크로 분석용은 원화·위안이 반영된 광의지수가 적합합니다.

일간 시리즈(`us30y`·`ig_oas`·`sofr`·`rrp` 등)는 발표가 며칠 늦을 뿐 값이 매일 바뀌므로 채우지 않고 빈칸으로 두면
14일 재수집 창이 나중에 채웁니다. 주간·계단형(`STEP_COLUMNS`)만 앞의 값으로 이어 채웁니다. 한국 시장 값
(`usdkrw`·`kospi`)은 이미 있는 행에만 들어가고, 미국 휴장일에 한국 값만 있다고 행을 만들지 않습니다
(만들면 마지막 행 날짜가 밀려 레짐 기준일·`regime_log` 줄 수가 달라짐).
새 컬럼은 `COLUMNS` **맨 뒤**에 추가합니다(구글 시트가 열 위치로 이어 붙기 때문).

`us2y`·`hy_oas`·`breakeven10y`·`nfci`·`stlfsi4` 5개는 `scripts/compute_regime.py`가 레짐 판정에 쓴다(2026-10에 추가한 컬럼은 판정에 쓰지 않음). ISM 제조업 PMI는
무료 실시간 시리즈가 없어 `docs/data/manual_inputs.json`에 매달 보도자료
헤드라인 숫자를 수동으로 넣는다.

`regime_state.json`의 `report_crosscheck` 키는 외부 리포트 물가축과 맞춰 보는 출력 전용 값입니다(판정에는
안 쓰임): `wti_front_4w`(WTI 근월물 최신값 vs 28일 전, 그날이 휴장이면 직전 거래일)와 `breakeven_3m`(인플레
판정과 같은 식의 BEI 3개월 변화 — PMI가 만료돼 판정이 '미확인'이어도 계속 나옴).

`FRED:` 심볼은 `FRED_API_KEY`가 있으면 `scripts/fred_api.py`가 `fred/series/observations`로 받고,
키가 없거나 그 시리즈의 API 호출이 실패하면 `fdr.DataReader('FRED:시리즈ID', start, end)`(키 없이 fredgraph.csv를
감싼 것)로 받습니다. 시리즈마다 실제로 어느 경로를 탔는지는 `docs/data/fred_series.json`의 `via`와 대시보드
'데이터 소스' 표에서 확인합니다.

**연준 유동성 카드** — `순유동성 = 총자산(WALCL) − TGA(WTREGEN) − 역레포(RRPONTSYD)`를 십억 달러로 맞춰 그리는
화면 전용 계산입니다(레짐 판정에는 안 씀). 단위 환산은 `fred_series.json`의 FRED 메타데이터 단위를 우선 쓰고,
없으면 기본값(`scripts/fred_catalog.py`의 `EXPECTED_UNITS` = `web/lib/liquidity.ts`의 `FALLBACK_UNITS`)을 씁니다.
메타데이터 단위가 기본값과 다르면 수집 로그에 `[WARN] … 단위가 …` 가 찍힙니다.

대시보드 차트에서 연준 기준금리는 계단형(stepped) 라인으로 표시되어, FOMC 회의마다
금리가 바뀌는 시점을 시각적으로 바로 확인할 수 있습니다.

## 8. 참고 / 한계

- FRED 데이터는 보통 1영업일 지연되어 갱신됩니다 (실시간 X).
- `DFEDTARU`는 FOMC 결정이 있는 날에만 값이 바뀌므로, 대부분의 날짜에는 이전 값이 그대로
  이어집니다 — 이건 정상 동작입니다(계단형 시계열의 특성).
- `DTWEXBGS`는 결측일이 보일 수 있습니다. Actions 로그의 `[WARN]`을 확인하세요 — 해당 칸은
  빈 값으로 남고 다음날 재시도됩니다.
- 금(`GC=F`) 조회가 실패하면 `scripts/collect_market_data.py`의 `SYMBOLS` 딕셔너리에서
  Stooq 등 다른 fdr 지원 심볼로 교체 가능합니다.
- 운영 루틴 제안: 주 1회 `events.json` 을 검토하며 ①활성 이벤트 상태 갱신 ②신규 트리거
  스캔 ③휴면 이벤트 재점화 여부 체크
