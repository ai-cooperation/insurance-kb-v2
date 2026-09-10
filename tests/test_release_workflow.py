"""Release ordering and safety contract; no real deployment in tests."""
from pathlib import Path
import yaml


def test_release_is_explicit_serialized_data_first_and_fail_loud():
    path = Path(__file__).resolve().parents[1] / ".github/workflows/release.yml"
    flow = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
    assert set(flow["on"]) == {"workflow_dispatch"}
    assert flow["concurrency"]["group"] == "insurance-kb-pipeline"
    steps = flow["jobs"]["release"]["steps"]
    names = [s.get("name", "") for s in steps]
    assert names.index("Verify publication") < names.index("Deploy Pages")
    assert names.index("Verify published data") < names.index("Deploy Worker")
    assert names.index("Verify deployment targets") < names.index("Deploy Pages")
    assert any(s.get("if") == "failure()" and "TELEGRAM_BOT_TOKEN" in s.get("env", {}) for s in steps)
    assert "--keep-vars" in next(s["run"] for s in steps if s.get("name") == "Deploy Worker")
    assert all("python run.py" not in s.get("run", "") for s in steps)
