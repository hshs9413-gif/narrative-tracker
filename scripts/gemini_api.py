"""Gemini API(무료 등급) 최소 클라이언트 — 모델 자동 선택, 429·5xx 재시도.

키는 GEMINI_API_KEY 환경변수(저장소 Secret)에서 읽고 오류 메시지에 남기지 않는다.
모델은 GEMINI_MODEL(선택) → 무료 등급에서 동작을 확인한 모델 → API가 알려 주는 나머지 flash 계열 순으로 시도한다.
무료 등급은 분당·일일 호출 수 제한이 있어 한 번 실행에 몇 번만 부르도록 설계한다.

2026-10-11 확인(gemini_check.py): 3.6-flash·3.5-flash·3.1-flash-lite는 무료로 응답, 3.8/3.7-flash는 혼잡(503)·시간 초과,
Google 검색 그라운딩은 모든 모델에서 429(무료 쿼터 없음) — 그래서 기사는 news_feed.py로 직접 받아 넘긴다.
"""

import json
import os
import re
import time

import requests

BASE = "https://generativelanguage.googleapis.com/v1beta"
TIMEOUT = 180
# 무료 등급에서 응답을 확인한 모델 — 이 순서로 먼저 시도 (2.5 계열은 신규 계정에 막힘)
PREFERRED_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"]


class GeminiError(Exception):
    pass


def _raw_key():
    return (os.environ.get("GEMINI_API_KEY") or "").strip().strip('"').strip("'")


def key_status():
    k = _raw_key()
    if not k:
        return "missing"
    if len(k) < 20 or any(c.isspace() for c in k):
        return "malformed"
    return "ok"


def key_shape():
    """키 값은 숨기고 모양만 — 진단용"""
    k = _raw_key()
    return (f"len {len(k)}, AIza로 시작 {k.startswith('AIza')}, "
            f"영숫자·-·_ 외 문자 {sorted(set(c for c in k if not (c.isalnum() or c in '-_')))!r}")


def _headers():
    return {"x-goog-api-key": _raw_key(), "Content-Type": "application/json"}


def _scrub(text):
    k = _raw_key()
    return text.replace(k, "***") if k else text


def _version_key(name):
    """'gemini-3.6-flash' → (3, 6) — 최신 순 정렬용. lite는 뒤로."""
    m = re.search(r"gemini-(\d+)(?:\.(\d+))?", name)
    major, minor = (int(m.group(1)), int(m.group(2) or 0)) if m else (0, 0)
    return (-major, -minor, "lite" in name, "preview" in name or "exp" in name, name)


def list_flash_models(session=None):
    s = session or requests
    resp = s.get(f"{BASE}/models", headers=_headers(), params={"pageSize": 200}, timeout=60)
    if resp.status_code != 200:
        raise GeminiError(f"모델 목록 HTTP {resp.status_code}: {_scrub(resp.text[:200])}")
    names = []
    for m in resp.json().get("models", []):
        name = m.get("name", "").split("/", 1)[-1]
        if "flash" in name and "generateContent" in (m.get("supportedGenerationMethods") or []) \
                and not any(x in name for x in ("image", "tts", "audio", "live", "embedding", "thinking")):
            names.append(name)
    return sorted(set(names), key=_version_key)


def candidates(session=None, extra=2):
    """GEMINI_MODEL → 검증된 무료 모델 → 목록의 다른 안정판 flash 몇 개 (쿼터를 아끼려고 최대 5개)."""
    first = [os.environ.get("GEMINI_MODEL", "").strip()]
    try:
        listed = [m for m in list_flash_models(session)
                  if not any(x in m for x in ("preview", "exp", "latest", "omni")) and m not in PREFERRED_MODELS]
    except (GeminiError, requests.RequestException):
        listed = []
    return list(dict.fromkeys(m for m in first + PREFERRED_MODELS + listed[:extra] if m))[:5]


def _body(prompt, search, max_tokens, thinking):
    """thinking = 생각(추론) 토큰 예산. None이면 설정을 넣지 않아 모델 기본값을 쓴다.
    생각 토큰은 maxOutputTokens 안에서 쓰이므로, 예산을 주면 출력 상한도 그만큼 키워야 본문이 잘리지 않는다."""
    gen = {"temperature": 0.2, "maxOutputTokens": max_tokens}
    if thinking is not None:
        gen["thinkingConfig"] = {"thinkingBudget": thinking}
    body = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": gen}
    if search:
        body["tools"] = [{"google_search": {}}]  # 검색 도구는 다른 도구와 같이 못 씀
    return body


def generate(prompt, search=False, max_tokens=8192, session=None, models=None, retries=1, json_mode=False,
             thinking_budget=0):
    """첫 번째로 성공한 모델의 결과를 돌려준다: {model, text, sources, queries, finish, usage}

    thinking_budget: 0 = 생각 끔(빠르고 싸다), 양수 = 그만큼 추론 후 답, None = 모델 기본값.
    모델이 thinkingConfig를 거부(400)하면 설정 없이 한 번 더 시도한다."""
    s = session or requests
    errors = []
    for model in models or candidates(session):
        for thinking in dict.fromkeys((thinking_budget, None)):  # thinkingConfig를 거부하는 모델 대비
            resp = None
            for attempt in range(retries + 1):
                try:
                    body = _body(prompt, search, max_tokens + (thinking or 0), thinking)
                    if json_mode and not search:  # 검색 도구와는 같이 못 씀
                        body["generationConfig"]["responseMimeType"] = "application/json"
                    resp = s.post(f"{BASE}/models/{model}:generateContent", headers=_headers(),
                                  json=body, timeout=TIMEOUT)
                except requests.RequestException as e:
                    errors.append(f"{model}: {type(e).__name__}")
                    resp = None
                    break
                if resp.status_code == 200:
                    return _parse(model, resp.json())
                if resp.status_code in (429, 500, 503) and attempt < retries:
                    time.sleep(15 * (attempt + 1))
                    continue
                errors.append(f"{model}(thinking {thinking}): HTTP {resp.status_code} {_scrub(_err_msg(resp))[:140]}")
                break
            if resp is not None and resp.status_code in (401, 403):
                raise GeminiError("키가 거부됨 (HTTP %d) — GEMINI_API_KEY 확인" % resp.status_code)
            if resp is None or resp.status_code != 400:
                break  # thinking 설정만 바꾼 재시도는 400에만 의미 있음
    raise GeminiError("모든 모델 실패 — " + " | ".join(errors[-4:]))


def _err_msg(resp):
    try:
        return json.dumps(resp.json().get("error", {}).get("message", ""), ensure_ascii=False)
    except ValueError:
        return resp.text[:200]


def _parse(model, data):
    cand = (data.get("candidates") or [{}])[0]
    text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []) or [])
    meta = cand.get("groundingMetadata") or {}
    sources = []
    for ch in meta.get("groundingChunks") or []:
        web = ch.get("web") or {}
        if web.get("uri"):
            sources.append({"title": web.get("title") or "", "uri": web["uri"]})
    u = data.get("usageMetadata") or {}
    usage = {"prompt": u.get("promptTokenCount"), "output": u.get("candidatesTokenCount"),
             "thoughts": u.get("thoughtsTokenCount") or 0, "total": u.get("totalTokenCount")}
    return {"model": model, "text": text, "sources": sources, "queries": meta.get("webSearchQueries") or [],
            "finish": cand.get("finishReason"), "usage": usage}


def usage_line(r):
    """'입력 9,812 · 생각 3,104 · 출력 1,206 토큰 (STOP)' — 실행 요약에 남기는 한 줄"""
    u = r.get("usage") or {}
    f = lambda v: f"{v:,}" if isinstance(v, int) else "?"
    return f"입력 {f(u.get('prompt'))} · 생각 {f(u.get('thoughts'))} · 출력 {f(u.get('output'))} 토큰 ({r.get('finish')})"


def extract_json(text):
    """코드펜스·앞뒤 설명이 섞여 있어도 JSON 객체를 뽑는다."""
    cleaned = text.replace("```json", "").replace("```", "").strip()
    for candidate in (cleaned, cleaned[cleaned.find("{"):cleaned.rfind("}") + 1] if "{" in cleaned else ""):
        try:
            return json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
    return None
