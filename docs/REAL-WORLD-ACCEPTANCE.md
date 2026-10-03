# CAPTAIN real-world acceptance

Latest catalog run: `runtime/acceptance-summary.json`, generated 2026-09-17. The runner uses the installed extension in one dedicated Incognito Chrome window, starts each definition from the bound working tab, forbids transactional actions, and records failure rather than converting a partial result into success.

| Website | Category | Outcome | Evidence |
|---|---|---|---|
| BBC | News | Verified | Correct host and final path; sanitized context; 2 steps |
| Flipkart | Ecommerce | Verified | Correct host and final path; sanitized context; 2 steps |
| India.gov.in | Government | Verified | Correct host and final path; sanitized context; 2 steps |
| HTTPBin form | Form | Verified navigation only | Form page opened; no form submission; sanitized context |
| Wikipedia | Content | Verified | Correct host and final path; sanitized context; 2 steps |
| Stack Overflow | Documentation | Blocked | Human-verification challenge detected; CAPTAIN paused instead of bypassing it |
| Amazon | Ecommerce | Failed | Search results were reached, but the required product final state was not verified |

Summary: **5 verified, 1 blocked, 1 failed**. This is the current catalog result, not a universal success rate.

Amazon had an earlier specialized timestamped pass: 10 steps, three visible laptops compared, price-band control observed, and the chosen ASIN verified in the final URL. A fresh specialized rerun on 2026-09-17 failed because the requested page did not finish loading within 45 seconds; `runtime/amazon-audit.json` now contains that current failure. The catalog also failed final-state verification. The earlier measured pass is summarized in the SIH evaluation document, but it is historical evidence—not current reliability.

## Human handoff

`runtime/handoff-audit.json` records a passing controlled challenge fixture. CAPTAIN refused to act while the challenge was present, resumed only after human completion, and completed the remaining task. It does not solve or bypass CAPTCHA. A live site may still change or reject automation after handoff.

## Reproduce

```powershell
npm run demo
npm run test:acceptance
npm run test:handoff
```

`test:acceptance` intentionally exits non-zero if any definition fails. A CAPTCHA is reported as `blocked`, not `completed`. The machine-readable per-site reports live in `runtime/results/`.

## Unverified boundaries

- Local pixel OCR is not configured. DOM text is available, and uninspectable raster content is conservatively blacked out.
- General page-object vision is not implemented. Current perception combines DOM semantics, geometry grouping and local UltraFace inference.
- Firefox has static packaging checks only; there is no live Firefox acceptance run on this machine.
- The browser-adapter package defines a migration boundary, but the proven extension runtime still calls Chrome APIs directly.
- No purchase, login, credential entry, form submission or CAPTCHA bypass is part of these acceptance tests.
