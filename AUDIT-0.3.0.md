# CAPTAIN 0.3.0 — requested-command repair

## What changed

The controller now belongs to its actual Incognito window instead of depending on an original tab that may have been closed. If the working tab is missing, the next command creates one replacement in that same window and saves the new binding. It does not silently take over another website tab. If a tab closes during an active task, the task can still stop; an uncertain action is not replayed.

Normal launch and developer reload no longer navigate to `demo.html`. Repeated launches reuse the controller and window. Reload temporarily blanks only the controller document, waits for navigation to commit, reloads the extension, then restores the controller. The live check verified the controller and window IDs were preserved. Existing website tabs are not replaced. A missing content script is reconnected after reload rather than waiting indefinitely.

Voice activation accepts “wake up captain”, “Captain, …” and “hey open …” / “hey play …”. It still requires clicking Speak and allowing the microphone. The controller must remain open. Command acknowledgement, follow-up questions and sleep after completion use the existing voice state machine. Chrome speech recognition may use an online service; this is not a local wake-word implementation.

The exact combined request “hey open youtube and then play the song ae ajnabee by aditya rikhari” now follows the deterministic browser path. Matching excludes structural words such as “the song” and “by”, while requiring the song and artist words in the selected title. It does not hard-code a video ID. Unknown website names ask for an address instead of guessing a domain; explicit addresses and spoken “example dot com” work.

## Live test result

The latest complete request audit **passed** on 14 September 2026, 12:38:53–12:39:35 UTC. Commands were typed through the actual extension controller; they were not direct browser navigation shortcuts. The exact command string in every recorded completed state matched the submitted command.

| Request/check | Observed result |
| --- | --- |
| Exact YouTube + Ae Ajnabee command | Official requested video opened; title contained Ae Ajnabee and Aditya Rikhari; no detected ad; player clock advanced 5.05 → 7.36 seconds |
| Pause | Primary video paused |
| Hey open Gmail | Google sign-in page opened; CAPTAIN explicitly reported sign-in was required |
| Open Wikipedia | Wikipedia home opened in the same working tab |
| Open example dot com | `https://example.com/` opened in the same working tab |
| Open example.com in a new tab | Exactly one new working tab in the same Incognito window |
| Close the extra test tab, then hey open YouTube | One replacement tab created automatically; no stale-tab error; no unrelated tab reused |
| Launch CAPTAIN twice again | Same controller/window/target retained; no additional tabs or demo page |

Window ID remained `1798604452`; controller ID remained `1798604462`. Normal commands used target `1798604461`. The test-created extra tab `1798604463` was closed deliberately to test recovery; replacement target is `1798604464`. Other pre-existing tabs were left untouched. Closing the test tab is recoverable by reopening its public URL `https://example.com/`.

The requested video was [Ae Ajnabee — Aditya Rikhari, Ravator, Kutle Khan, Coke Studio Bharat](https://www.youtube.com/watch?v=ut1rfURWyCo). Playback evidence uses metadata, advertisement state and advancing media time, not acoustic singer identification or independent speaker-output measurement.

The Gmail fix handles the observed redirect to [Google's public Gmail page](https://workspace.google.com/intl/en-US/gmail/) and follows its observed official Sign in link. It never enters credentials, opens an authenticated inbox by itself, or sends email.

## Automated checks and failures retained

`npm run check`: **72 tests passed, zero failed**. Tests cover the requested command, exact song/artist word matching, site aliases/domains, Gmail redirects, window-bound recovery, normal-tab rejection, content reconnection, tab-strip-busy rejection, voice activation/state transitions, clarification and cancellation.

Earlier live attempts failed on a temporary Chrome tab-edit rejection, a stale content-script connection after reload, Gmail's public-site redirect, and a generic completion message after clicking Gmail sign-in. These were repaired and the complete sequence was rerun. Failed reports remain under the project's ignored `runtime` directory. This is not a claim of universal website reliability or 20 consecutive passes.

## Try it

Run `START-CAPTAIN.cmd` in `C:\Users\Mukul Singh\CodexProjects\captain-browser-agent`. In the CAPTAIN controller tab, click Speak and allow the microphone. Say:

> Hey open YouTube and then play the song Ae Ajnabee by Aditya Rikhari.

After the task completes, say “hey open Gmail” or “hey open Wikipedia”. For a name CAPTAIN does not know, provide its address when asked. The “You said” line is the transcript that reached the command system; send that text and the visible error if recognition differs from your words.

Real microphone transcription, room-noise behavior and audible replies have **not been validated with the user's voice**. Screenshots remain withheld; DOM PII filtering is heuristic. Local speech models, comprehensive visual privacy protection, unrestricted multi-step website intelligence and production packaging remain unfinished.
