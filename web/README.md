# 내러티브 레짐 트래커 — 대시보드 (Next.js)

`docs/index.html`(기존 정적 페이지)을 대체하는 프런트엔드. `output: 'export'`로
빌드해 `docs/`에 넣고 GitHub Pages(브랜치 main)로 서빙한다.

## 디자인

화면 틀은 **CoreUI 무료 React 대시보드**를 따른다 — 좌측 사이드바(섹션 메뉴·스크롤 스파이),
상단 헤더(데이터 기준일·테마 전환)와 브레드크럼, 색 카드 위젯 + 스파크라인, 카드·표·배지·진행바.
`@coreui/coreui`(CSS)·`@coreui/react`(컴포넌트)·`@coreui/react-chartjs`(Chart.js 래퍼)를 그대로 쓰고,
색은 전부 `--cui-*` 변수라 라이트/다크가 같이 바뀐다(헤더의 테마 버튼, 선택은 localStorage 저장).
앱 전용 스타일은 `app/globals.css` 한 곳 — 도메인 색 매핑(`--nt-*`)과 타임라인·매트릭스 레이아웃.
(예전 Tailwind 다크 단일 팔레트는 걷어냈다.)

## 화면 구성

기존 페이지의 섹션·순서·계산 로직을 따르고, 레짐 카드와 '데이터 상태' 안내가 새로 추가됐다.

| 섹션 | 데이터 | 컴포넌트 |
|---|---|---|
| 데이터 상태 (기준일 범위·수집 중단·PMI 만료 경고) | market_snapshot.csv + regime_state.json | `kpi/DataStatus` |
| 상단 위젯 8개 (값·등락·기준일·스파크라인) | market_snapshot.csv | `kpi/MarketWidgets` |
| 현재 레짐 + 판정 근거(항목별 기준일) + 리포트 교차확인 | regime_state.json | `kpi/RegimeCard` |
| 지층 단면 — 내러티브 타임라인 | events.json | `narrative/NarrativeStrata` |
| 지속기간 · 시장영향 매트릭스 (+종료 아카이브) | events.json + market_snapshot.csv + attention.csv | `narrative/NarrativeMatrix` |
| 활성 · 휴면 이벤트 | 위와 동일 | `narrative/NarrativeEventCard` |
| 내러티브 언급량 | attention.csv | `narrative/AttentionCharts` |
| 정량 지표 추이 (기간 필터) | market_snapshot.csv | `charts/MarketIndicatorsChart` |

### 숫자를 믿고 써도 되는지 보여주는 장치

값만 보여주면 어느 날짜 값인지, 이상한 값인지 알 수 없어서 아래를 화면에 드러낸다 (`lib/freshness.ts`,
`lib/series.ts`, 지표별 기준은 `lib/indicators.ts`). 데이터를 고치지는 않고 보여주기만 한다.

- **지표별 기준일** — 위젯·차트 카드마다 '기준 26.10.07 · 2일 늦음'. FRED는 지표마다 발표가 달라 한 화면의 값 날짜가
  제각각이다. 지표별 허용 지연(`staleAfterDays`)을 넘으면 '지연' 배지. 상단에 기준일 범위와 3일 넘게 뒤처진 지표 목록.
- **수집 중단 감지** — 데이터 기준일이 오늘보다 4일 넘게 앞서 있으면 헤더 배지와 상단 안내가 경고색으로 바뀐다.
- **급변 표시** — 직전 관측 대비 지표별 임계값(`jump`)을 넘게 움직인 점을 차트에 빨간 점, 위젯에 '급변' 배지로.
  실제 급변일 수도 수집 오류일 수도 있어 '원본 확인용'이다. 임계값은 3년치 전일 대비 변동 분포를 보고 잡았다.
- **PMI 만료 임박/초과** — ISM PMI는 수동 입력이라 `pmi_max_age_days`(75일, `PMI_MAX_AGE_DAYS`로 미러링 —
  `config/regime_thresholds.json`과 같이 바꿀 것)를 넘기면 성장·물가 판정이 '미확인'이 된다. 14일 전부터 안내한다.
- **결측 처리** — 차트는 값이 있는 관측일만 이어 그리고, 관측 사이가 7일을 넘게 비면 선을 끊는다(값을 보간하지 않음).
- 새로 수집하는 컬럼(`wti_front`·`kospi` 등)은 값이 한 번도 없으면 차트 카드가 자동으로 빠지고, 쌓이면 나타난다.

이벤트별 지표(트리거 전후 5일 자산 변동, 층별 통상 지속기간 대비 지속성, 관심도×영향
사분면)는 `lib/narrative-metrics.ts`에 있다 — 기존 페이지 JS를 타입만 붙여 옮긴 것.

시장영향은 자산별로 **트리거일 직전 마지막 관측 → 트리거일 이후 첫 관측(T)에서 5번째 뒤 관측(T+5)**의 변동률이다.
예전 계산(트리거일에 가장 가까운 *행*의 인덱스 ±)은 CSV에 끼어 있는 월말 주말 행(HY OAS 등 FRED 월말 값만 있고
VIX·금·WTI가 빈 행)을 만나면 영향이 통째로 사라지고(연준 정치화·AI 밸류에이션이 '측정중'이던 원인), 주말 트리거(이란 전쟁·
하마스)는 기준일이 어긋났다. 평일 트리거(관세 충격·이스라엘-이란·대선·엔캐리)는 두 방식의 값이 같다.

기존 페이지와 의도적으로 다르게 한 것:
- 시장영향 계산: 위처럼 행 인덱스 대신 자산별 관측일 기준
- 언급량 차트: 한 차트에 '층 색'으로 겹쳐 그려 같은 층 내러티브끼리 구분이 안 됐음 →
  내러티브별 작은 차트 + 반감기(50%)·휴면(25%) 기준선
- 정량 지표 차트: y축 3개짜리 차트 하나 → 지표별 작은 차트, 기간 필터 하나가 전부에 적용
- 언급량 '정점 대비' 비율: 하루치 ÷ 하루 최대 → 7일 평균 ÷ 7일 평균 최대. 주간 리뷰
  Issue(`propose_updates.py`)와 같은 식이라 두 곳의 숫자가 일치한다 (하루치로는 연준
  정치화가 9%로 휴면선 아래였지만 실제 판정 기준으로는 29%)

## 로컬 개발

```bash
cd web
npm install
mkdir -p public/data
cp ../docs/data/* public/data/   # 실 데이터로 로컬 미리보기 (커밋 안 됨 — .gitignore 처리됨)
npm run dev                      # http://localhost:3000/narrative-tracker/
```

`basePath`가 `/narrative-tracker`로 고정돼 있어 로컬에서도 그 경로로 열어야 한다
(`next.config.ts`의 `REPO_NAME` 참고 — 저장소 이름이 바뀌면 여기도 같이 바꿀 것).

## 빌드 확인 (커밋 전 필수)

```bash
npm run lint
npm run build   # web/out/ 생성 확인, TypeScript·정적 생성 에러 0건
```

화면 작업이면 여기에 더해 1440px·375px에서 확인하고 콘솔 에러 0건까지 볼 것.

## 데이터 흐름

정적 export라 서버 데이터 패칭이 없다. 페이지가 클라이언트에서
`fetch("data/xxx")`(상대경로, 앞 슬래시 없음)로 직접 읽는다 — 매일 커밋되는
`docs/data/*`를 앱 재배포 없이 그대로 반영하기 위해서다. 여러 섹션이 같은 파일을
쓰므로 `lib/hooks/use-static-data.ts`가 경로별로 한 번만 받아 공유한다.

## 레짐 백엔드 (`scripts/compute_regime.py`, `config/regime_thresholds.json`)

이 프런트엔드가 처음 가정했던 `regime_state.json`은 원래 저장소에 없었어서 같이 만들었다.

- FRED 시리즈 5개(`us2y`=DGS2, `hy_oas`=BAMLH0A0HYM2, `breakeven10y`=T10YIE,
  `nfci`=NFCI, `stlfsi4`=STLFSI4)를 기존 수집 스크립트와 같은 방식(FinanceDataReader
  `FRED:` 프리픽스, API 키 불필요)으로 추가.
- ISM 제조업 PMI는 무료 실시간 API가 없어 `docs/data/manual_inputs.json`에 매달 수동
  갱신 — as_of가 75일을 넘으면 성장·인플레 판정이 '미확인'으로 바뀐다.
- 성장 = PMI≥50, 인플레 = BEI 28일 평균의 3개월 변화 ≥ +0.05%p. 임계값 근거와
  백테스트 결과는 `config/regime_thresholds.json`의 `rationale`·`note`에 있다.
- `locked: false`인 동안 화면에 '임계값 초안' 경고가 뜬다.

## 배포 (`docs/`에 병합)

`main`에 `web/**` 변경이 push되면 `.github/workflows/deploy_web.yml`이 자동으로
`npm run build` → `python scripts/deploy_web.py`(→ `docs/`에 병합, `docs/data/`는
항상 보존) → 커밋까지 처리한다. 로컬에서 미리 확인하려면:

```bash
cd web && npm run build
cd .. && python scripts/deploy_web.py   # docs/ 미리보기 (git add 전에 diff 확인)
```

## 아직 안 된 것

- 정량 지표 차트의 표 형태 뷰 — 지금은 호버 툴팁 + 끝값 + 기간 저/고로만 값에 접근 가능
- regime_history.json (레짐 전환 이력) — 계획만 있고 생성 스크립트 없음
- regime_thresholds.json 검증 후 `locked: true` 전환
- events.json notes의 백테스트 수치 중 이란 전쟁('VIX +58.3%', '유가 +39.4%')은 CSV로 재현되지 않는다 — 같은 정의
  (T-1 → T+5)로 계산하면 VIX +28.4%, WTI +41.4%. 하마스 '유가 +4.6%'는 이 정의로 정확히 재현된다(+4.6%).
  평일 트리거 이벤트(관세 +89.3%, 대선 -31.6% 등)는 노트·대시보드·재계산이 모두 일치. 이란 전쟁 노트는
  다른 데이터·기준으로 쓴 것으로 보이니 노트 쪽 계산 근거를 확인할 것 (events.json은 직접 수정하지 않는다)
- 한 달 말일이 주말이면 CSV에 그 날짜 행이 생긴다 (FRED 하이일드 등 월말 값) — 다른 지표는 비어 있다. 지금은
  화면 계산이 이 행에 흔들리지 않게 해뒀지만, 수집 쪽에서 막을지는 결정이 필요하다

## 알아둘 것 — `trailingSlash: true`

`output: "export"` + `basePath`에서 이게 없으면 `/narrative-tracker`(슬래시 없이) 접속 시
클라이언트의 상대경로 fetch가 `basePath` 밖으로 풀려 404가 난다(브라우저 표준 상대 URL
해석이 마지막 세그먼트를 파일명으로 보고 치환함).
