"""Record a user-owned custom wake-word dataset as 16 kHz mono PCM WAV."""
from __future__ import annotations

import argparse
import time
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

RATE = 16_000
SAMPLES = RATE
VALID_LABELS = {"hey_captain", "unknown", "background"}


def write_wav(path: Path, samples: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(samples.reshape(-1), -1, 1)
    pcm = (pcm * 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(pcm.tobytes())


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture CAPTAIN KWS clips locally")
    parser.add_argument("label", choices=sorted(VALID_LABELS))
    parser.add_argument("--count", type=int, default=50)
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "dataset")
    parser.add_argument("--device", help="sounddevice input device name or index")
    args = parser.parse_args()
    if args.count < 1:
        raise SystemExit("--count must be positive")
    device = int(args.device) if args.device and args.device.isdigit() else args.device
    prompt = "say HEY CAPTAIN" if args.label == "hey_captain" else "speak a non-keyword phrase" if args.label == "unknown" else "stay quiet / play normal room noise"
    print(f"Recording {args.count} local clips. When prompted, {prompt}.")
    for index in range(args.count):
        print(f"[{index + 1}/{args.count}] Ready…", flush=True)
        time.sleep(0.55)
        audio = sd.rec(SAMPLES, samplerate=RATE, channels=1, dtype="float32", device=device)
        sd.wait()
        stamp = time.strftime("%Y%m%d-%H%M%S")
        path = args.out / args.label / f"{stamp}-{time.time_ns()}-{index:04d}.wav"
        write_wav(path, audio)
        print(f"  saved {path}")


if __name__ == "__main__":
    main()
