"""Gemini API 점검 — 저장소 Secret GEMINI_API_KEY 인식과 무료 모델 응답을 확인한다 (PR·수동 실행 때).

GitHub Actions 실행 요약에 ::notice/::warning 주석으로 남긴다. 키 값은 출력하지 않는다.
쿼터를 아끼려고 모델 목록 1번 + 실제 호출 1번(성공할 때까지 후보 순서대로)만 한다.
2026-10-11 확인: 무료 등급은 3.6-flash·3.5-flash·3.1-flash-lite가 응답, Google 검색 그라운딩은 모든 모델 429.
실행: GEMINI_API_KEY=... python scripts/gemini_check.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import gemini_api  # noqa: E402


def main():
    status = gemini_api.key_status()
    if status != "ok":
        print(f"::warning title=Gemini 키::GEMINI_API_KEY {status} — 저장소 Settings → Secrets and variables → Actions에 등록 필요")
        return
    try:
        cands = gemini_api.candidates()
        r = gemini_api.generate('JSON으로만 답하세요: {"ok": true}', max_tokens=32, models=cands, json_mode=True)
        print(f"::notice title=Gemini 점검::키 정상 · 응답 모델 {r['model']} · 후보 {', '.join(cands)} · 응답 {r['text'][:40]!r}")
    except gemini_api.GeminiError as e:
        print(f"::warning title=Gemini 점검 실패::{e}")


if __name__ == "__main__":
    main()
