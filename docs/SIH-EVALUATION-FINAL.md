# CAPTAIN SIH evaluation — measured results

Generated from `runtime/benchmark-results.json` benchmark version 1.1.0 at 2026-09-17T21:02:33.917Z. These are results on CAPTAIN's local labeled synthetic screens and one deterministic shopping workflow. They are not claims of general-web model accuracy.

## Results

| Area | Measured result | Evidence scope |
|---|---:|---|
| Labeled screens | 23/23 passed | Installed Chrome extension in the CAPTAIN Incognito window |
| Visual target precision / recall / F1 | 100% / 100% / 100% | 52 labeled visible actionable targets across 23 synthetic screens |
| PII-region precision / recall / F1 | 100% / 100% / 100% | 20 labeled private regions across the same screens |
| Pixel redaction precision / recall / F1 | 100% / 96.19% / 98.06% | Separate synthetic visual-privacy fixture; CSS-pixel overlap |
| Shopping task completion | 1/1 (100%) | Search, category, max price, sort, open and verify cheapest qualifying product |
| Real-site acceptance catalog | 5 verified / 1 blocked / 1 failed | Seven current public-site definitions; failure and CAPTCHA preserved honestly |
| Average / P95 observation | 1,984 ms / 2,008 ms | Includes each page navigation plus installed-extension observation; latest rerun, replacing a faster prior sample |
| Shopping end-to-end | 7,415 ms | Six actions through the real observe-plan-execute loop |
| Local visual processing | 503 ms | UltraFace WASM plus local sanitization on the latest privacy run |
| Sanitized-image VLM plan | Passed in 18,461 ms | `qwen3-vl:2b` returned a validated `click` using observed `c1`; no raw image was provided |
| Model + loaded runtime footprint | 14.76 MiB | Measured audit footprint |
| Idle CPU | 6.84% of one core | Three-second aggregate sample after cooldown |
| Active CPU | 17.32% of one core | Aggregate dedicated-Chrome sample, not extension-only |
| Chrome working set | 858.81 MiB | Aggregate upper bound for the dedicated Chrome instance, not extension-only |

## Privacy assertions

The live visual audit recorded: local model execution, two face detections and pixelation, DOM PII detection, blackout of sensitive/uninspectable regions, accepted hash-bound sanitized JPEG, rejected tampered payload, no raw screenshot sent, and a completed production observe-plan-execute step. The persisted artifact is sanitized only; no raw counterpart is stored.

An earlier real-site audit completed on Amazon India in 10 steps and 23,938 ms. It applied the observed “Up to ₹48,000” filter, compared three visible laptops, opened ASIN `B0G2MT8YVV` at the then-observed price ₹12,990, verified the ASIN in the final URL, recorded local visual status `sanitized`, and found no recognized PII pattern in the outbound-shaped DOM/history payload. This historical pass is not the current status.

The later seven-site catalog run did not reproduce that Amazon final state: it stopped on search results and correctly recorded `FAILED / CHANGED / FINAL STATE MISMATCH`. A fresh specialized rerun then failed because the Amazon navigation did not finish loading within 45 seconds; that current failure is in `runtime/amazon-audit.json`. BBC, Flipkart, India.gov.in, HTTPBin form navigation and Wikipedia verified; Stack Overflow presented human verification and was recorded as blocked. See [real-world acceptance](REAL-WORLD-ACCEPTANCE.md).

On the latest run Chrome's `captureVisibleTab` returned `image readback failed`; CAPTAIN recovered with its local debugger `Page.captureScreenshot` fallback. The same privacy worker, redaction, integrity proof, and network boundary were then exercised successfully. Firefox omits this Chrome-only fallback and therefore still needs live validation.

## Known measurement limits

- The benchmark pages are synthetic and controlled.
- The local and real-site task-completion samples are individual workflows, not a statistically meaningful general benchmark.
- CPU and memory figures are whole dedicated-browser upper bounds where extension-only attribution is unavailable.
- OCR latency, WebGPU availability, per-stage capture/DOM/network/action timing, visual IoU, and over-redaction are not yet independently reported.
- Firefox and physical-device wake-word results are not included because they have not been run on this machine.
- The earlier `qwen2.5:0.5b` text model failed strict plan validation after 68,063 ms. It was replaced by the passing `qwen3-vl:2b` configuration; one passing smoke test does not establish general VLM accuracy.

Reproduce with `npm run test:visual-privacy`, `npm run test:shopping`, `npm run test:amazon`, `npm run test:acceptance`, `npm run test:handoff`, and `npm run benchmark` while the CAPTAIN Incognito test window is running.
