# Provider adapter boundaries (Capture Music)

Prism’s Capture Music path analyzes **local** browser/system or microphone audio on the controller. It does **not** implement Spotify, Apple Music, SoundCloud, Pandora, or YouTube OAuth in Phase 1E.

Future `packages/provider-adapters` integrations may supply:

- Authentication / account linking
- Playback control (play, pause, skip, seek)
- Track metadata (title, artist, album)
- Artwork URLs
- Playback position and transport state
- Provider capability flags

Those APIs must **not** be assumed to provide PCM samples, FFT bins, or capturable audio streams. Visualization reactivity for copyrighted catalog playback continues to rely on controller-local Capture Music (or Demo Track), never on streaming or relaying protected media through Prism.
