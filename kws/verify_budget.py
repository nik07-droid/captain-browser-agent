"""Fail closed unless model, board memory/CPU, accuracy and latency all pass."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).parent
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--training", type=Path, default=ROOT / "artifacts" / "training-report.json")
    parser.add_argument("--board", type=Path, default=ROOT / "artifacts" / "board-metrics.json")
    args = parser.parse_args()
    missing = [str(path) for path in (args.training, args.board) if not path.exists()]
    if missing:
        raise SystemExit("FAIL: missing measured evidence: " + ", ".join(missing))
    training = json.loads(args.training.read_text(encoding="utf-8"))
    board = json.loads(args.board.read_text(encoding="utf-8"))
    budget = CONFIG["budgets"]
    checks = {
        "custom_from_scratch": training.get("keyword") == CONFIG["keyword"] and training.get("trainedFromScratch") is True and training.get("pretrainedKeywordWeights") is False,
        "model_size": int(training.get("modelBytes", 10**9)) <= budget["modelBytes"],
        "total_ram": int(board.get("peakTotalRamBytes", 10**9)) < 256 * 1024,
        "idle_cpu": float(board.get("idleCpuPercent", 100)) < 10,
        "true_positive_rate": float(board.get("truePositiveRate", 0)) >= 0.95,
        "false_activations_per_hour": float(board.get("falseActivationsPerHour", 100)) <= 0.1,
        "keyword_to_server_audio": float(board.get("p95KeywordToFirstAudioMs", 10**9)) <= budget["keywordToFirstAudioMs"],
    }
    print(json.dumps({"passed": all(checks.values()), "checks": checks, "training": training, "board": board}, indent=2))
    if not all(checks.values()):
        raise SystemExit("FAIL: one or more submission gates did not pass")


if __name__ == "__main__":
    main()
