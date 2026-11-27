from pathlib import Path

import yaml


def test_wif_credentials_are_refreshable_and_never_git_added():
    root = Path(__file__).resolve().parents[1]
    for workflow in ("crawl", "reclassify"):
        flow = yaml.load((root / f".github/workflows/{workflow}.yml").read_text(), Loader=yaml.BaseLoader)
        assert flow["permissions"]["id-token"] == "write"
        steps = flow["jobs"][workflow]["steps"]
        auth = next(s for s in steps if s.get("id") == "vertex-auth")
        assert auth["with"]["create_credentials_file"] == "true"
        assert "github.ref == 'refs/heads/main'" in auth["if"]
        assert "vars.VERTEX_TRANSLATION_ENABLED == 'true'" in auth["if"]
        assert "credentials_json" not in auth["with"]
        for step in steps:
            if "git add -A" in step.get("run", ""):
                assert "git add -A -- . ':!gha-creds-*.json'" in step["run"]
        runtime = next(s for s in steps if s.get("name") in {"Run crawl pipeline", "Run reclassify"})
        assert "VERTEX_PROJECT_ID" in runtime["env"]
        assert "vars.VERTEX_TRANSLATION_ENABLED == 'true'" in runtime["env"]["VERTEX_PROJECT_ID"]
        assert "GEMINI_CLOUD_API_KEY" not in runtime["env"]
