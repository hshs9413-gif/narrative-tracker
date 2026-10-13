import type { ReactNode } from "react";
import { Masthead } from "./Masthead";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="nt-skip" href="#today">
        본문으로 건너뛰기
      </a>
      <Masthead />
      <main className="nt-page">{children}</main>
      <footer className="nt-foot">
        <p>
          시장 지표는 GitHub Actions가 매일 아침(06:47, 예비 08:17)과 밤(23:47, 예비 02:17, 한국시간)에 FRED 등에서 받아 옵니다.
          GitHub 예약 실행은 몇 시간씩 늦게 시작되기도 해서, 실제로 돈 시각은 내러티브 섹션의 &apos;마지막 Gemini 점검&apos; 줄에 나옵니다. 내러티브 목록은 Gemini가 매일 아침 기사를 근거로 정리하고 코드가 근거를 확인해 반영합니다.{" "}
          <code>docs/data/events.json</code>에서 직접 고칠 수도 있고, <code>&quot;auto_lock&quot;: true</code>로 두면 자동 갱신에서 빠집니다.
        </p>
      </footer>
    </>
  );
}
