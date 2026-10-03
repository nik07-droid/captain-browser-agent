# Open-source components

- TensorFlow / TensorFlow Lite Micro: Apache-2.0. The project uses the `micro_speech` feature contract and full-int8 export.
- faster-whisper: MIT. Used by the reference remote ASR server.
- Python websockets: BSD. Used for binary PCM transport and transcript relay.
- NumPy: BSD-3-Clause. Used for local dataset/audio preparation.
- python-sounddevice: MIT. Used only by the local dataset recorder.

Dependency licenses must be included and rechecked when producing a distributable image. CAPTAIN does not depend on Alexa, Google Assistant, Picovoice, or another proprietary wake-word SDK.
