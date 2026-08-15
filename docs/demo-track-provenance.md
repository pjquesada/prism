# Demo Track provenance

## Asset

- Path: `apps/web/public/audio/demo-track.wav`
- Generator: `scripts/generate-demo-track.mjs`
- Format: 16-bit PCM WAV, mono, 44.1 kHz, 16 seconds
- Tempo intent: ~96 BPM synthetic loop

## License / originality

This Demo Track is an **original, programmatically generated** waveform created for Prism. It does **not** include third-party samples, commercial loops, or copyrighted music.

Reuse is covered by the repository MIT license. Treat the audio as original project material with no external attribution obligations.

## Regeneration

```bash
node scripts/generate-demo-track.mjs
```

The script is deterministic for a given source version.
