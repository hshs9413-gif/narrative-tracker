"""Gemini API 점검 — 저장소 Secret GEMINI_API_KEY 인식, 쓸 수 있는 무료 모델, 검색 그라운딩 동작을 확인한다.

GitHub Actions 실행 요약에 ::notice/::warning 주석으로 남긴다. 키 값은 출력하지 않는다.
모델마다 검색 없이·검색 포함 각 1번씩만 불러(재시도 없음) 무료 등급 쿼터를 아낀다.
실행: GEMINI_API_KEY=... python scripts/gemini_check.py
"""

import json
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(__file__))

import gemini_api  # noqa: E402

PROBE_MODELS = 6


def _detail(resp):
    try:
        err = resp.json().get("error", {})
    except ValueError:
        return resp.text[:80]
    bits = []
    for d in err.get("details", []) or []:
        for v in d.get("violations", []) or []:
            bits.append(f"{v.get('quotaId') or v.get('quotaMetric', '')}".split("/")[-1][:60])
        if d.get("retryDelay"):
            bits.append(f"retry {d['retryDelay']}")
    msg = (err.get("message") or "")[:70]
    return (" · ".join(dict.fromkeys(bits)) or msg)[:160]


def main():
    status = gemini_api.key_status()
    print(f"::notice title=Gemini 키 모양::{status} · {gemini_api.key_shape()}")
    if status != "ok":
        print("::warning title=Gemini 키::GEMINI_API_KEY 없음 — 저장소 Settings → Secrets and variables → Actions에 등록 필요")
        return
    try:
        models = gemini_api.list_flash_models()
    except gemini_api.GeminiError as e:
        print(f"::warning title=Gemini 모델 목록 실패::{e}")
        return
    print("::notice title=Gemini 모델::" + ", ".join(models))
    stable = [m for m in models if "preview" not in m and "latest" not in m and "omni" not in m][:PROBE_MODELS]
    lines = []
    for model in stable:
        for search in (False, True):
            body = gemini_api._body("Reply with the single word OK.", search, 64, True)
            try:
                r = requests.post(f"{gemini_api.BASE}/models/{model}:generateContent", headers=gemini_api._headers(),
                                  json=body, timeout=90)
            except requests.RequestException as e:
                lines.append(f"{model} {'검색' if search else '기본'}: {type(e).__name__}")
                continue
            if r.status_code == 400 and "thinking" in r.text.lower():
                body = gemini_api._body("Reply with the single word OK.", search, 64, False)
                r = requests.post(f"{gemini_api.BASE}/models/{model}:generateContent", headers=gemini_api._headers(),
                                  json=body, timeout=90)
            if r.status_code == 200:
                p = gemini_api._parse(model, r.json())
                lines.append(f"{model} {'검색' if search else '기본'}: OK (출처 {len(p['sources'])})")
            else:
                lines.append(f"{model} {'검색' if search else '기본'}: HTTP {r.status_code} {gemini_api._scrub(_detail(r))}")
    print("::notice title=Gemini 모델별 호출::" + "%0A".join(lines))


if __name__ == "__main__":
    main()
