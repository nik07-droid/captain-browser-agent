# CAPTAIN floating-panel and voice repair — 2026-09-15

## Implemented

- Movable page overlay: pointer capture, viewport clamping, keyboard movement, minimize/expand, reset position, and normalized geometry-only persistence.
- Invalidated panels stop sending and polling, show recovery instructions, and provide an explicit page-reload fallback with an unsaved-form warning.
- Extension launch/reload reconnects existing eligible Incognito website panels in the same window without refreshing the website. Idempotent script lifecycle prevents duplicate current panels and timers.
- First launch waits for a committed controller document and obtains URLs from the live extension runtime instead of transient CDP metadata.
- Voice entry recognizes bare and initialized controller URLs and reuses a controller in the same private window, without automatically enabling the mic.
- Voice restart/session races, startup locking, resource cleanup, error persistence, and task locking during microphone failure are repaired. Online speech disclosure is persistent.

## Evidence and remaining verification

`npm run check`: 102 tests passed after integration. Includes 9 panel tests, 10 voice tests, launcher/reconnection tests and 21 session tests. These are automated code tests, not acoustic voice tests.

The new page panel rendered in the actual dedicated Chrome session; a panel-only screenshot is saved at runtime/panel-preview.png (intermediate build 0.3.2). That screenshot proves rendering, not drag or speech accuracy.

The initial live launch exposed the empty-URL startup race; it was fixed with regression coverage. The final 0.3.3 build still needs an in-place reload and browser audit. Reload was held because the user's active controller had its microphone on; a request to turn Speak off was sent. Do not interpret this report as a successful live reload/drag audit or a successful exact-song test on the final build.

## Resume safely

1. Confirm Speak is off and no browser task is running (`npm run diagnose`).
2. Run `npm run reload` to install the final code. This resets microphone permission/session UI, not website documents.
3. Run `npm run test:panel`, then the requested public-site test with `npm run test:request`.
4. Check runtime/panel-audit.json and runtime/request-audit.json for passed=true; retain failures as failures.

The live intermediate startup left a bare controller popup.html and a window-bound controller popup.html?window=1798604515. The bare controller was the launcher's own bootstrap tab (1798604516); the working controller was1798604517, and working YouTube tab1798604518. Revalidate IDs and URLs before touching any tab. Do not close user website tabs. The duplicate-creation bug is fixed in code; existing stale UI is not assumed cleaned up.

Full arbitrary website automation, reliable acoustic wake-word recognition, local speech recognition and comprehensive visual privacy protection are not claimed.
