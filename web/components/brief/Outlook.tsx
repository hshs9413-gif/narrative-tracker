"use client";

import { useCorrelations, useForecast, useRanges } from "@/lib/hooks/use-dashboard-data";
import { BOARD_ROWS } from "@/lib/board";
import { monthDay } from "@/lib/brief";
import type { NextSessionForecast, RangeItem } from "@/types/dashboard";
import { formatNumber } from "@/lib/formatters";

// 다음 움직임 예상 — 차트 없이 글로: '상승/하락 예상 얼마, 오차범위 ±얼마'.
//  · 다음 한국 장: 어젯밤 미국 장으로 낸 회귀 예측(scripts/compute_forecast.py) — 한국 장이 미국 장보다 먼저 닫혀서 앞을 보는 예측이 된다
//  · 한 달 뒤: 변동 폭으로 낸 90% 범위(scripts/compute_ranges.py) — 방향은 맞힐 근거가 없어 범위만
//  · 자산끼리 관계: 주간 상관(scripts/compute_correlation.py) — 코스피가 빠질 때 받쳐 준 자산, 크게 바뀐 관계 두 줄
// 오차범위는 모두 '열 번 중 아홉 번 실제 값이 들어오는 폭'(90%).

const Z90 = 1.645;
const MONEY = new Set(["kospi", "usdkrw"]); // 직접 들고 있을 수 있는 것 — '1,000만 원어치면 얼마'를 같이 적는다
const SHORT: Record<string, string> = { 선형회귀: "선형회귀", 릿지: "릿지", 랜덤포레스트: "랜덤포레스트", 부스팅: "부스팅" };

function manwon(pct: number) {
  const v = Math.round(1000 * (pct / 100));
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${formatNumber(Math.abs(v), 0)}만`;
}

function signed(v: number, unit: string, digits: number) {
  const t = Math.abs(v).toFixed(digits);
  return `${Number(t) === 0 ? "±" : v > 0 ? "+" : "−"}${t}${unit}`;
}

function NextRow({ f }: { f: NextSessionForecast }) {
  if (f.pred === null || f.lo === null || f.hi === null) return null;
  const half = (f.hi - f.lo) / 2;
  const sd = half / Z90;
  const dir = Math.abs(f.pred) < 0.1 * sd ? "flat" : f.pred > 0 ? "up" : "down";
  const word = dir === "flat" ? "보합" : dir === "up" ? "상승" : "하락";
  const digits = f.unit === "bp" ? 1 : 2;
  const isRate = f.unit === "bp";
  const live = f.live;
  return (
    <li>
      <p className="nt-outlook-line">
        <b>{f.name}{isRate ? " 금리" : ""}</b> <span className="nt-outlook-dir" data-dir={dir}>{word}</span> 예상{" "}
        <span className="tnum">{signed(f.pred, f.unit, digits)}</span>, 오차범위{" "}
        <span className="tnum">±{half.toFixed(1)}{f.unit}</span>
        <span className="nt-outlook-when"> · {monthDay(f.target)} 장</span>
      </p>
      <p className="nt-outlook-why">
        {f.inputs}
        {f.dir_rate !== null && ` · 같은 방식으로 지난 기록을 미리 맞혀 보면 방향 ${Math.round(f.dir_rate * 100)}% 맞음`}
        {dir === "flat" && " · 예상 폭이 오차범위에 비해 아주 작아 방향 신호가 약함"}
      </p>
      {live.n > 0 && (
        <p className="nt-outlook-why">
          실제로 미리 낸 예측 {live.n}번: 방향 {live.dir_hits}/{live.dir_tried}번 맞음, 오차범위 안 {live.in_range}번
        </p>
      )}
      {f.board && f.board.length > 1 && (
        <p className="nt-outlook-why">
          모델 경쟁(최근 1년 미리 맞히기 설명력):{" "}
          {f.board.map((b, i) => (
            <span key={b.name} data-chosen={b.name === f.model ? "" : undefined} className="nt-outlook-model">
              {i > 0 && " · "}
              {SHORT[b.name] ?? b.name} {b.oos === null ? "—" : `${Math.round(b.oos * 100)}%`}
            </span>
          ))}{" "}
          → {f.model} 사용 (다른 모델이 2%p 넘게 앞서면 바뀜)
        </p>
      )}
    </li>
  );
}

function RangeRow({ it }: { it: RangeItem }) {
  const fmt = BOARD_ROWS.find((r) => r.id === it.id)?.format ?? ((v: number) => v.toFixed(2));
  const dn = it.kind === "bp" ? (it.lo - it.base) * 100 : (it.lo / it.base - 1) * 100;
  const up = it.kind === "bp" ? (it.hi - it.base) * 100 : (it.hi / it.base - 1) * 100;
  const unit = it.kind === "bp" ? "bp" : "%";
  const d = it.kind === "bp" ? 0 : 1;
  return (
    <li className="nt-or">
      <span className="nt-or-name">{it.label}</span>
      <span className="nt-or-pct tnum">
        <span data-dir="down">{signed(dn, unit, d)}</span>
        <span className="nt-or-sep"> ~ </span>
        <span data-dir="up">{signed(up, unit, d)}</span>
      </span>
      <span className="nt-or-detail">
        <span className="tnum">
          {fmt(it.lo)} ~ {fmt(it.hi)}
        </span>{" "}
        (지금 {fmt(it.base)})
        {MONEY.has(it.id) && it.kind === "log" && (
          <>
            {" "}
            · 1,000만 원어치면 <span className="tnum">{manwon(dn)} ~ {manwon(up)}</span> 원
          </>
        )}
      </span>
    </li>
  );
}

function RangeNotes({ items }: { items: RangeItem[] }) {
  const trend = items.map((it) => it.backtest.trend_hit).filter((v): v is number => typeof v === "number");
  const hits = items
    .filter((it) => it.backtest.rate !== null)
    .map((it) => {
      const bt = it.backtest;
      const r = Math.round(bt.rate! * 100);
      const missed = bt.above + bt.below;
      const side = missed >= 10 && Math.max(bt.above, bt.below) / missed >= 0.75 ? (bt.above > bt.below ? "위" : "아래") : null;
      return `${it.label} ${r}%${r < 85 ? `(좁게 잡는 편${side ? `, 빗나간 날 대부분 ${side}` : ""})` : ""}`;
    });
  return (
    <>
      {trend.length > 0 && (
        <p className="nt-outlook-note">
          <b>한 달 방향은 반반으로 봅니다.</b> 지난 3년 석 달 추세 방향으로 한 달 뒤 방향을 맞혀 보면{" "}
          {Math.round(Math.min(...trend) * 100)}~{Math.round(Math.max(...trend) * 100)}% — 동전 던지기 수준이라 위아래를 같은 확률로 잡았습니다.
          퍼센트 폭이 위쪽이 더 커 보이는 건 계산 방식(비율로 움직임) 때문이지 오를 쪽으로 기운 게 아닙니다.
        </p>
      )}
      {hits.length > 0 && <p className="nt-outlook-why">이 범위에 실제로 들어온 비율(지난 3년 되짚음): {hits.join(" · ")}</p>}
    </>
  );
}

function Relations() {
  const corr = useCorrelations();
  const c = corr.data;
  if (!c || (!c.hedge_line && !c.change_line)) return null;
  return (
    <>
      <h3 className="nt-outlook-h">
        자산끼리 관계 <small>주간 변화로 잰 상관 — 최근 6개월과 2년 비교{c.week ? `, ${monthDay(c.week)}까지` : ""}</small>
      </h3>
      <ul className="nt-outlook">
        {c.hedge_line && (
          <li>
            <p className="nt-outlook-rel">{c.hedge_line}</p>
          </li>
        )}
        {c.change_line && (
          <li>
            <p className="nt-outlook-rel">{c.change_line}</p>
          </li>
        )}
      </ul>
    </>
  );
}

export function Outlook() {
  const forecast = useForecast();
  const ranges = useRanges();
  const next = forecast.data?.next ?? [];
  const items = ranges.data?.items ?? [];
  if (forecast.loading && ranges.loading) return null;
  if (!next.length && !items.length) return null;

  return (
    <section id="outlook" className="nt-block">
      <h2 className="nt-h2">다음 움직임 예상</h2>
      <p className="nt-lede">오차범위는 열 번 중 아홉 번 실제 값이 들어오는 폭입니다. 예상 폭보다 오차범위가 훨씬 넓으니 방향 참고로만 보세요.</p>

      <h3 className="nt-outlook-h">
        다음 한국 장 <small>어젯밤 미국 장 기준 — 한국 장은 미국 장보다 먼저 닫혀서, 어젯밤 움직임은 아직 반영 전입니다</small>
      </h3>
      {next.length ? (
        <ul className="nt-outlook">
          {next.map((f) => (
            <NextRow key={f.name} f={f} />
          ))}
        </ul>
      ) : (
        <p className="nt-note">첫 예측은 다음 아침 수집(한국 장 시작 전)에 나옵니다.</p>
      )}

      {items.length > 0 && (
        <>
          <h3 className="nt-outlook-h">
            한 달 뒤({monthDay(items[0].due)} 무렵) 오르내릴 폭{" "}
            <small>열 번 중 아홉 번은 이 안 — 최근 석 달 하루 변동 폭이 이어진다고 볼 때</small>
          </h3>
          <ul className="nt-outlook">
            {items.map((it) => (
              <RangeRow key={it.id} it={it} />
            ))}
          </ul>
          <RangeNotes items={items} />
        </>
      )}

      <Relations />
      <p className="nt-note">
        예측과 범위는 매일 아침 기록하고 실제 값이 나오면 채점합니다(구글 시트 &lsquo;회귀분석_예측&rsquo;·&lsquo;range_log&rsquo; 탭).
        VIX와 신용 스프레드는 범위 계산이 맞지 않아 뺐습니다.
      </p>
    </section>
  );
}
