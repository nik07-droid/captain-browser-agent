# CAPTAIN MCU integration

This directory contains the allocation-free wake gate and pre-roll audio buffer. Integrate it with an ESP-IDF I2S microphone, the TensorFlow Lite Micro `micro_speech` 49x40 feature provider, the generated `artifacts/captain_kws_model.h`, and a WebSocket client.

The required loop is:

1. Read one 320-sample (20 ms), 16 kHz mono PCM frame from I2S.
2. Update the upstream `micro_speech` feature provider and invoke the int8 classifier.
3. Pass the `hey_captain` probability and raw PCM frame to `CaptainKwsGate::OnFrame`.
4. On the first send callback, open the ASR WebSocket, send the JSON `start` contract from `protocol.md`, then transmit binary PCM. `CaptainKwsGate` first flushes 300 ms of pre-roll so speech immediately after the keyword is not clipped.
5. Send `stop` after endpointing/inactivity, receive the transcript, and forward that text to the CAPTAIN browser control plane.

Do not count the `<256 KB` requirement from source estimates. Use the board's linker map plus peak tensor arena, audio DMA buffers, task stacks, network/TLS buffers and this gate. Record the measured total in `kws/artifacts/board-metrics.json`, then run `python kws/verify_budget.py`.

The checked-in code deliberately contains no generic pre-trained wake weights. `train.py` creates weights only from `kws/dataset` recordings for the custom phrase **Hey Captain**.
