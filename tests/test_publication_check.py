"""Synthetic end-to-end gate fixtures, no external service calls."""
import json
from pathlib import Path
from unittest.mock import patch
import pytest

from src.agent_publication import build_agent_data, parse_markdown, publish_articles, publish_wikis
from src.monthly_store import MonthlyStore, StorageError, put_object, read_object, write_snapshot
from src.publication_check import verify_publication
from src.publication_check import verify_live, verify_staged
from scripts.migrate_monthly_index import migrate
from test_monthly_store import article


@pytest.fixture
def publication(tmp_path):
    store = MonthlyStore(tmp_path / "index/master-index.json")
    store.save([article()])
    rows = store.load()
    data = tmp_path / "frontend/public/data"
    agent = data / "agent"
    publish_articles(rows, agent)
    publish_wikis(tmp_path / "compiled/monthly", agent, rows)
    (data / "articles-manifest.json").write_text(json.dumps({"months": [{"file": "articles-2026-08.json"}]}))
    (data / "articles-2026-08.json").write_text(json.dumps(rows))
    return tmp_path, rows, agent


def test_full_gate_and_entrypoint(publication):
    root, rows, agent = publication
    assert verify_publication(root, rows)["records"] == 1
    with patch("src.index_manager.load_index", return_value=rows), patch("src.agent_publication.__file__", str(root / "src/agent_publication.py")):
        articles, wiki = build_agent_data()
    assert articles["total_records"] == 1
    assert wiki["pages"] == {}


def test_gate_rejects_missing_browser_records(publication):
    root, rows, agent = publication
    (root / "frontend/public/data/articles-2026-08.json").write_text("[]")
    with pytest.raises(StorageError, match="visibility mismatch"):
        verify_publication(root, rows)


def test_gate_checks_historical_citation_targets(publication):
    root, rows, agent = publication
    manifest = json.loads((agent / "manifest.json").read_text())
    folder = root / "compiled/monthly/2026-08"
    folder.mkdir(parents=True)
    refs = [{"article_id": rows[0]["uid"], "revision_id": rows[0]["_lineage"]["revision_id"], "snapshot_id": manifest["snapshot_id"]}]
    path = folder / "market-global.md"
    path.write_text('---\ncompiled_at: 2026-08-01T00:00:00Z\nsource_refs: ' + json.dumps(refs) + '\n---\nSynthetic [1].')
    publish_wikis(folder.parent, agent, rows)
    assert verify_publication(root, rows)["wiki_lineage"] == {"explicit_citation_links": 1}
    refs[0]["revision_id"] = "f" * 64
    path.write_text('---\nsource_refs: ' + json.dumps(refs) + '\n---\nSynthetic [1].')
    publish_wikis(folder.parent, agent, rows)
    with pytest.raises(StorageError, match="source revision unavailable"):
        verify_publication(root, rows)


def test_migration_cli_is_field_preserving_and_repeatable(tmp_path):
    path = tmp_path / "master-index.json"
    rows = [article(), article("b2", "2013-01-01", filter="irrelevant")]
    path.write_text(json.dumps(rows))
    assert migrate(path)["status"] == "sample_passed_not_applied"
    assert isinstance(json.loads(path.read_text()), list)
    assert migrate(path, True)["records"] == 2
    assert migrate(path, True)["status"] == "already_migrated"


def test_malformed_wiki_is_an_error():
    assert parse_markdown("Plain markdown") == ({}, "Plain markdown")
    for raw in ("---\nunfinished", "---\n- wrong\n---\nbody"):
        with pytest.raises(StorageError):
            parse_markdown(raw)


def test_staged_blob_size_gate_checks_index_not_worktree():
    with patch("src.publication_check.subprocess.check_output", side_effect=[b"big.json\0", b"52428801"]):
        with pytest.raises(StorageError, match="staged file"):
            verify_staged()
    with patch("src.publication_check.subprocess.check_output", side_effect=[b"small.json\0", b"100"]):
        verify_staged()


def test_live_snapshot_check_uses_exact_expected_versions_without_real_network(publication):
    from unittest.mock import Mock
    root, rows, agent = publication
    response = Mock()
    response.json.side_effect = [json.loads((agent / n).read_text()) for n in ("manifest.json", "wiki-manifest.json")]
    with patch("src.publication_check.ROOT", root), patch("requests.get", return_value=response) as get:
        verify_live(base_urls=("https://example.test",), attempts=1)
        assert get.call_count == 2
    response.json.side_effect = None
    response.json.return_value = {"schema_version": 3, "snapshot_id": "wrong"}
    with patch("src.publication_check.ROOT", root), patch("requests.get", return_value=response):
        with pytest.raises(StorageError):
            verify_live(base_urls=("https://example.test",), attempts=1)


def test_live_snapshot_check_retries_stale_alias_then_passes(publication):
    from unittest.mock import Mock
    from src.monthly_store import digest

    root, rows, agent = publication
    expected = {
        name: json.loads((agent / name).read_text())
        for name in ("manifest.json", "wiki-manifest.json")
    }
    stale_body = {
        key: value
        for key, value in expected["manifest.json"].items()
        if key != "snapshot_id"
    }
    stale_body["total_records"] += 1
    stale = {**stale_body, "snapshot_id": digest(stale_body)}
    responses = []
    for payload in (stale, expected["manifest.json"], expected["wiki-manifest.json"]):
        response = Mock()
        response.json.return_value = payload
        responses.append(response)

    with (
        patch("src.publication_check.ROOT", root),
        patch("requests.get", side_effect=responses) as get,
        patch("src.publication_check.time.sleep") as sleep,
    ):
        verify_live(
            base_urls=("https://example.test",),
            attempts=2,
            sleep_seconds=0.01,
        )

    assert get.call_count == 3
    sleep.assert_called_once_with(0.01)


def test_live_snapshot_check_verifies_custom_and_pages_aliases(publication):
    from unittest.mock import Mock

    root, rows, agent = publication
    payloads = [
        json.loads((agent / name).read_text())
        for _base in range(2)
        for name in ("manifest.json", "wiki-manifest.json")
    ]
    responses = []
    for payload in payloads:
        response = Mock()
        response.json.return_value = payload
        responses.append(response)

    with patch("src.publication_check.ROOT", root), patch(
        "requests.get", side_effect=responses
    ) as get:
        verify_live(attempts=1)

    assert get.call_count == 4
    called_urls = [call.args[0] for call in get.call_args_list]
    assert any("insurance-kb.cooperation.tw" in url for url in called_urls)
    assert any("insurance-kb-v2.pages.dev" in url for url in called_urls)


@pytest.mark.parametrize("change,match", [
    ("total", "differs"), ("count", "shard count"), ("duplicate", "duplicate Agent"),
    ("catalog", "wrong record"), ("missing_catalog", "incomplete ID"),
    ("search_total", "search coverage"), ("search_row", "search projection"),
])
def test_gate_rejects_structurally_valid_but_incomplete_exports(publication, change, match):
    root, rows, agent = publication
    manifest = json.loads((agent / "manifest.json").read_text())
    manifest.pop("snapshot_id")
    if change == "total":
        manifest["total_records"] = 2
    elif change == "count":
        manifest["shards"][0]["count"] = 2
    elif change == "duplicate":
        manifest["shards"].append(manifest["shards"][0])
    elif change == "missing_catalog":
        manifest["catalogs"] = {}
    elif change == "search_total":
        manifest["search_records"] = 2
    elif change == "search_row":
        batch = read_object(agent, manifest["search_shards"][0])
        batch[0]["title"] = "incorrect projected title"
        file, sha, size = put_object(agent, batch, "objects/search")
        manifest["search_shards"][0].update(file=file, sha256=sha, bytes=size)
    else:
        catalog = {"a1": {**manifest["shards"][0], "revision_id": "f" * 64}}
        file, sha, size = put_object(agent, catalog, "catalogs")
        manifest["catalogs"] = {"a": {"file": file, "sha256": sha}}
    write_snapshot(agent, manifest, agent / "manifest.json")
    with pytest.raises(StorageError, match=match):
        verify_publication(root, rows)
