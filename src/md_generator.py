"""Generate Markdown files with YAML frontmatter from classified articles."""

import logging
import re
import unicodedata
from datetime import datetime
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

NOTES_DIR = Path(__file__).resolve().parent.parent / "notes"


def _slugify(text: str, max_len: int = 60) -> str:
    """Convert text to a filesystem-safe slug."""
    text = unicodedata.normalize("NFKD", text)
    text = re.sub(r"[^\w\s-]", "", text.lower())
    text = re.sub(r"[\s_]+", "-", text).strip("-")
    return text[:max_len]


def generate_md(article: dict) -> str:
    """Generate a single MD file and return its relative path.

    Returns empty string if title is missing.
    """
    title = article.get("title_zh") or article.get("title", "")
    if not title:
        return ""

    date_str = article.get("published") or datetime.now().strftime("%Y-%m-%d")
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        dt = datetime.now()

    year = dt.strftime("%Y")
    month = dt.strftime("%m")
    slug = _slugify(title)
    uid = article.get("uid", "unknown")
    filename = f"{date_str}-{slug}-{uid}.md"

    out_dir = NOTES_DIR / year / month
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / filename
    rel_path = f"notes/{year}/{month}/{filename}"

    # Skip if already exists
    if out_path.exists():
        return rel_path

    # Build frontmatter
    fm = {
        "uid": uid,
        "title": title,
        "date": date_str,
        "source": article.get("source_id", ""),
        "source_url": article.get("url", ""),
        "category": article.get("category", "general"),
        "region": article.get("region", "全球"),
        "importance": article.get("importance", "medium"),
    }
    if article.get("title_zh"):
        fm["title_en"] = article.get("title", "")

    # Build body
    summary = article.get("summary_zh") or article.get("snippet", "")
    body_lines = []
    if summary:
        body_lines.append(f"## 摘要\n\n{summary}")
    source_url = article.get("url", "")
    if source_url:
        body_lines.append(f"\n## 來源\n\n[原文連結]({source_url})")
    body = "\n".join(body_lines)

    # Write file
    content = (
        f"---\n"
        f"{yaml.dump(fm, allow_unicode=True, default_flow_style=False)}"
        f"---\n\n# {title}\n\n{body}\n"
    )
    out_path.write_text(content, encoding="utf-8")
    logger.info("Generated: %s", rel_path)
    return rel_path


def generate_all(articles: list) -> list:
    """Generate MD files for all articles. Returns updated articles with note_path."""
    results = []
    generated = 0
    for art in articles:
        note_path = generate_md(art)
        results.append({**art, "note_path": note_path})
        if note_path:
            generated += 1
    logger.info("Generated %d markdown files", generated)
    return results
