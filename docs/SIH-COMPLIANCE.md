# CAPTAIN SIH compliance matrix

Status reflects verified repository behavior on 2026-09-17. “Partial” means an implementation exists but the full requested evidence is not yet available. Nothing in this document should be read as certification for arbitrary websites.

| Requirement | Status | Evidence / implementation |
|---|---|---|
| Chrome extension and Incognito execution | Implemented, verified | `extension/manifest.json`; `scripts/start-demo.mjs`; live audits |
| Visible screenshot capture | Implemented, verified | `captureVisibleTab` path in `extension/service-worker.js` |
| DOM extraction with stable refs, roles, text, geometry, state, confidence, source | Implemented, verified on labeled screens | `extension/content-script.js`; 23-screen benchmark |
| General local perception | Partial | DOM/geometry fusion covers common interactive objects and product-card grouping; UltraFace handles faces. No general object-detection ViT is present. |
| Local OCR | Not implemented | DOM text is extracted; pixels containing text are not yet independently OCR'd. |
| Local face inference | Implemented, verified on synthetic fixture | UltraFace ONNX/WASM worker; `npm run test:visual-privacy` |
| Local PII detection | Implemented, fixture-verified | DOM semantics, input types, labels, regex/context detectors; 14/14 labeled regions in current benchmark |
| Local redaction before network | Implemented, verified | Blackout plus face pixelation; sanitized JPEG proof/hash validation |
| Raw screen cannot cross server boundary | Implemented, verified | Server privacy validator plus raw/tampered payload rejection tests |
| Sensitive-field remote typing blocked | Implemented, tested | `extension/action-security.mjs`; duplicate executor guard; malicious-action tests |
| Local-only credential entry | Implemented, code-tested | Closed Shadow DOM secure prompt; value is inserted locally and omitted from result/context |
| Ollama provider | Implemented, verified | `qwen3-vl:2b` produced a strictly validated plan from the sanitized JPEG in 18,461 ms on the latest run; `runtime/vlm-audit.json` |
| OpenAI-compatible provider | Implemented, not configured in this audit | `server/planner.mjs`; environment variables only |
| Vision-capable reasoning provider | Implemented, smoke-tested | Sanitized-image Ollama transport is enabled; current one-case audit passed. Broader accuracy evaluation remains pending. |
| Strict structured action validation | Implemented, tested | Allowlist and ref/URL/sensitive-input validation in planner and executor |
| Autonomous observe → sanitize → plan → execute loop | Implemented, verified | Visual-privacy and shopping live audits |
| Real public website catalog | Partial, live-tested | Latest catalog: 5 verified, 1 CAPTCHA-blocked, 1 failed; `npm run test:acceptance`; `runtime/acceptance-summary.json` |
| Human challenge handoff | Implemented, fixture-verified | Pauses without bypass, refuses resume while challenge remains, then re-observes after user resume; `npm run test:handoff` |
| Shopping demo | Implemented, verified | Randomized store; 6-step result was Atlas Lite at ₹43,990 |
| 20+ benchmark screens | Implemented | 23 query-selected labeled screens in `dashboard/benchmark.html` |
| Machine-readable benchmark | Implemented | `npm run benchmark`; `runtime/benchmark-results.json` |
| Live measured dashboard | Implemented, visually verified | `/api/benchmark`; `dashboard/index.html`; no hardcoded SIH scores |
| Strict CORS/origin validation | Implemented, tested | `server/security.mjs`; unapproved origin returns 403 |
| Rate and payload limiting | Implemented, tested | 60 planner requests/minute/client; 4.5 MB byte limit; JSON-only POST |
| URL/action restrictions | Implemented, tested | HTTP(S)-only, credential rejection, discovery grounding, action allowlist |
| Extension permission minimization | Partial | Permissions are enumerated and used; `<all_urls>` and `debugger` remain broad but necessary for arbitrary-site control and physical click fallback |
| Firefox | Static only | Manifest/package/static capture and observer audit passes; no Firefox executable was detected, so no live install/capture/action claim is made |
| Browser adapter boundary | Implemented, integration partial | Typed Chrome/Firefox adapter contracts exist; proven extension runtime still uses direct Chrome APIs |
| TypeScript monorepo boundaries | Implemented, migration partial | Strict contracts and app/package boundaries exist under `apps/` and `packages/`; proven runtime remains JavaScript during incremental migration |
| Docker workflow | Implemented, not live-verified | `Dockerfile` and `docker-compose.yml` package the service/dashboard; Docker is unavailable on this machine |
| Resource evaluation | Partial | Honest model/runtime, browser-wide CPU and memory figures exist; per-extension attribution and WebGPU data are absent |
| Custom Hey Captain software flow | Partial | Voice state machine and custom TinyML training/export/budget scripts exist; no trained artifact or physical-device validation |
| Test suite | Implemented | 186/186 automated tests passed after current changes |

## Permission rationale

- `activeTab`, `tabs`: select, track and control the user-designated tab in one Incognito window.
- `storage`: non-secret settings, task state, and panel geometry.
- `scripting`: recover/inject the content executor after extension reloads.
- `debugger`: trusted coordinate click fallback when a page rejects DOM click; attached only for the action and detached in `finally`.
- `<all_urls>`: an arbitrary-site browser agent must observe and act on user-selected sites. The extension blocks normal-profile task execution and applies local sanitization before planner requests.
- loopback host permissions: communicate with the local CAPTAIN control plane.

## Remaining release gates

1. Add and evaluate real local OCR on pixels, including OCR-derived PII boxes.
2. Expand the passing sanitized-image VLM smoke test into a multi-screen accuracy suite.
3. Add richer labels/actions/final states, visual IoU and over-redaction to every benchmark case.
4. Add stage-by-stage latency and WebGPU/resource reporting.
5. Create and verify the Firefox build or preserve explicit pending status.
6. Complete runtime migration into the TypeScript package boundaries and live-test the container workflow on a Docker-equipped host.
7. Train the custom wake model and validate false positives/negatives and hardware limits on the target device.
