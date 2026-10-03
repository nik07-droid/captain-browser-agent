# CAPTAIN Amazon latency audit

Generated 2026-09-18. This audit covers the exact real-site task: **“Open Amazon and find the cheapest laptop under ₹50,000.”** It starts at `about:blank`, uses the bound Incognito working tab, and requires a final Amazon product identity/price verification. It does not use the local demo store.

## Result

The comparable instrumented run improved from **47,653 ms to 29,275 ms**, a **38.6% end-to-end reduction**. Estimated CAPTAIN-controlled time fell from **29,766 ms to 12,313 ms**, a **58.6% reduction**. The planner took 5 ms in the optimized run. This grounded Amazon workflow does not invoke a VLM, so VLM time was 0 ms.

The five-run live-site benchmark passed **5/5** with **0 recognized privacy leaks**:

| Measure | Mean | Median | P95 |
|---|---:|---:|---:|
| End-to-end | 42,956 ms | 44,054 ms | 56,169 ms |
| CAPTAIN-only estimate | 12,559 ms | 12,539 ms | 12,955 ms |
| External browser/Amazon navigation | 30,398 ms | 31,808 ms | 43,333 ms |

P95 uses nearest-rank over five runs and is therefore the maximum observed run. These are live-site measurements; Amazon inventory, redirects, response time, and the network can change.

## Profile before optimization

The baseline profile in `runtime/amazon-latency-baseline.json` measured:

| Component | Time |
|---|---:|
| External page navigation | 17,887 ms |
| Fixed page-stable waits | 16,546 ms |
| DOM observation | 1,215 ms |
| Screenshot capture | 2,163 ms |
| Local vision/redaction | 835 ms |
| Network and server | 265 ms |
| Payload sanitization | 81 ms |
| Planner | 29 ms |

The main CAPTAIN-controlled bottlenecks were fixed sleeps, duplicate full observations during navigation checks, and screenshot processing on a workflow whose decisions are completely grounded by Amazon’s semantic DOM cards. The model was not the bottleneck.

## Changes

- Replaced fixed Amazon waits with bounded readiness checks based on stable organic product ASIN and price signatures.
- Added a lightweight local-only `READINESS` probe so navigation and back-navigation do not trigger duplicate extraction/privacy/server work.
- Added an Amazon semantic-DOM fast path. It still performs the local PII scan and sanitizes every server payload, but withholds the screenshot entirely when the action is grounded by structured Amazon cards.
- Kept direct-product identity checks, final ASIN/title/price verification, read-only shopping safety, Incognito/same-window constraints, human challenge pause behavior, and sensitive-field protections unchanged.
- Added event timing for readiness, DOM/accessibility/Amazon extraction, privacy scan, screenshot, local redaction, payload creation, server boundary, planner, action execution, navigation, and settle time.

## Optimized representative run

The post-change profile in `runtime/amazon-latency-optimized.json` measured:

| Component | Time |
|---|---:|
| End-to-end | 29,275 ms |
| CAPTAIN-only estimate | 12,313 ms |
| External page navigation | 16,962 ms |
| DOM observation | 10,947 ms |
| Fixed page-stable waits | 1,000 ms |
| Network and server | 186 ms |
| Payload sanitization | 74 ms |
| Planner | 5 ms |
| Screenshot / local pixel redaction | 0 ms / 0 ms |

The DOM observation total includes the bounded stable-result readiness period at each Amazon result observation. Raw screenshots were not transmitted. The server continued to reject recognized unsanitized PII.

## Five real-site runs

| Run | Total | CAPTAIN-only | External navigation | Result | Leaks |
|---:|---:|---:|---:|---|---:|
| 1 | 30,913 ms | 12,539 ms | 18,374 ms | PASS | 0 |
| 2 | 33,858 ms | 12,217 ms | 21,641 ms | PASS | 0 |
| 3 | 44,054 ms | 12,246 ms | 31,808 ms | PASS | 0 |
| 4 | 49,788 ms | 12,955 ms | 36,833 ms | PASS | 0 |
| 5 | 56,169 ms | 12,836 ms | 43,333 ms | PASS | 0 |

Every run compared 27 observed candidates, finished on verified ASIN `B0D2Y31YX4` at the then-observed price of ₹15,990, stayed in the same Incognito window, performed no purchase/sign-in action, and reported zero recognized payload leaks.

## Evidence and reproduction

- `runtime/amazon-latency-baseline.json` — detailed pre-change event timeline.
- `runtime/amazon-latency-optimized.json` — detailed post-change event timeline.
- `runtime/amazon-latency-benchmark.json` — all five runs and aggregate statistics.
- `runtime/amazon-audit.json` — latest real-site acceptance evidence.

Run `npm run benchmark:amazon-latency` to repeat five trials. The evaluation dashboard reads these files through `/api/amazon-latency`; it does not hardcode the displayed measurements.

## Remaining latency

The five-run data shows CAPTAIN-controlled time is stable around 12.5 seconds while external navigation ranges from 18.4 to 43.3 seconds. Further claims of large end-to-end improvement require either fewer product-page navigations or better Amazon/network behavior. CAPTAIN deliberately preserves candidate identity verification rather than declaring a result from an unverified redirect.
