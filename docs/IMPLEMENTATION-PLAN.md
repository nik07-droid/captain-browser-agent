# CAPTAIN implementation plan

## Current architecture

- `extension/`: Manifest V3 Incognito extension, voice/controller UI, DOM observer, local visual worker, privacy redaction, task loop and browser executor.
- `server/`: loopback Node service, privacy boundary, deterministic planner, Ollama provider and OpenAI-compatible VLM provider.
- `dashboard/`: control page, demo store and labelled privacy fixture.
- `tests/`: Node tests for privacy, planning, browser targeting, panels, voice and recovery.
- `scripts/`: launch, reload, browser audits, packaging and evaluation utilities.
- `kws/`: optional custom Hey Captain dataset/training/device pipeline; it is not yet physically validated.

## Verified functionality

- Real Chrome Incognito capture, DOM observation, stable per-observation references, local UltraFace ONNX/WASM inference and local redaction.
- Hash-bound sanitized JPEG validation; raw or modified screenshots fail closed.
- Structured action planning/execution with a bounded, cancellable observe → sanitize → plan → execute loop.
- A labelled privacy fixture with calculated visual, PII, redaction, resource and latency measurements.

## Missing or partial functionality

- Remote actions must be prevented from typing into credential fields; local-only credential entry is required.
- General perception needs richer DOM geometry/fusion and a replaceable OCR adapter.
- The shopping demo needs filtering, sorting, product comparison and verifiable completion.
- The benchmark must grow from one fixture to 10–20 labelled scenarios and feed a real dashboard.
- Firefox needs static compatibility checks and live testing when a Firefox runtime is available.
- The JavaScript layout needs incremental TypeScript/shared-package boundaries without rewriting stable runtime code.
- Security needs stricter CORS/origin/rate/payload controls and explicit permission documentation.
- The optional custom wake-word model remains untrained and physically unmeasured.

## Migration order

1. Enforce sensitive-target action policy and implement local-only secure entry.
2. Expand unified DOM/geometry/state metadata and privacy recognizers.
3. Complete the local shopping workflow using the normal perception/action loop.
4. Add the labelled benchmark suite, task completion scoring and live dashboard data.
5. Add provider verification, Firefox static checks, strict schemas and server hardening.
6. Add TypeScript package boundaries, reproducible build/Docker commands and final compliance reports.
7. Train/measure wake word only after the browser-agent gates pass.

## Testing plan

- Preserve all existing tests.
- Add unit tests for every new policy/schema/metric.
- Add real Chrome audits for screenshot privacy, sensitive-input blocking and shopping completion.
- Treat unavailable external runtimes/models as explicit pending gates; never replace them with passing mocks.

## Definition of done

The authoritative checklist is `docs/SIH-COMPLIANCE.md`. A row is complete only when it links to code and a passing automated or live test. Fixture scores are labelled synthetic, Firefox is labelled pending until executed, and physical wake-word claims require physical measurements.
