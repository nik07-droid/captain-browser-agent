# CAPTAIN 0.4.0 — custom keyword status

## Implemented and verified on this computer

- Custom keyword contract: `hey captain`; labels are `silence`, `unknown`, `hey_captain`.
- No pre-trained global keyword weights or proprietary activation SDK are referenced by the training code.
- Dataset capture writes 16 kHz, mono, signed 16-bit PCM WAV locally.
- Training is from scratch and exports an int8-input/int8-output TFLite classifier plus a C header.
- The model-file gate is 32 KB.
- The MCU wake gate has no heap allocation, requires consecutive detections, enforces cooldown, and preserves 300 ms of pre-roll.
- Post-wake transport uses 640-byte binary PCM frames; no Base64 or WebSocket compression.
- The ASR server acknowledges the first audio frame and relays the transcript to the paired CAPTAIN browser controller.
- The browser controller sends an edge transcript through the existing task dispatcher and returns to sleep after completion.
- `npm run check`: 157/157 code tests pass.
- Real browser audit passed in one Incognito working tab: `search for Python official website and open the first result` navigated through fresh Google results to `https://www.python.org/` and verified the destination.

## Not yet achieved or claimed

- There is no trained `Hey Captain` model artifact because genuine positive, hard-negative and background recordings have not been collected.
- No ESP32/Raspberry Pi firmware image has been built or flashed in this environment.
- The `<256 KB` peak-total-RAM and `<10%` idle-CPU limits have not been measured on physical hardware.
- True-positive rate, false activations/hour and keyword-end → server-first-audio latency have not been measured.
- Therefore this is a deployable implementation path, not a passed physical SIH submission.

`python kws/verify_budget.py` deliberately fails if the training report or physical board metrics are absent. This prevents missing measurements from being presented as zero or as success.

## Required next physical step

Record a speaker-separated dataset using `kws/capture.py`, train in a TensorFlow environment that contains the `AudioMicrofrontend` operation, integrate the generated header with TensorFlow Lite Micro `micro_speech` preprocessing and the target board's I2S/WebSocket drivers, then populate `kws/artifacts/board-metrics.json` from real instrumentation. Use `kws/board-metrics.example.json` as the schema.
