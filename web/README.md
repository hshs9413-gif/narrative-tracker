# 레짐 네러티브 트래커 — 대시보드 (Next.js)

`docs/index.html`(기존 정적 페이지)을 대체할 새 프런트엔드. `output: 'export'`로
빌드해 여전히 `docs/`에 넣고 GitHub Pages(브랜치 main)로 서빙한다 — 백엔드
(scripts/, config/, docs/data/)는 전혀 안 건드림, 프레젠테이션 레이어만 교체.

## 로컬 개발

```bash
cd web
npm install
mkdir -p public/data
cp ../docs/data/*.json public/data/   # 실 데이터로 로컬 미리보기 (커밋 안 됨 — .gitignore 처리됨)
npm run dev                            # http://localhost:3000/narrative-tracker
```

`basePath`가 `/narrative-tracker`로 고정돼 있어 로컬에서도 그 경로로 열어야 한다
(`next.config.ts`의 `REPO_NAME` 참고 — 저장소 이름이 바뀌면 여기도 같이 바꿀 것).

## 빌드 확인 (커밋 전 필수)

```bash
npm run lint
npm run build   # web/out/ 생성 확인, TypeScript·정적 생성 에러 0건
```

화면 작업 시점부터는 여기에 더해 Playwright MCP로 1440px·375px 캡처, 콘솔 에러
(Hydration Warning 등) 0건까지 확인 — dashboard-project 컨벤션 그대로.

## 데이터 흐름

정적 export라 서버 데이터 패칭이 없다. 페이지가 클라이언트에서
`fetch("data/xxx.json")`(상대경로, 앞 슬래시 없음)로 직접 읽는다 — 매일 커밋되는
`docs/data/*.json`을 앱 재배포 없이 그대로 반영하기 위해서다 (기존 plain HTML
사이트와 동일한 패턴).

## 레짐 백엔드 (`scripts/compute_regime.py`, `config/regime_thresholds.json`)

이 프런트엔드가 처음 만들어질 때 가정했던 `regime_state.json`은 실제로는 이
저장소에 없었다 — `docs/data/`엔 내러티브 이벤트·시장지표만 있고 레짐 판정
로직 자체가 없었음. 그래서 `web/`을 붙이면서 백엔드도 같이 만들었다:

- `scripts/collect_market_data.py`·`backfill_market_data.py`에 FRED 시리즈
  5개 추가(`us2y`=DGS2, `hy_oas`=BAMLH0A0HYM2, `breakeven10y`=T10YIE,
  `nfci`=NFCI, `stlfsi4`=STLFSI4) — 전부 FinanceDataReader의 `FRED:` 프리픽스라
  API 키 불필요, 기존 수집 스크립트와 동일한 방식.
- `docs/data/manual_inputs.json` 신설 — ISM 제조업 PMI는 무료 실시간 API가
  없어 매달 보도자료 헤드라인을 수동 갱신(다음 갱신 2026-10-01).
- `config/regime_thresholds.json` 신설, `locked: false` — VIX·HY OAS 밴드,
  PMI/BEI 골디락스 매트릭스 분기점, 정책기조 lookback 등 전부 첫 초안 수치.
  화면의 "임계값 초안" 경고는 이게 `locked: true`가 되기 전까진 계속 뜬다.
- `scripts/compute_regime.py` 신설 — 지표별로 독립적으로 최신 유효값을
  찾는다(발표 지연이 지표마다 달라 한 행이 통째로 안 채워질 수 있음).
  `.github/workflows/collect.yml`에 `collect_market_data.py` 다음 스텝으로 연결.
- 실행해서 나온 첫 실데이터: 골디락스 / 신용 평상 / 정책 긴축, 스코어 90.

## 배포 (`docs/`에 병합)

`main`에 `web/**` 변경이 push되면 `.github/workflows/deploy_web.yml`이 자동으로
`npm run build` → `python scripts/deploy_web.py`(→ `docs/`에 병합, `docs/data/`는
항상 보존) → 커밋까지 처리한다. 로컬에서 미리 확인하려면:

```bash
cd web && npm run build
cd .. && python scripts/deploy_web.py   # docs/ 미리보기 (git add 전에 diff 확인)
```

## 아직 안 된 것

- 화면 컴포넌트는 Phase 2(레짐 카드)·3(내러티브 타임라인)·4(시장 지표 차트)까지
  다 붙었고 `npm run lint`·`npm run build`·`next dev` 실기동 + 실데이터로 확인함
- 차트 데이터의 접근 가능한 표 형태 뷰(dataviz 컨벤션의 "테이블 뷰") — 지금은
  호버 툴팁 + 끝값 라벨 + 범위 텍스트로만 값에 접근 가능, 전체 시계열을 훑는
  표는 없음
- regime_history.json 오버레이(구간 배경 음영) — 지금 빈 배열이라 테스트도 못함
- regime_thresholds.json 임계값 검증 — 며칠치 실데이터로 라벨이 안 튀는지
  확인 후 `locked: true`로 전환할 것

## 알아둘 것 — `trailingSlash: true`

`next.config.ts`에 추가함. `output: "export"` + `basePath`에서 이게 없으면
`next dev`에서 `/narrative-tracker`(슬래시 없이) 접속 시 클라이언트의 상대경로
`fetch("data/xxx.json")`이 `basePath` 밖으로 풀려 404가 난다 — 브라우저의 표준
상대 URL 해석 규칙 때문(마지막 세그먼트를 "파일명"으로 보고 치환함). GitHub
Pages 배포본은 디렉토리 인덱스 리다이렉트로 우연히 안 걸릴 수도 있었지만, 로컬
개발 경험이 깨지는 게 더 큰 문제라 dev/export 양쪽 다 잡음.
