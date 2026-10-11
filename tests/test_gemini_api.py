"""Gemini 클라이언트의 재시도·모델 건너뛰기 테스트 — 네트워크 없음 (가짜 세션).

실행: python -m unittest discover -s tests -v
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import gemini_api  # noqa: E402

DAILY = {"error": {"code": 429, "message": "You exceeded your current quota",
                   "details": [{"@type": "type.googleapis.com/google.rpc.QuotaFailure",
                                "violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}
MINUTE = {"error": {"code": 429, "message": "Resource exhausted",
                    "details": [{"@type": "type.googleapis.com/google.rpc.QuotaFailure",
                                 "violations": [{"quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}
OK = {"candidates": [{"content": {"parts": [{"text": "{\"ok\": true}"}]}, "finishReason": "STOP"}], "usageMetadata": {}}


class Resp:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, str(body)

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, plan):
        self.plan, self.calls = plan, []

    def post(self, url, **_):
        model = url.split("/models/")[1].split(":")[0]
        self.calls.append(model)
        return self.plan[model].pop(0) if isinstance(self.plan[model], list) else self.plan[model]


class RetryTest(unittest.TestCase):
    def setUp(self):
        gemini_api.EXHAUSTED.clear()
        os.environ["GEMINI_API_KEY"] = "x" * 39

    def test_daily_quota_is_not_retried_and_is_remembered(self):
        s = FakeSession({"a": Resp(429, DAILY), "b": Resp(200, OK)})
        with mock.patch.object(gemini_api.time, "sleep") as slept:
            out = gemini_api.generate("p", session=s, models=["a", "b"])
            self.assertEqual((out["model"], s.calls), ("b", ["a", "b"]))
            slept.assert_not_called()
            gemini_api.generate("p", session=s, models=["a", "b"])  # 같은 실행의 두 번째 호출은 a를 건너뜀
        self.assertEqual(s.calls, ["a", "b", "b"])

    def test_per_minute_limit_is_retried_once(self):
        s = FakeSession({"a": [Resp(429, MINUTE), Resp(200, OK)]})
        with mock.patch.object(gemini_api.time, "sleep"):
            out = gemini_api.generate("p", session=s, models=["a"])
        self.assertEqual((out["model"], s.calls), ("a", ["a", "a"]))

    def test_models_env_limits_candidates(self):
        with mock.patch.dict(os.environ, {"GEMINI_MODELS": "gemini-3.1-flash-lite"}):
            self.assertEqual(gemini_api.candidates(), ["gemini-3.1-flash-lite"])


if __name__ == "__main__":
    unittest.main()
