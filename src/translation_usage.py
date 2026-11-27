"""Structured provider usage in retained workflow logs, never billing estimates."""
import json
import logging


def log_usage(label, requested_model, response, article_count):
    """Log returned counts before parsing output; bad JSON can still cost tokens.

    Missing usage stays unknown. Failed HTTP calls have no response usage;
    Google Cloud Billing remains authoritative for actual charges and credits.
    Do not log API keys, prompts or article contents here.
    """
    usage = getattr(response, "usage", None)
    event = {
        "provider": label.split("/", 1)[0],
        "model": getattr(response, "model", None) or requested_model,
        "article_count": article_count,
        **{field: getattr(usage, field, None)
           for field in ("prompt_tokens", "completion_tokens", "total_tokens")},
    }
    logging.getLogger(__name__).info("translation_usage %s", json.dumps(event, sort_keys=True))
