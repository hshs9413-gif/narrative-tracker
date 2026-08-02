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
  `docs/data/market_snapshot.csv` 에 한 행씩 추가하고 자동 커밋합니다.
- 바로 테스트하려면: 저장소 **Actions 탭 → Collect Market Data → Run workflow** 로 수동 실행

## 3. 자동화 구조

| 단계 | 대상 | 주체 | 주기 |
|---|---|---|---|
| 수집 | 정량 지표 (VIX·달러·금·WTI·금리) | Actions + FRED/Stooq | 매일 07:30 KST |
| 수집 | 내러티브 언급량 (기사 수) | Actions + Google News RSS | 매일 07:30 KST |
| 판정 | 반감기·휴면·강도 **자동 계산** | `propose_updates.py` (결정론적 코드) | 매주 월 07:00 KST |
| 검증 | 웹 대조 + 신규 내러티브 탐지 | Gemini API + Google 검색 그라운딩 | 매주 월 07:00 KST |
| **승인** | `events.json` 실제 반영 | **사용자** | 이슈 확인 후 |

**핵심 설계**: 스크립트는 `events.json`을 절대 직접 수정하지 않습니다. 매주 GitHub Issue로
제안만 올리고, 사람이 확인 후 반영합니다. 자동 분류를 그대로 반영하면 오탐이 쌓여
트래커 자체를 신뢰할 수 없게 되기 때문입니다.

### 자동 판정 로직 (코드가 계산 — LLM 판단 아님)

**반감기·휴면** — 기사 수 7일 이동평균 기준
| 정점 대비 | 판정 |
|---|---|
| 50% 이상 | active 유지 |
| 25~50% | 반감기 도달 (강도 하향 검토) |
| 25% 미만 | dormant 전환 제안 |

**강도** — 시장 지표 1일 변동폭 기준
| 조건 | 판정 |
|---|---|
| VIX +15% 이상 또는 2개 이상 자산군 5%+ 변동 | high (상) |
| VIX ±5% 이상 또는 1개 자산군 5%+ 변동 | mid (중) |
| 그 외 | low (하) |

관측일수 3일 미만이면 "데이터 부족"으로 표시되며 상태 변경을 제안하지 않습니다.

### Gemini API 설정 (선택 — 없어도 정량 판정은 동작)

무료 티어로 충분합니다. Gemini 3 모델 기준 월 5,000건의 검색 그라운딩 프롬프트가 무료이며,
이 트래커는 주 1회만 호출합니다.

1. https://aistudio.google.com/apikey 접속 → **Create API key**
2. 저장소 **Settings → Secrets and variables → Actions → New repository secret**
3. Name: `GEMINI_API_KEY` / Secret: 발급받은 키 → **Add secret**

모델을 바꾸려면 같은 화면의 **Variables** 탭에서 `GEMINI_MODEL` 변수를 추가하세요
(미설정 시 `gemini-3.6-flash` 사용).

**검색 그라운딩이란**: Gemini가 답변 전에 실제로 Google 검색을 실행하고, 사용한 검색어와
출처 URL을 함께 반환합니다. 생성된 Issue의 7번 항목에 검색 기록이 그대로 실리므로
LLM이 지어낸 내용인지 직접 확인할 수 있습니다.

키가 없으면 웹 검증 단계만 건너뛰고 정량 신호 리포트는 정상 생성됩니다.

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

> ⚠️ **뉴스 언급량(attention.csv)은 소급 불가입니다.** Google News RSS가 과거 데이터를
> 제공하지 않기 때문이며, 오늘부터 매일 쌓입니다. 반감기 판정은 최소 1~2주치가
> 모여야 의미 있는 값이 나옵니다.

### 데이터는 누적됩니다

일일 수집 스크립트는 CSV에 **한 줄씩 덧붙이고**(append) 저장소에 커밋합니다.
매일 초기화되는 것이 아니라 계속 쌓이며, git 이력에도 전부 남습니다.
`backfill`은 기존 파일을 덮어쓰므로 최초 1회만 실행하세요.

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
│   ├── backfill_market_data.py      # 과거 데이터 일괄 소급 (최초 1회)
│   ├── collect_news.py              # 일일 뉴스 언급량 수집
│   └── propose_updates.py           # 주간 리뷰 제안 (Gemini 검증)
├── .github/workflows/
│   ├── collect.yml                  # 매일 자동 실행
│   ├── backfill.yml                 # 수동 실행 (과거 데이터 소급)
│   └── weekly_review.yml            # 매주 자동 실행
└── docs/                            # GitHub Pages 배포 폴더
    ├── index.html                   # 대시보드
    └── data/
        ├── events.json              # 내러티브 이벤트 기록
        └── market_snapshot.csv      # 자동 수집되는 정량 지표
```

## 7. 데이터 소스 (전부 무료, API 키 불필요 · FinanceDataReader 하나로 통일)

| 지표 | 심볼 (fdr에 전달) | 설명 |
|---|---|---|
| VIX | `FRED:VIXCLS` | CBOE 변동성지수 |
| 달러(DXY) | Stooq `dx.f` | **ICE 달러인덱스** — 6개 통화(유로 약 58%), 1973 = 100. 뉴스에서 말하는 '달러인덱스'. 99~105 대역. |
| 달러(광의) | `FRED:DTWEXBGS` | **연준 광의 달러지수** — 26개 통화, 2006.1 = 100. 원화·위안 포함. 118~122 대역. |

> 두 지수는 **서로 다른 지표**입니다. 2026년 4월 기준 광의 118.9 vs DXY 98.9로 20p 넘게 차이 납니다.
> 헤드라인 대조용은 DXY, 한국 매크로 분석용은 원화·위안이 반영된 광의지수가 적합합니다.
| WTI 원유 | `FRED:DCOILWTICO` | WTI 현물 가격 |
| 美 10년물 금리 | `FRED:DGS10` | 국채 10년물 수익률 |
| **연준 기준금리** | `FRED:DFEDTARU` | 연방기금금리 목표 상단 — FOMC 결정 시에만 값이 바뀌는 계단형 시계열 |
| 금 | `GC=F` | fdr이 야후를 경유해 조회 (FRED에 무료 실시간 금 시리즈 없음) |

`fdr.DataReader('FRED:시리즈ID', start, end)` 형태로 FRED 데이터를 키 없이 그대로 감싸서
제공하므로, 별도 requests 코드 없이 하나의 라이브러리·인터페이스로 전부 수집합니다.

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
