"""Unit tests for netem profile generation and dry-run output."""

from __future__ import annotations

import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from netem import PROFILES, build_netem_commands


def test_netem_profiles_coverage():
    expected_profiles = [
        "loss-1",
        "loss-3",
        "loss-5",
        "loss-10",
        "delay-50",
        "delay-100",
        "delay-200-jitter-50",
        "rate-5mbit",
        "rate-1mbit",
        "rate-300kbit",
    ]
    for p in expected_profiles:
        assert p in PROFILES
        cmds = build_netem_commands("eth0", profile=p)
        assert len(cmds) == 2
        assert "tc qdisc replace dev eth0 root netem" in cmds[1]


def test_netem_clear():
    cmds = build_netem_commands("eth0", clear=True)
    assert len(cmds) == 1
    assert "tc qdisc del dev eth0 root" in cmds[0]


def test_netem_validation():
    with pytest.raises(ValueError):
        build_netem_commands("")
    with pytest.raises(ValueError):
        build_netem_commands("eth0", profile="invalid-profile")
