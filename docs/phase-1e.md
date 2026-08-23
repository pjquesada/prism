# Phase 1E — Capture Music (input-capture stabilization)

## Goals delivered

- **Capture Music** primary mode using controller-only `getDisplayMedia()` tab/system audio analysis
- Microphone kept as an optional fallback (`LiveListenEngine` / `getUserMedia`)
- Demo Track unchanged for local royalty-free playback
- Captured audio is never connected to speakers (no echo / second playback path)
- Captured video tracks are discarded immediately and never rendered, encoded, transmitted, or persisted
- `MediaRecorder` is never used
- Compact `audio.features` envelopes (≤ 20 Hz) sync visualization levels to paired displays
- Displays stay silent and never call `getDisplayMedia` / `getUserMedia`
- Accurate Capture Music states (choose source, requesting permission, connected waiting/detected, no audio, sharing stopped, unsupported, denied, AudioContext suspended, runtime failure)
- Controller input-level meter
- Privacy copy: analysis stays on-device; only anonymous visualization levels are shared
- PWA cache bumped (`v2-capture-music`); waiting service worker shows **Update available — Reload** instead of silent `skipWaiting`
- Capture stops when controller credentials become invalid
- ADR updated; provider OAuth explicitly out of scope

## Why microphone-first failed for the real product loop

Room mics pick up speakers poorly (noise, echo cancellation artifacts, low SNR), require a permission users associate with calls, and do not match the intended workflow: music already playing in YouTube / Spotify Web / Apple Music Web / SoundCloud / Pandora on the controller PC.

## Why phones could still produce audio after the silence fix

Likely causes addressed here:

1. **Stale service-worker / PWA caches** serving older display bundles that still constructed `DemoTrackEngine`
2. Automatic `skipWaiting` + `clientsClaim` swapping bundles mid-session without a clear reload
3. Role-unresolved hydration windows needing a hard default of **no capture / no audio output**
4. Display routes must never own Demo Track or capture engines even if cookies are confusing

This stabilization bumps runtime cache names, disables silent SW takeover, and gates audio authority on an explicit resolved non-display role.

## Audio ownership

| Role            | Actual audio output         | Capture permission | Feature behavior     |
| --------------- | --------------------------- | ------------------ | -------------------- |
| Controller      | Original music source only  | Controller only    | Produces features    |
| Display         | Silent                      | Never              | Consumes features    |
| Combined        | Original local music source | Local device       | Produces and renders |
| Demo standalone | Demo Track locally          | Local device       | Produces and renders |

## Browser / OS compatibility (feature-detected)

| Environment              | Expectation                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| Chrome / Edge desktop    | Preferred — tab audio and often system audio                                |
| Tab audio                | Share the playing tab and enable Share tab audio                            |
| System audio             | Only when the browser/OS dialog offers it                                   |
| Firefox / Safari / mobile| Limited or unavailable audio capture — offer Microphone / Demo Track        |
| DRM / protected media    | May not expose capturable audio even when playback works                    |

Prism never claims guaranteed support for every streaming provider.

## Out of scope (confirmed)

- Provider OAuth (Spotify / Apple Music / SoundCloud / Pandora / YouTube)
- Manual Sync, Ambient, Dreamscape / AI, Android TV, Phase 1F
- Native desktop system-audio APIs beyond browser `getDisplayMedia`

## Manual checks

1. Chrome/Edge: play YouTube in another tab → Capture Music → share that tab with **Share tab audio** → display phone reacts silently
2. Spotify Web Player / Apple Music Web / SoundCloud / Pandora — same tab-audio flow (where the browser exposes audio)
3. Windows system audio where the dialog offers it
4. Deny / no-audio share → recovery copy; fallback to Microphone or Demo Track
5. Stop capture / leave page / end share → tracks stop; no auto-restart
6. Paired display never prompts for mic or screen share and never plays Demo Track
7. After deploy, old clients see **Update available — Reload** before the new SW takes over
