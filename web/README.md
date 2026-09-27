# 내러티브 레짐 트래커 — 대시보드 (Next.js)

`docs/index.html`(기존 정적 페이지)을 대체하는 프런트엔드. `output: 'export'`로
빌드해 `docs/`에 넣고 GitHub Pages(브랜치 main)로 서빙한다.

## 화면 구성

기존 페이지의 섹션·순서·계산 로직을 그대로 옮기고, 레짐 카드만 새로 추가했다.

| 섹션 | 데이터 | 컴포넌트 |
|---|---|---|
| 상단 지표 티커 (7개) | market_snapshot.csv | `kpi/MarketTicker` |
| 현재 레짐 + 판정 근거 | regime_state.json | `kpi/RegimeCard` |
| 지층 단면 — 내러티브 타임라인 | events.json | `narrative/NarrativeStrata` |
| 지속기간 · 시장영향 매트릭스 (+종료 아카이브) | events.json + market_snapshot.csv + attention.csv | `narrative/NarrativeMatrix` |
| 활성 · 휴면 이벤트 | 위와 동일 | `narrative/NarrativeEventCard` |
| 내러티브 언급량 | attention.csv | `narrative/AttentionCharts` |
| 정량 지표 추이 (기간 필터) | market_snapshot.csv | `charts/MarketIndicatorsChart` |

이벤트별 지표(트리거 전후 5일 자산 변동, 층별 통상 지속기간 대비 지속성, 관심도×영향
사분면)는 `lib/narrative-metrics.ts`에 있다 — 기존 페이지 JS를 타입만 붙여 옮긴 것.

기존 페이지와 의도적으로 다르게 한 것:
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
- events.json notes의 백테스트 수치 중 일부(이란 전쟁 'VIX +58.3%', 하마스 '유가 +4.6%')가
  대시보드 계산(트리거 직전 행 → 5행 뒤, 기존 페이지와 동일)과 다름. 대시보드는 각각
  +48.5%, +6.5%로 나오며 데이터 재소급 전후 CSV 모두 같은 값 — 노트 쪽 계산 기준 확인 필요

## 알아둘 것 — `trailingSlash: true`

`output: "export"` + `basePath`에서 이게 없으면 `/narrative-tracker`(슬래시 없이) 접속 시
클라이언트의 상대경로 fetch가 `basePath` 밖으로 풀려 404가 난다(브라우저 표준 상대 URL
해석이 마지막 세그먼트를 파일명으로 보고 치환함).
