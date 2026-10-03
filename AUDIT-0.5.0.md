# CAPTAIN 0.5.0 audit

Date: 2026-09-17

## Verified on this machine

- `npm run check`: 162/162 automated tests passed.
- `npm run test:visual-privacy`: passed against a real Chrome Incognito tab.
- The extension captured a 1298 × 882 viewport locally.
- UltraFace ONNX ran in the extension worker through ONNX Runtime Web/WASM.
- 2 faces were detected; maximum confidence was 0.9996.
- 7 DOM/raster regions were blacked out.
- The labelled email, phone, PAN, address, password/secret and account-like data were removed from the observed context.
- In the final warm pass, sanitized output was 75,547 bytes. Local face inference took 30 ms; total local visual processing took 95 ms.
- The valid sanitized payload was accepted and a deliberately tampered payload was rejected with HTTP 422.
- The server round trip for the direct sanitized test was 12 ms; the production observe → sanitize → plan → execute loop took 2,120 ms.
- The production extension observe → sanitize → server plan → execute loop completed and moved the page to `scrollY = 112.8`.
- The audit did not return or persist the raw screenshot. The saved preview is sanitized-only.
- The labelled fixture scored 100% visual-target accuracy, 100% PII precision/recall, 100% redaction precision and 96.19% redaction recall.
- The loaded model plus required WASM runtime footprint is 14.76 MiB. A cooled three-second whole-Chrome sample used 1.06% of one CPU core; this is an aggregate upper bound, not extension-only attribution.

Machine-readable evidence: `runtime/visual-privacy-audit.json`.
Visual evidence: `runtime/sanitized-privacy-audit.jpg`.
Metric mapping and limitations: `SIH-EVALUATION-0.5.0.md`.

## Not yet proven

- No formal visual-accuracy percentage has been measured on a labelled UI dataset.
- No formal PII recall/precision or redaction precision has been measured on a representative dataset.
- Browser-process CPU and RAM have not been benchmarked on SIH target hardware.
- OCR inside images is not implemented; uninspectable raster regions are conservatively blacked out.
- UltraFace is a face detector, not a general UI-understanding model. DOM extraction supplies UI semantics.
- The server-side VLM path is configurable but was not used in this deterministic audit; the local fallback planner returned the tested scroll action.
- Firefox is packaged but has not been live-audited.
- Custom TinyML wake-word training and physical-device measurements remain incomplete.
