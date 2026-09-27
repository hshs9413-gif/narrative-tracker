import type { NextConfig } from "next";

// 정적 export로 빌드해 기존 GitHub Pages(브랜치 main, /docs 폴더) 파이프라인에 그대로 올린다.
// basePath는 필수 — 이 레포는 유저 루트 페이지(username.github.io)가 아니라
// 프로젝트 서브패스(username.github.io/narrative-tracker/)로 서빙되기 때문에,
// 없으면 정적 자산 경로가 전부 깨진다. (Context7로 Next.js 최신 문서 확인함)
const REPO_NAME = "narrative-tracker";

const nextConfig: NextConfig = {
  output: "export",
  basePath: `/${REPO_NAME}`,
  images: { unoptimized: true }, // next/image 최적화는 서버가 필요해 정적 export에서 못 씀
  // 페이지를 page/index.html로 내보내고 항상 trailing slash로 접근하게 강제 —
  // 없으면 클라이언트 fetch("data/xxx.json") 같은 상대경로가 basePath 밖으로 풀림
  // (dev 서버에서 직접 재현됨: /narrative-tracker(슬래시 없음)에서 상대 fetch가
  // /data/... 로 풀려 404. GitHub Pages 프로덕션에선 디렉토리 인덱스 리다이렉트로
  // 우연히 가려질 수 있는 문제라 dev에서도 반드시 잡아야 함).
  trailingSlash: true,
};

export default nextConfig;
