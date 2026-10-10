"use client";

import { useState, type ReactNode } from "react";
import { CContainer, CFooter } from "@coreui/react";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarShow, setSidebarShow] = useState(true);
  const [unfoldable, setUnfoldable] = useState(false);

  return (
    <>
      <AppSidebar show={sidebarShow} onShowChange={setSidebarShow} unfoldable={unfoldable} onUnfoldableChange={setUnfoldable} />
      <div className="nt-wrapper d-flex flex-column min-vh-100">
        <AppHeader onToggleSidebar={() => setSidebarShow(!sidebarShow)} />
        <main className="flex-grow-1">
          <CContainer lg className="px-4 pb-5">
            {children}
          </CContainer>
        </main>
        <CFooter className="px-4">
          <span className="text-body-secondary">정량 지표는 GitHub Actions가 매일 자동 수집합니다. 이벤트 기록(events.json)은 직접 갱신합니다.</span>
        </CFooter>
      </div>
    </>
  );
}
