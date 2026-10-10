// 서버 컴포넌트(layout.tsx)도 읽는 값이라 "use client" 파일이 아닌 곳에 둔다 — 클라이언트 모듈의 export는 서버에서 값이 아니라 참조가 된다.
export const THEME_STORAGE_KEY = "narrative-tracker-theme";
