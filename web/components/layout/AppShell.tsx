import type { ReactNode } from "react";
import { Masthead } from "./Masthead";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="nt-skip" href="#verdict">
        본문으로 건너뛰기
      </a>
      <Masthead />
      <main className="nt-page">{children}</main>
      <footer className="nt-foot">
        <p>
          시장 지표는 매일 07:30과 23:30(한국시간)에 GitHub Actions가 FRED 등에서 받아 옵니다. 내러티브 목록은 Gemini가 매일 아침 기사를 근거로 갱신하고, 바뀐
          내용은 갱신 기록에 남습니다. <code>docs/data/events.json</code>에서 직접 고칠 수도 있고, <code>&quot;auto_lock&quot;: true</code>로 두면 자동 갱신에서 빠집니다.
        </p>
      </footer>
    </>
  );
}
