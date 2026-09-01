# tools/print-factory/tests/test_spec.py
import pytest
from printfactory.spec import JobSpec, SpecError

def test_minimal_qr_spec_needs_no_shell():
    s = JobSpec.from_dict({"fixture": "qr_plaque", "params": {"payload": "https://x.co"}})
    assert s.fixture == "qr_plaque"
    assert s.shell_glb is None

def test_candle_spec_carries_a_shell_and_height():
    s = JobSpec.from_dict({
        "fixture": "candle_cradle",
        "params": {"jar_dia": 89},
        "shell_glb": "/tmp/shell.glb",
        "target_height_mm": 200,
    })
    assert s.shell_glb == "/tmp/shell.glb"
    assert s.target_height_mm == 200

def test_defaults_match_the_design_doc():
    s = JobSpec.from_dict({"fixture": "qr_plaque", "params": {}})
    assert s.wall_mm == 2.4
    assert s.voxel_mm == 0.6
    assert s.density == 1.24

def test_unknown_fixture_is_rejected():
    with pytest.raises(SpecError, match="unknown fixture"):
        JobSpec.from_dict({"fixture": "teapot", "params": {}})

def test_missing_fixture_is_rejected():
    with pytest.raises(SpecError, match="fixture"):
        JobSpec.from_dict({"params": {}})

def test_wall_thinner_than_two_nozzle_widths_is_rejected():
    # 0.4mm nozzle: anything under 0.8mm cannot be printed as a wall
    with pytest.raises(SpecError, match="wall_mm"):
        JobSpec.from_dict({"fixture": "qr_plaque", "params": {}, "wall_mm": 0.5})
