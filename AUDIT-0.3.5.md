# CAPTAIN 0.3.5 — website discovery and repair audit

## Delivered

CAPTAIN is no longer limited to its 18 destination shortcuts. An unfamiliar plain website name triggers a live Google search, reads locally filtered organic headings and destination addresses, and selects a unique strong title/domain match. Ambiguous and unmatched names ask for an exact address. Explicit HTTP(S) addresses remain supported.

The discovery selector does not use a per-site catalogue entry or model-generated URL. It uses observed page references, rejects known advertising containers and unsafe/PII-bearing candidates, and validates the selected address again before navigating. This is a bounded lexical heuristic, not an identity/security guarantee. Some brand/domain combinations and search-engine challenges require user help.

Opaque Google /goto and /url links initially caused live discovery failures. The repaired extractor uses the complete HTTPS origin displayed in the organic result citation. Both wrapper identity and displayed origin are rechecked before navigation. Original opaque tokens and query strings are not sent as discovery context.

## Final evidence

- **150/150 code tests passed** on 0.3.5.
- `runtime/discovery-audit.json`: **passed=true**, 0.3.5 loaded in both extension and server. Python, Blender, freeCodeCamp and Spotify opened in working tab1798604575, Incognito window1798604573, controller1798604574.
- Python, Blender and freeCodeCamp were explicitly asserted absent from server/sites.mjs; each used a search → observed candidate → verified destination sequence.
- Actual final document URLs: https://www.python.org/, https://www.blender.org/, https://www.freecodecamp.org/, https://open.spotify.com/.
- No extra tab, demo page or private window was created during the command sequence.
- `runtime/website-audit.json`: earlier 0.3.4 **10/10 public-site/routing checks passed**, including search Spotify from YouTube, Netflix, WhatsApp, Stack Overflow, explicit YouTube/Google searches and the then-current unknown-name search-results fallback.
- `runtime/panel-audit.json`: earlier 0.3.4 live pointer dragging, clamping, minimize/expand/reset, in-place reload with synthetic unsent draft preservation, Enter/RUN navigation and existing-controller microphone shortcut passed.

The old extra bare controller created by the startup race was removed after revalidating its identity; no website tabs were closed. When the dedicated browser was subsequently closed, the repaired launcher successfully started a fresh single private session without the earlier empty-URL error.

## Runtime deployment

The launcher previously accepted any healthy local server, leaving old planner code running. It now compares a startup-captured source fingerprint. Updating restarts only the verified project-owned loopback Node process. Unknown processes and active server requests are refused. The final server fingerprint in the discovery report is 5f1301dd61a23b4555a27d3df2785d457eb153b41921f8e71792fc5ae9c3c750.

## Limits

Live browser tests used typed commands through the real controller. They do **not** certify microphone acoustics, wake-word accuracy, audible replies or subscription playback. Voice recognition still uses the browser's potentially online service. Screenshots remain withheld; complete local visual PII protection is not implemented. Website discovery does not bypass logins, CAPTCHAs, subscriptions or authorize account actions.

Prior failures remain under runtime/discovery-audit-opaque-link-failure.json and runtime/discovery-audit-existing-results-check-failure.json. The latter recorded Python opening successfully but a test assumption incorrectly requiring a new search navigation despite starting on matching search results. The final repeated audit started from Spotify and passed all four checks.

## Use

Run START-CAPTAIN.cmd or `npm run demo`. Click Speak in the controller, then say **Hey Captain, open [website name]**. The voice controller must stay open. Ask **search Spotify on Google** for Google results rather than opening Spotify. If discovery asks for an address, speak the exact domain (for example, example dot com).
