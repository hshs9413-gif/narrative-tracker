import type { Metadata } from "next";
import "@coreui/coreui/dist/css/coreui.min.css";
import "@coreui/chartjs/dist/css/coreui-chartjs.min.css"; // Chart.js 툴팁 스타일 (CoreUI 방식)
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// 기존 사이트와 동일한 CDN으로 Pretendard 로드 (한글 가독성 — CoreUI 기본 폰트 스택 앞에 둔다).
const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css";

export const metadata: Metadata = {
  title: "내러티브 레짐 트래커",
  description: "Macro Narrative / Regime Tracker",
};

// 첫 페인트 전에 저장된 테마(없으면 OS 설정)를 <html>에 적용해 깜빡임을 막는다.
// Next 문서의 'Preventing flash before hydration' 방식 — 값은 CoreUI의 data-coreui-theme.
const THEME_INIT = `(function(){var t="auto";try{t=localStorage.getItem("${THEME_STORAGE_KEY}")||"auto"}catch(e){}
var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.setAttribute("data-coreui-theme",d?"dark":"light")})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-coreui-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="stylesheet" href={PRETENDARD_CSS} crossOrigin="anonymous" />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
