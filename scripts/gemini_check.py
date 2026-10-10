"""Gemini API 점검 — 저장소 Secret GEMINI_API_KEY 인식, 쓸 수 있는 무료 모델, 검색 그라운딩 동작을 확인한다.

GitHub Actions 실행 요약에 ::notice/::warning 주석으로 남긴다. 키 값은 출력하지 않는다.
실행: GEMINI_API_KEY=... python scripts/gemini_check.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import gemini_api  # noqa: E402


def main():
    status = gemini_api.key_status()
    print(f"::notice title=Gemini 키 모양::{status} · {gemini_api.key_shape()}")
    if status != "ok":
        print(f"::warning title=Gemini 키::GEMINI_API_KEY {status} — 저장소 Settings → Secrets and variables → Actions에 GEMINI_API_KEY로 등록 필요")
        return
    try:
        models = gemini_api.list_flash_models()
    except gemini_api.GeminiError as e:
        print(f"::warning title=Gemini 모델 목록 실패::{e}")
        return
    print("::notice title=Gemini 모델::" + ", ".join(models[:12]) + (f" 외 {len(models) - 12}개" if len(models) > 12 else ""))
    try:
        r = gemini_api.generate(
            "미국 ISM 제조업 PMI 가장 최근 발표치(몇 월 지표, 수치, 발표일)를 한 문장으로 답하세요.",
            search=True, max_tokens=256)
    except gemini_api.GeminiError as e:
        print(f"::warning title=Gemini 호출 실패::{e}")
        return
    print(f"::notice title=Gemini 검색 그라운딩::모델 {r['model']} · 출처 {len(r['sources'])}개 "
          f"({', '.join(s['title'] for s in r['sources'][:4])}) · 응답: {r['text'][:160]!r}")


if __name__ == "__main__":
    main()
