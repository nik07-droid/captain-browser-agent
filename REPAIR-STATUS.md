# CAPTAIN repair status — superseded

This is an older repair record. Current behavior and test commands are in README.md for version 0.3.0. The current controller is a tab bound to its Incognito window; normal launch no longer opens demo.html. The historical ten-test count below is not the current test count.

The current build implements a command planner, not general Jarvis intelligence. No trained local visual model has been installed. Earlier demo successes do not establish reliable operation on every website.

## Changes

- The page microphone opens a separate extension voice window tied to the source Incognito tab. Keep that window open and click Speak. Navigation of the source tab no longer destroys its voice listener.
- Microphone errors stay visible instead of being overwritten by agent polling. Recognition depends on browser support and may use an online speech service; local-only speech is not implemented.
- The action loop rejects non-Incognito tabs before reading them and uses the initiating tab rather than whichever window is focused.
- Open-site commands finish without being typed into a search box. Search selects an editable control. Media completion requires observed playback state.
- Screenshot uploads are disabled because existing boxes do not cover all sensitive pixels. Text detection is heuristic and is not a guarantee of complete PII removal.

## Verification

10 Node tests passed, including playback state, search-control selection, site-opening completion, and refusal to observe normal tabs. Speech/audio and live YouTube playback have not been verified in this repair. Reload the unpacked extension or restart with START-CAPTAIN.cmd to use the new client files; restart the local Node server to use the new planner.
