# CAPTAIN custom keyword spotting

This is the open-source TinyML path for the custom phrase **Hey Captain**. It does not use Chrome speech recognition or a pre-trained Alexa/Google/global wake model.

## Dataset and training

Create a Python environment and install `kws/requirements.txt`. The feature extractor must expose TensorFlow's `AudioMicrofrontend`; use Linux/WSL or the upstream TFLM Bazel environment if your Windows TensorFlow wheel does not contain that operation. Record genuine data—synthetic TTS alone is not an accuracy evaluation:

```powershell
python kws/capture.py hey_captain --count 150
python kws/capture.py unknown --count 250
python kws/capture.py background --count 100
python kws/train.py
```

Use multiple speakers, distances, microphones, rooms and hard negatives such as “captain”, “hey camera”, music, TV, and normal conversation. Keep speakers separated between train and held-out evaluation when collecting a formal benchmark.

The training script builds a tiny convolutional classifier from scratch, exports a fully-int8 `.tflite` model and C header, and rejects models above 32 KB. Its 49x40 input contract matches TensorFlow Lite Micro `micro_speech` preprocessing.

## ASR streaming

Run `python kws/asr_server.py --model small.en` on the ASR machine. Set `CAPTAIN_ASR_TOKEN` on that machine and put the same token into the device's protected configuration. Use TLS (`wss://`) through a reverse proxy outside a trusted test LAN.

## Submission gates

After flashing the target board, create `kws/artifacts/board-metrics.json` with measured `peakTotalRamBytes`, `idleCpuPercent`, `truePositiveRate`, `falseActivationsPerHour`, and `p95KeywordToFirstAudioMs`. Then run:

```powershell
python kws/verify_budget.py
```

Missing evidence is a failure. Desktop tests cannot prove ESP32/Raspberry Pi RAM, idle CPU, acoustic accuracy, or network latency.
