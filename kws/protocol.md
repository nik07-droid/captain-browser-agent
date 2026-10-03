# Wake-to-ASR wire protocol

Transport is one WebSocket with compression disabled. Audio is mono 16 kHz signed little-endian PCM. This avoids container and Base64 overhead.

Device → server start frame:

```json
{"type":"start","format":"pcm_s16le","sampleRateHz":16000,"channels":1,"frameMs":20,"clientId":"captain-browser","token":"shared secret"}
```

Device → server: binary frames containing 320 samples / 640 bytes each. The first frames are the 300 ms local pre-roll.

Server → device on first binary frame:

```json
{"type":"first_audio_ack","serverMonotonicNs":123456789}
```

Device → server end frame:

```json
{"type":"stop"}
```

Server → device:

```json
{"type":"transcript","text":"open Blender","language":"en","audioBytes":44800}
```

The CAPTAIN controller keeps a second WebSocket registered with the same `clientId`:

```json
{"type":"register_browser","clientId":"captain-browser","token":"shared secret"}
```

After ASR, the server sends that controller `{"type":"command","text":"open Blender","source":"edge-kws-asr"}`. The controller treats this as a wake-confirmed command and sends it through the normal privacy and browser-action path.

Measure keyword-end → first-audio-ack on the physical device using the monotonic clock and report p50/p95. The server timestamp alone is not comparable with the MCU clock unless both are synchronized.
