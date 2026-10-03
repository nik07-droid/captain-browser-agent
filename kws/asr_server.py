"""Reference remote ASR WebSocket: receives post-wake PCM and returns text.

Deploy this process on the remote machine. The device sends one compact JSON
start frame followed immediately by 20 ms binary PCM frames and a JSON stop.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import tempfile
import time
import wave
from pathlib import Path

from faster_whisper import WhisperModel
from websockets.asyncio.server import serve

MAX_AUDIO_BYTES = 16_000 * 2 * 30


async def device_session(socket, model: WhisperModel, first: dict, browsers: dict[str, object]) -> None:
    token = os.environ.get("CAPTAIN_ASR_TOKEN", "")
    if first.get("type") != "start" or first.get("format") != "pcm_s16le" or first.get("sampleRateHz") != 16_000:
        await socket.close(1008, "unsupported audio contract")
        return
    if token and first.get("token") != token:
        await socket.close(1008, "unauthorized")
        return
    audio = bytearray()
    first_audio_at = None
    async for message in socket:
        if isinstance(message, bytes):
            if first_audio_at is None:
                first_audio_at = time.perf_counter_ns()
                await socket.send(json.dumps({"type": "first_audio_ack", "serverMonotonicNs": first_audio_at}))
            audio.extend(message)
            if len(audio) > MAX_AUDIO_BYTES:
                await socket.close(1009, "audio limit exceeded")
                return
            continue
        control = json.loads(message)
        if control.get("type") == "cancel":
            return
        if control.get("type") != "stop":
            continue
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
            path = Path(handle.name)
        try:
            with wave.open(str(path), "wb") as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16_000); wav.writeframes(audio)
            segments, info = await asyncio.to_thread(model.transcribe, str(path), beam_size=1, vad_filter=True)
            text = " ".join(segment.text.strip() for segment in segments).strip()
            result = json.dumps({"type": "transcript", "text": text, "language": info.language, "audioBytes": len(audio)})
            await socket.send(result)
            browser = browsers.get(str(first.get("clientId", "")))
            if browser:
                try:
                    await browser.send(json.dumps({"type": "command", "text": text, "source": "edge-kws-asr"}))
                except Exception:
                    browsers.pop(str(first.get("clientId", "")), None)
        finally:
            path.unlink(missing_ok=True)
        return


async def connection(socket, model: WhisperModel, browsers: dict[str, object]) -> None:
    first = json.loads(await socket.recv())
    token = os.environ.get("CAPTAIN_ASR_TOKEN", "")
    if first.get("type") == "register_browser":
        if token and first.get("token") != token:
            await socket.close(1008, "unauthorized")
            return
        client_id = str(first.get("clientId", "")).strip()
        if not client_id or len(client_id) > 80:
            await socket.close(1008, "invalid client id")
            return
        browsers[client_id] = socket
        await socket.send(json.dumps({"type": "registered", "clientId": client_id}))
        try:
            await socket.wait_closed()
        finally:
            if browsers.get(client_id) is socket:
                browsers.pop(client_id, None)
        return
    await device_session(socket, model, first, browsers)


async def run(args) -> None:
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    browsers: dict[str, object] = {}
    async with serve(lambda socket: connection(socket, model, browsers), args.host, args.port, max_size=MAX_AUDIO_BYTES + 4096, compression=None):
        print(f"CAPTAIN ASR listening on ws://{args.host}:{args.port}/ (compression disabled for PCM)")
        await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", default="small.en")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    asyncio.run(run(parser.parse_args()))
