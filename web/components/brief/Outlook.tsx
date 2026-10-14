"use client";

import { useForecast, useRanges } from "@/lib/hooks/use-dashboard-data";
import { BOARD_ROWS } from "@/lib/board";
import { monthDay } from "@/lib/brief";
import type { NextSessionForecast, RangeItem } from "@/types/dashboard";

// 다음 움직임 예상 — 차트 없이 글로: '상승/하락 예상 얼마, 오차범위 ±얼마'.
//  · 다음 한국 장: 어젯밤 미국 장으로 낸 회귀 예측(scripts/compute_forecast.py) — 한국 장이 미국 장보다 먼저 닫혀서 앞을 보는 예측이 된다
//  · 한 달 뒤: 변동 폭으로 낸 90% 범위(scripts/compute_ranges.py) — 방향은 맞힐 근거가 없어 범위만
// 오차범위는 둘 다 '열 번 중 아홉 번 실제 값이 들어오는 폭'(90%).

const Z90 = 1.645;

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
    </li>
  );
}

function RangeRow({ it }: { it: RangeItem }) {
  const fmt = BOARD_ROWS.find((r) => r.id === it.id)?.format ?? ((v: number) => v.toFixed(2));
  const bt = it.backtest;
  const rate = bt.rate === null ? null : Math.round(bt.rate * 100);
  const years = bt.from && bt.to ? (Date.parse(bt.to) - Date.parse(bt.from)) / (365.25 * 86_400_000) : 0;
  const missed = bt.above + bt.below;
  const lopsided = missed >= 10 && Math.max(bt.above, bt.below) / missed >= 0.75;
  const low = rate !== null && rate < 85;
  const width =
    it.kind === "bp"
      ? `±${Math.round((it.hi - it.base) * 100)}bp`
      : `${signed((it.lo / it.base - 1) * 100, "%", 1)} ~ ${signed((it.hi / it.base - 1) * 100, "%", 1)}`;
  return (
    <li>
      <p className="nt-outlook-line">
        <b>{it.label}</b> <span className="tnum">{fmt(it.lo)} ~ {fmt(it.hi)}</span>
        <span className="nt-outlook-when"> · {monthDay(it.due)} 무렵</span>
      </p>
      <p className="nt-outlook-why">
        지금 {fmt(it.base)}({monthDay(it.base_date)})에서 {width}
        {rate !== null && ` · 지난 ${years.toFixed(1)}년 되짚어 보면 ${rate}%가 이 범위 안`}
        {low && " — 90%에 못 미쳐 범위를 좁게 잡는 편"}
        {lopsided && ` (빗나간 날은 대부분 범위 ${bt.above > bt.below ? "위" : "아래"})`}
        {it.live.n > 0 && ` · 실제로 미리 낸 범위 ${it.live.n}번 중 ${it.live.inside}번 적중`}
      </p>
    </li>
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
            한 달 뒤 범위 <small>방향은 맞힐 근거가 없어 범위만 — 최근 석 달 하루 변동 폭이 이어진다고 볼 때</small>
          </h3>
          <ul className="nt-outlook">
            {items.map((it) => (
              <RangeRow key={it.id} it={it} />
            ))}
          </ul>
        </>
      )}
      <p className="nt-note">
        예측과 범위는 매일 아침 기록하고 실제 값이 나오면 채점합니다(구글 시트 &lsquo;회귀분석_예측&rsquo;·&lsquo;range_log&rsquo; 탭).
        VIX와 신용 스프레드는 범위 계산이 맞지 않아 뺐습니다.
      </p>
    </section>
  );
}
