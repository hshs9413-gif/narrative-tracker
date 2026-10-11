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
          시장 지표는 GitHub Actions가 매일 아침(예약은 07:30이지만 GitHub 사정으로 보통 10~11시)과 밤 23:30(한국시간)에 FRED 등에서
          받아 옵니다. 내러티브 목록은 Gemini가 매일 아침 기사를 근거로 정리하고 코드가 근거를 확인해 반영합니다.{" "}
          <code>docs/data/events.json</code>에서 직접 고칠 수도 있고, <code>&quot;auto_lock&quot;: true</code>로 두면 자동 갱신에서 빠집니다.
        </p>
      </footer>
    </>
  );
}
