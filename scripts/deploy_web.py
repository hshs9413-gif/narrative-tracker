"""
web/ 빌드 결과(web/out/)를 docs/에 병합 (GitHub Pages 배포용)

docs/data/ (파이썬 수집 스크립트가 매일 쓰는 실데이터)는 절대 건드리지 않는다.
그 외 docs/ 안의 모든 파일·폴더는 지우고 web/out/ 내용으로 교체한다 — Next
빌드마다 해시가 바뀌는 _next/static/chunks/*.js 같은 파일이 쌓이지 않게.

사용법:
    cd web && npm run build   # web/out/ 생성
    python scripts/deploy_web.py

의존성: 표준 라이브러리만 사용
"""

import os
import shutil
import sys

BASE = os.path.dirname(__file__)
OUT_DIR = os.path.join(BASE, "..", "web", "out")
DOCS_DIR = os.path.join(BASE, "..", "docs")
PRESERVE = {"data"}  # docs/ 바로 아래에서 보존할 이름


def main() -> None:
    if not os.path.isdir(OUT_DIR):
        sys.exit(f"[ERROR] {OUT_DIR} 없음 — 먼저 `cd web && npm run build` 실행할 것")

    # 1) docs/ 안에서 PRESERVE 제외하고 전부 삭제
    for name in os.listdir(DOCS_DIR):
        if name in PRESERVE:
            continue
        path = os.path.join(DOCS_DIR, name)
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        print(f"[INFO] 삭제: docs/{name}")

    # 2) web/out/ 안의 모든 항목을 docs/로 복사 — 단 'data'라는 이름은 건너뛴다
    #    (로컬 빌드 시 web/public/data에 실데이터를 복사해 뒀다면 out/data에도
    #    같이 나오는데, 그건 build 시점 스냅샷일 뿐이라 절대 덮어쓰면 안 됨)
    copied = []
    for name in os.listdir(OUT_DIR):
        if name in PRESERVE:
            print(f"[INFO] 건너뜀: out/{name} (docs/{name}는 실데이터, 안 덮어씀)")
            continue
        src = os.path.join(OUT_DIR, name)
        dst = os.path.join(DOCS_DIR, name)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
        copied.append(name)

    print(f"[INFO] 복사 완료: {len(copied)}개 항목 → docs/ ({', '.join(sorted(copied))})")

    nojekyll = os.path.join(DOCS_DIR, ".nojekyll")
    if not os.path.exists(nojekyll):
        print("[WARN] docs/.nojekyll 없음 — GitHub Pages의 Jekyll이 _next/를 지울 수 있음"
              " (web/public/.nojekyll이 빌드에 포함됐는지 확인)")


if __name__ == "__main__":
    main()
