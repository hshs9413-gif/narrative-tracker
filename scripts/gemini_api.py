"""Gemini API(무료 등급) 최소 클라이언트 — 모델 자동 선택, 검색 그라운딩, 429·5xx 재시도.

키는 GEMINI_API_KEY 환경변수(저장소 Secret)에서 읽고 오류 메시지에 남기지 않는다.
모델은 GEMINI_MODEL(선택) → API가 알려 주는 flash 계열 중 최신 순으로 시도한다.
무료 등급은 분당·일일 호출 수 제한이 있어 한 번 실행에 몇 번만 부르도록 설계한다.
"""

import json
import os
import re
import time

import requests

BASE = "https://generativelanguage.googleapis.com/v1beta"
TIMEOUT = 180
# API 목록을 못 받을 때 쓰는 기본 후보 (2026-08 실제 응답 기준: 2.5 계열은 신규 계정에 막힘)
FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"]


class GeminiError(Exception):
    pass


def _raw_key():
    return (os.environ.get("GEMINI_API_KEY") or "").strip().strip('"').strip("'")


def key_status():
    k = _raw_key()
    if not k:
        return "missing"
    if not re.fullmatch(r"[A-Za-z0-9_\-]{20,}", k):
        return "malformed"
    return "ok"


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


def candidates(session=None):
    preferred = [os.environ.get("GEMINI_MODEL", "").strip()]
    try:
        listed = [m for m in list_flash_models(session) if "preview" not in m and "exp" not in m] or list_flash_models(session)
    except (GeminiError, requests.RequestException):
        listed = []
    return list(dict.fromkeys(m for m in preferred + listed + FALLBACK_MODELS if m))


def _body(prompt, search, max_tokens, thinking_off):
    gen = {"temperature": 0.2, "maxOutputTokens": max_tokens}
    if thinking_off:
        gen["thinkingConfig"] = {"thinkingBudget": 0}
    body = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": gen}
    if search:
        body["tools"] = [{"google_search": {}}]  # 검색 도구는 다른 도구와 같이 못 씀
    return body


def generate(prompt, search=True, max_tokens=8192, session=None, models=None, retries=2):
    """첫 번째로 성공한 모델의 결과를 돌려준다: {model, text, sources[{title, uri}], queries[]}"""
    s = session or requests
    errors = []
    for model in models or candidates(session):
        for thinking_off in (True, False):  # thinkingConfig를 거부하는 모델 대비
            for attempt in range(retries + 1):
                try:
                    resp = s.post(f"{BASE}/models/{model}:generateContent", headers=_headers(),
                                  json=_body(prompt, search, max_tokens, thinking_off), timeout=TIMEOUT)
                except requests.RequestException as e:
                    errors.append(f"{model}: {type(e).__name__}")
                    break
                if resp.status_code == 200:
                    return _parse(model, resp.json())
                if resp.status_code in (429, 500, 503) and attempt < retries:
                    time.sleep(20 * (attempt + 1))
                    continue
                errors.append(f"{model}{'' if thinking_off else '(thinking 기본)'}: HTTP {resp.status_code} {_scrub(_err_msg(resp))[:140]}")
                break
            else:
                continue
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
    return {"model": model, "text": text, "sources": sources, "queries": meta.get("webSearchQueries") or [],
            "finish": cand.get("finishReason")}


def extract_json(text):
    """코드펜스·앞뒤 설명이 섞여 있어도 JSON 객체를 뽑는다."""
    cleaned = text.replace("```json", "").replace("```", "").strip()
    for candidate in (cleaned, cleaned[cleaned.find("{"):cleaned.rfind("}") + 1] if "{" in cleaned else ""):
        try:
            return json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
    return None
