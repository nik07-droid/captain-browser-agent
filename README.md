# CAPTAIN 0.5.0 — privacy-preserving browser agent prototype

CAPTAIN combines an Incognito Chrome extension, local DOM perception, a bundled ONNX face model, fail-closed visual redaction, a local Node control service and an optional Ollama/remote planner. It is a development project, **not an Alexa-equivalent production assistant or a completed SIH submission**. Unit-test success is not proof of live microphone or arbitrary-website reliability.

## Start

Run START-CAPTAIN.cmd, or use these commands in the project folder:

```powershell
npm run demo
```

This starts the service and loads the extension in a dedicated Incognito Chrome profile. **Normal startup does not open the demo page.** The controller belongs to the Incognito window, not to a fragile original tab ID. A website tab is created when a command needs one, then reused. If you close that working tab, the next command creates a replacement in the same window, without taking over another unrelated tab.

Starting again reuses the controller and window. `npm run reload` is for development: it reloads code, preserves the website target, and briefly replaces only the controller document during the update. Enable the microphone again after a reload. The old `demo.html` fixture still exists for explicit tests, but is not the assistant's startup page.

Normal startup now verifies the **running server's source fingerprint** as well as the extension build. Changed planner code is loaded by restarting only the exact project-owned Node server on loopback. A foreign process or an active server request is not terminated. When editing server code, run `npm run demo` (not only extension reload) to install the update.

## Floating page controls

Drag the **CAPTAIN header** anywhere inside the webpage. Use **− / +** to minimize or expand, or **⌖** to reset to the bottom-right. Keyboard users can focus the header and use arrow keys (Shift for larger moves) or Home to reset. Position is remembered across websites; only normalized geometry and the minimized setting are saved, not commands or page contents. The panel stays within the page viewport; it is not a desktop-wide always-on-top window.

**RUN** or Enter sends a typed command from that webpage. The **🎙** shortcut opens the existing voice controller in the same Incognito window; it does not silently activate the microphone. Click **Speak** in the controller once and keep that tab open while using other website tabs.

Launching again and development reloads reconnect eligible existing website panels without refreshing their pages. If Chrome has invalidated an old panel, it stops sending commands and shows recovery instructions instead of a raw context error. Use START-CAPTAIN.cmd to reconnect. The explicit **Reload page** fallback can discard unsaved forms, so save them first. Restricted Chrome pages and pages without extension access cannot host the panel.

## Voice interaction

1. In the controller tab, click **Speak** and allow microphone access.
2. Say **“Hey Captain”**, wait for “Yes, sir. What should I do?”, then give one command.
3. Alternatively say **“Hey Captain, open YouTube”** in one utterance. Older activation phrases remain accepted for compatibility.
4. CAPTAIN acknowledges acceptance, executes, reports the result, then sleeps.
5. Missing details prompt a question: “open” → “Which website?” → “YouTube”. The response window is 20 seconds; otherwise CAPTAIN sleeps.

Say “cancel” during a task, or press **Cancel task**, to prevent subsequent actions. Already-sent actions cannot be undone. **Mic off** stops microphone access entirely. Wake-up cannot work with the microphone off, Chrome closed, or the controller closed.

The red waves react to measured microphone amplitude when awake. Typed commands, browser speech transcripts, and configured edge-ASR transcripts use the same browser-action path.

Try the requested combined command: **“hey open YouTube and then play the song Ae Ajnabee by Aditya Rikhari.”** After completion, wake again with **“hey open Gmail”** or **“hey open Wikipedia.”** No separate demo or fresh browser window is needed. Gmail can require you to sign in yourself; CAPTAIN does not enter credentials or claim the inbox is open while logged out.

## Bounded command paths

- Open websites by an explicit address, including spoken **“example dot com”**, or by name using live web discovery. The 18 shortcuts (including Spotify) are a fast path, **not the limit of supported destinations**. Unknown names are searched on Google, then CAPTAIN reads organic result headings and addresses and opens a unique strong title-and-domain match. This is a lexical matching heuristic, not a proof that a website is official or safe. Competing or weak matches require you to specify an address; CAPTAIN never invents a domain. Invalid addresses and credential-bearing URLs are rejected.
- **“Search Spotify”** or **“find Spotify website”** opens the known site. **“Search Spotify on YouTube”** searches YouTube; **“search Spotify on Google”** or **“search the web for Spotify”** searches Google. **“Search Spotify premium price”** remains a query, not a website shortcut. Add **“on this page”** to explicitly use the current website's search.
- Search the current page/YouTube; web search if no search field is available.
- Say **“search for privacy browsers and open the first result”**, or search first and then say **“open the first result.”** CAPTAIN opens only a freshly observed organic HTTPS result, rejects credentials/tracking metadata/PII, and verifies the destination host. Opening the first result is explicit; CAPTAIN does not treat search ranking as proof that a site is trustworthy.
- Request a named song/video using “play”, “listen to” or “put on”; pause, resume, scroll, and go back.
- Add “in a new tab” to create a website tab in the same Incognito window. Follow-up commands target that tab.
- Unmatched requests use the configured model; arbitrary tasks are not guaranteed. Model-only completion is marked **Review required**, not independently verified success.

Playback success requires the primary player, matching requested title, no detected ad, and an advancing clock with stable source/page identity. A paused requested player can be resumed at most twice during verification; persistent buffering stops with an error. Buffering and blocked autoplay are not successful playback. Title matching is not acoustic singer identification: a compilation mentioning the singer may match. It can also reject translated titles, spelling errors or incomplete metadata.

## Privacy and implementation limits

- DOM text is locally filtered for common email, phone, Indian identifier, address and sensitive-field patterns. Regex and DOM semantics can still miss PII.
- When visual context is enabled, Chrome captures the active working tab and sends the raw image only to a dedicated extension worker. The worker runs the bundled UltraFace ONNX model with ONNX Runtime Web/WASM, pixelates detected faces, blacks out DOM PII/secret boxes, and conservatively blacks out image, canvas, video, iframe and CSS-background regions that the DOM text filter cannot inspect. Only the resulting JPEG and a hash-bound `captain.visual-privacy.v1` proof can cross the server boundary. Missing, malformed or tampered proofs are rejected with HTTP 422.
- The conservative raster blackout prevents uninspected image text from leaking, but also removes useful visual context. Local OCR and a page-UI semantic vision model are not implemented. UltraFace detects faces; DOM extraction provides current UI semantics. The active backend is WASM for Chrome/Firefox compatibility, not WebGPU.
- The server can attach the sanitized JPEG to a configured VLM. The local default is the open `qwen3-vl:2b` Ollama model with `CAPTAIN_OLLAMA_VISION=true`; `npm run test:vlm` verifies a sanitized-image plan and writes `runtime/vlm-audit.json`. Set `CAPTAIN_VLM_BASE_URL`, `CAPTAIN_VLM_API_KEY`, and `CAPTAIN_VLM_MODEL` for an OpenAI-compatible alternative. A passing smoke test does not guarantee arbitrary-site reasoning.
- The default browser speech mode may use Chrome's online service, including while awaiting the wake phrase. It is **not** the TinyML mode.
- `kws/` now contains an open-source custom **Hey Captain** TinyML pipeline: local recording, from-scratch training, full-int8 export, an allocation-free MCU wake gate with 300 ms pre-roll, binary post-wake PCM streaming, a faster-whisper ASR server, and an optional transcript bridge back to the controller. It contains no trained model yet because genuine keyword/negative/background recordings have not been collected.
- Ollama reasoning is local in the supplied configuration (`qwen3-vl:2b`). Its general reasoning remains bounded by strict action validation and is not guaranteed.
- Incognito is not a security guarantee. Do not use the prototype for banking, payments or sensitive production accounts.
- UI-TARS source is preserved under vendor/ui-tars as a reference. Its agent runtime is **not integrated** into the active execution path.

The TinyML code is not yet a physically validated wake device. A trained artifact, ESP32/Raspberry Pi integration, board linker/tensor-arena measurements, acoustic evaluation, and measured wake-to-server latency are still required. OCR-based visual PII recognition, a formal labelled privacy dataset, a browser UI vision benchmark and fully local TTS also remain incomplete.

## Verify and diagnose

```powershell
npm run check
npm run typecheck
npm run build
npm run benchmark
npm run test:visual-privacy
npm run test:shopping
npm run test:amazon
npm run test:acceptance
npm run test:handoff
npm run test:privacy-attack
npm run test:firefox
npm run kws:check
npm run diagnose
node scripts/audit-panel.mjs
npm run test:websites
node scripts/audit-websites.mjs --discovery
npm run test:playback
node scripts/audit-session.mjs
node scripts/audit-request.mjs
```

`npm run test:visual-privacy` opens the local labelled fixture in the existing Incognito working tab, performs a real Chrome capture, runs the packaged face model and redactor, proves detected PII is absent, submits only the sanitized image, rejects a tampered image, and runs the production observe → plan → execute loop. It writes `runtime/visual-privacy-audit.json` plus a sanitized-only preview. Raw screenshots are neither returned to Node nor written to disk.

`npm run test:shopping` executes the complete randomized judge-store workflow and verifies the selected product and price. `npm run benchmark` then runs 23 labeled screens through the installed extension and writes `runtime/benchmark-results.json`. The dashboard at `http://127.0.0.1:4317/` reads that file plus current real-site and handoff reports; it contains no hardcoded score. These results are synthetic benchmark evidence, not general-web accuracy.

`npm run test:amazon` is the separate real-site acceptance gate. It starts from `about:blank` in the bound Incognito working tab, opens Amazon India, searches through Amazon's observed search field, applies an observed price-band control, compares visible `/dp/` product cards, opens one observed ASIN, and requires that same ASIN in the final product URL before completion. The audit is read-only: sign-in, cart, checkout, ordering and purchase actions are rejected. It also requires a locally sanitized visual state and zero recognized PII patterns in the final sanitized DOM/history payload. Its timestamped evidence is `runtime/amazon-audit.json`. Amazon inventory, prices, layout, challenges and availability can change, so a prior pass is not a guarantee of a future run.

`npm run benchmark:amazon-latency` repeats that exact live Amazon acceptance flow five times and writes `runtime/amazon-latency-benchmark.json`. The dashboard separates CAPTAIN-controlled processing from external browser/Amazon navigation and shows median and P95. See `docs/LATENCY-AUDIT.md` for the measured before/after profile and limitations.

The audit report maps directly to the supplied 25/20/20/20/15 SIH areas. See [measured evaluation](docs/SIH-EVALUATION-FINAL.md) and the [compliance matrix](docs/SIH-COMPLIANCE.md). They record labelled visual-context and PII precision/recall/F1, pixel-mask redaction results, exact loaded model/runtime bytes, a cooled aggregate Chrome CPU sample, and local/server/production-loop latency. No overall score is invented where the supplied statement provides no resource or latency normalization thresholds.

The broader [real-world acceptance report](docs/REAL-WORLD-ACCEPTANCE.md) records the latest seven-site catalog as 5 verified, 1 CAPTCHA-blocked and 1 failed. `npm run test:privacy-attack` exercises known PII, credential-action and screenshot-proof attacks. `npm run test:handoff` proves challenge pause/resume on a controlled fixture. `npm run test:firefox` is a static packaging audit only, not a live Firefox claim.

The playback test sends public YouTube commands through the real extension, checks the singer, playback clock and same-window/tab invariants, and records runtime/playback-audit.json. A failed browser test remains a failure even when unit tests pass. This does not test microphone acoustics or audible speaker output.

The panel audit uses actual Chrome pointer events for dragging, clamping, minimizing and resetting; verifies document and synthetic unsent-draft preservation through an extension reload; then tests Enter, RUN and the voice shortcut on public pages in the same tab/window. Its output is runtime/panel-audit.json. It deliberately leaves the microphone off and does not prove real speech recognition.

The website audit sends typed commands through the real controller and checks document URL/title, build versions, same tab/window, explicit search scope, and honest unknown-name fallback. It opens public Spotify, YouTube, Netflix, WhatsApp and Stack Overflow pages. It does not sign in or test subscription music playback. The report is runtime/website-audit.json; check passed rather than assuming a run succeeded.

The discovery variant tests Python, Blender and freeCodeCamp, asserts they are **absent from the shortcut catalogue**, and requires a real web-search → observed-result click → matching destination sequence. Its report is runtime/discovery-audit.json. Discovered links are rechecked against the expected host before navigation; completion requires seeing the chosen destination afterward. Only the current visible organic results are considered, with bounded waiting/scrolling when no match is visible.

When Google wraps links in opaque redirects, CAPTAIN can use a complete visible HTTPS address in the organic result's citation. It opens that displayed origin after checking the citation and original wrapper have not changed. It does not decode opaque tokens or claim the displayed address proves the website's identity.

Discovery is not universal: search-engine challenges, missing results, nonmatching brand/domain names, unfamiliar domain suffix structures and ambiguous brands may need your help. A login page is not a logged-in account. Finding a site does not grant general task execution or bypass authentication, subscriptions or CAPTCHAs.

The session audit navigates the bound test tab to about:blank, exercises clarification, adds one website tab on explicit request, and verifies subsequent commands stay there. It leaves that extra tab open and writes runtime/session-audit.json. Run these audits only in the dedicated test session with the microphone off.

The request audit tests the exact Ae Ajnabee compound command, pause, Gmail, Wikipedia, a spoken domain, explicit new-tab creation, closing only its own extra test tab, recovery, and two repeated launches. It records runtime/request-audit.json and checks that no demo tab or extra window is created. A passing report does not validate real microphone transcription.

The launcher uses Chrome's localhost:9223 development debugging endpoint; this is not a store-ready installer. Firefox packaging is unvalidated. Do not distribute its ZIP as a tested build.

## Build boundaries and container

Strict shared contracts now live under `packages/shared`, `vision`, `privacy`, `actions`, and `evaluation`; app entry boundaries live under `apps/`. The proven JavaScript runtime remains in `extension/` and `server/` while migration proceeds incrementally. `npm run typecheck`, `npm run build`, and `npm run lint` validate these boundaries.

`docker compose up --build` packages the local control service and dashboard only. It does not package Chrome, microphone access, Ollama, or the extension, so the complete browser demo still uses `npm run demo`. Docker was not available on the development machine for a live container build and this is documented rather than claimed as verified.

## Custom TinyML wake word

Read [kws/README.md](kws/README.md) for dataset capture, training, MCU integration, ASR streaming and strict submission gates. The custom keyword is **Hey Captain**. Training rejects fewer than 100 genuine positive and 100 hard-negative clips, exports only full-int8 inference, and rejects a model over 32 KB. The device/browser relay is optional and configured under extension Settings with a WSS URL, client ID and locally stored shared token.

`python kws/verify_budget.py` fails when physical evidence is missing. It requires measured peak total RAM below 256 KB, idle CPU below 10%, true-positive rate of at least 95%, no more than 0.1 false activations/hour, and p95 keyword-end → first-audio arrival no higher than 250 ms. These are project acceptance targets, not achieved benchmark claims.

## Design references

- [Alexa intent and dialogue model](https://developer.amazon.com/en-US/docs/alexa/custom-skills/create-the-interaction-model-for-your-skill.html)
- [Alexa request/response sessions](https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-and-response-json-reference.html)
- [Chrome hidden-tab playback behavior](https://developer.chrome.com/blog/play-returns-promise)
- [TensorFlow Lite Micro micro_speech](https://github.com/tensorflow/tflite-micro/tree/main/tensorflow/lite/micro/examples/micro_speech)
- Curated website destinations checked on 2026-09-15: [Spotify web player](https://open.spotify.com/), [Netflix](https://www.netflix.com/in/), [WhatsApp Web](https://web.whatsapp.com/), [Reddit](https://www.reddit.com/), [Instagram](https://www.instagram.com/), [Facebook](https://www.facebook.com/), [Bing](https://www.bing.com/), [DuckDuckGo](https://duckduckgo.com/), [Stack Overflow](https://stackoverflow.com/).

CAPTAIN borrows interaction patterns, not Amazon's service or proprietary implementation.

## Release gates

Require 20 consecutive core demo passes, real-microphone wake/noise tests, closed-tab/worker/offline recovery, a broader labeled real-site dataset, Firefox live validation, and measured CPU/RAM on target hardware. The current 23-screen suite is a synthetic benchmark and must not be generalized to arbitrary websites. Verify user-supplied SIH metric weights against the official statement before submission. No official SIH score is claimed.

New CAPTAIN source is marked Apache-2.0. Preserve upstream license notices in vendor/ui-tars.
