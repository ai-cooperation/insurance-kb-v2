"""Native Google Cloud Gemini adapter for the existing translation cascade.

2026-11-27: reuse the proven meeting-capture-studio 3c9f3a4 endpoint,
but keep project/identity independent. Developer API keys do not select this
route. GitHub WIF credentials refresh during long reclassification jobs.
"""
import os
import re
from types import SimpleNamespace


class VertexTranslationClient:
    def __init__(self, *, project, location="global", model="gemini-3.5-flash-lite", session=None):
        if not re.fullmatch(r"[a-z][a-z0-9-]{4,61}[a-z0-9]", project):
            raise ValueError("Invalid VERTEX_PROJECT_ID")
        if not re.fullmatch(r"global|[a-z]+-[a-z]+[0-9]+", location):
            raise ValueError("Invalid VERTEX_LOCATION")
        if not re.fullmatch(r"gemini-[a-z0-9.-]+", model):
            raise ValueError("Invalid VERTEX_MODEL")
        self.project, self.location, self.model = project, location, model
        self._session = session
        self.chat = SimpleNamespace(completions=self)

    def session(self):
        if self._session is None:
            import google.auth
            from google.auth.transport.requests import AuthorizedSession
            from google.oauth2.credentials import Credentials

            token = os.environ.get("VERTEX_ACCESS_TOKEN")
            if token:
                credentials = Credentials(token=token)
            elif os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
                credentials, _ = google.auth.default(
                    scopes=["https://www.googleapis.com/auth/cloud-platform"],
                    quota_project_id=self.project)
            else:
                # Never silently read a developer's personal ADC credentials.
                raise ValueError("Cloud credentials are not configured")
            self._session = AuthorizedSession(credentials, max_refresh_attempts=1)
        return self._session

    def create(self, *, model, messages, temperature=0.3, max_tokens=1500, extra_body=None):
        if model != self.model or type(max_tokens) is not int or not 1 <= max_tokens <= 65536:
            raise ValueError("Invalid model or output budget")
        if not isinstance(messages, list) or not messages:
            raise ValueError("Nonempty messages required")
        if any(not isinstance(m, dict) or m.get("role") not in {"system", "user"}
               or not isinstance(m.get("content"), str) or not m["content"].strip() for m in messages):
            raise ValueError("Only nonempty system/user text is supported")
        system = "\n".join(m["content"] for m in messages if m["role"] == "system")
        contents = [{"role": "user", "parts": [{"text": m["content"]}]}
                    for m in messages if m["role"] == "user"]
        if not contents:
            raise ValueError("User text required")
        host = "aiplatform.googleapis.com" if self.location == "global" else f"{self.location}-aiplatform.googleapis.com"
        url = (f"https://{host}/v1/projects/{self.project}/locations/{self.location}"
               f"/publishers/google/models/{model}:generateContent")
        response = self.session().post(url, json={
            "systemInstruction": {"parts": [{"text": system}]}, "contents": contents,
            "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens,
                "responseMimeType": "application/json",
                "thinkingConfig": {"thinkingLevel": "MINIMAL" if model == "gemini-3.5-flash-lite" else "LOW"}},
        }, timeout=90)
        response.raise_for_status()
        data = response.json()
        try:
            usage = data.get("usageMetadata", {})
            if not isinstance(usage, dict):
                raise ValueError("Malformed Cloud usage")
            counts = [usage.get(k) for k in ("promptTokenCount", "candidatesTokenCount", "totalTokenCount")]
            if any(v is not None and (type(v) is not int or v < 0) for v in counts):
                raise ValueError("Malformed Cloud token counts")
            result = SimpleNamespace(model=data.get("modelVersion") or model,
                usage=SimpleNamespace(prompt_tokens=counts[0], completion_tokens=counts[1], total_tokens=counts[2]))
            candidate = data["candidates"][0]
            text = "".join(p.get("text", "") for p in candidate["content"]["parts"] if not p.get("thought"))
            if candidate.get("finishReason") != "STOP" or not text.strip():
                from src.translation_usage import log_usage
                log_usage(f"vertex/{model}", model, result, None)
                raise ValueError("Cloud response blocked, truncated or empty")
            result.choices = [SimpleNamespace(message=SimpleNamespace(content=text))]
            return result
        except (KeyError, IndexError, TypeError, AttributeError) as exc:
            raise ValueError("Malformed Cloud response") from exc
