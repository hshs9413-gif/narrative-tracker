import type { Metadata } from "next";
import "./globals.css";

// 기존 사이트와 동일한 CDN으로 Pretendard 로드 (브랜드 연속성 유지).
// next/font/google에는 Pretendard가 없어 next/font/local 대신 이 방식을 그대로 이식했다.
const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css";

export const metadata: Metadata = {
  title: "내러티브 레짐 트래커",
  description: "Macro Narrative / Regime Tracker",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="stylesheet" href={PRETENDARD_CSS} crossOrigin="anonymous" />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-text-primary">{children}</body>
    </html>
  );
}
