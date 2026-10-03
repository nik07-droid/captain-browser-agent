# CAPTAIN 0.5.0 — SIH evaluation mapping

Date: 2026-09-17

This report maps the working Chrome integration test to the five weights supplied by the user. Results come from one labelled synthetic page on this laptop. They are reproducible engineering evidence, not an official SIH score or a representative public benchmark.

| Evaluation area | Weight | Measured result | Method |
| --- | ---: | ---: | --- |
| Visual context accuracy | 25% | 100% (7/7 targets) | Four labelled safe text targets and three interactive controls compared with locally extracted page context. Interactive precision and recall were both 100%. |
| Sensitive/PII detection | 20% | Precision 100%, recall 100%, F1 100% | Six labelled regions: email, phone, PAN, address, password, and account field. Matching requires the correct category and at least 50% overlap against the smaller region. |
| Redaction precision | 20% | Precision 100%; recall 96.19%; F1 98.06% | CSS-pixel mask overlap across seven labelled sensitive/raster regions. All 121,769 redacted pixels fell inside expected regions. |
| Client resource utilization | 20% | Loaded model/runtime 14.76 MiB; cooled whole-Chrome CPU upper bound 1.06% of one core | Static byte count for the exact model/JS/MJS/WASM files loaded. Chrome CPU uses matching process CPU-time deltas over a three-second post-cooldown sample. Whole-Chrome working set was 867.09 MiB, which is deliberately reported only as a loose upper bound and is not extension attribution. |
| End-to-end latency | 15% | 30 ms inference; 95 ms local sanitization; 12 ms sanitized server round trip; 2,120 ms production observe→execute | Timed inside the local vision worker, Node audit, and real extension task lifecycle. |

## Privacy and action assertions

- The raw capture stayed in extension memory and was not returned to Node, written to disk, or placed in the server request.
- The server accepted the valid hash-bound sanitized JPEG and rejected a deliberately modified JPEG with HTTP 422.
- Two faces were detected locally; maximum confidence was 0.9996.
- The server returned a structured `scroll` action and the extension moved the real Incognito page to `scrollY = 112.8`.
- The model/runtime was reduced from the JSEP build to the smaller pinned WASM-only runtime; packaged loaded footprint is 14.76 MiB.

## Interpretation

The three accuracy-related areas produce a synthetic-fixture subtotal of 65/65 weighted points. No official total is calculated because the problem statement supplies weights but no normalization thresholds for resource use or latency, and a single fixture cannot establish generalization.

Before an SIH claim, expand this into a held-out dataset covering varied sites, fonts, zoom levels, dark mode, partial visibility, Indian PII formats, faces of different sizes/skin tones, negative examples, OCR inside images, and adversarial layouts. Report macro/micro precision, recall and confidence intervals. Measure extension-attributed CPU/RAM with a controlled profiler on the actual judging hardware and run at least 30 cold and 30 warm end-to-end trials with p50/p95 latency.
