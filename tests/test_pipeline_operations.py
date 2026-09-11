import inspect
from pathlib import Path

import yaml

from src.classifier import TRANSLATE_PROVIDERS, classify_llm_batch, completion_budget


ROOT = Path(__file__).resolve().parents[1]


def test_translation_cascade_contains_only_live_provider_families():
    names = [provider[0] for provider in TRANSLATE_PROVIDERS]
    assert names == ["groq", "gemini"]
    assert all("github" not in name for name in names)


def test_translation_batches_fit_free_tier_request_budget():
    default = inspect.signature(classify_llm_batch).parameters["batch_size"].default
    assert default == 5
    assert completion_budget("qwen/qwen3.6-27b", 5) == 1500
    assert completion_budget("openai/gpt-oss-120b", 5) == 4000


def test_crawl_has_one_scheduler_and_no_retired_provider_secret():
    flow = yaml.load(
        (ROOT / ".github/workflows/crawl.yml").read_text(),
        Loader=yaml.BaseLoader,
    )
    assert set(flow["on"]) == {"workflow_dispatch"}
    crawl_step = next(
        step
        for step in flow["jobs"]["crawl"]["steps"]
        if step.get("name") == "Run crawl pipeline"
    )
    assert "MODELS_PAT" not in crawl_step["env"]
    assert "GROQ_API_KEY" in crawl_step["env"]
    assert "GEMINI_API_KEY" in crawl_step["env"]
