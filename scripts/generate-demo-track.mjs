#!/usr/bin/env node
/**
 * Deterministic royalty-free Demo Track generator for Prism Phase 1B.
 * Original synthetic PCM — no third-party samples.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "../apps/web/public/audio/demo-track.wav");

const SAMPLE_RATE = 44100;
const DURATION_SEC = 16;
const BPM = 96;
const BEAT_SEC = 60 / BPM;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function envelope(t, attack, release, hold) {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  if (t < hold) return 1;
  const rel = (t - hold) / release;
  return rel >= 1 ? 0 : 1 - rel;
}

/** @param {number} t */
function sampleAt(t) {
  const beat = Math.floor(t / BEAT_SEC);
  const beatPos = t - beat * BEAT_SEC;
  const bar = Math.floor(beat / 4);
  const beatInBar = beat % 4;

  // Kick on beats 0/2, soft on 1/3
  const kickAmp = beatInBar % 2 === 0 ? 0.55 : 0.18;
  const kick =
    Math.sin(2 * Math.PI * (78 - beatPos * 90) * beatPos) *
    envelope(beatPos, 0.004, 0.18, 0.02) *
    kickAmp;

  // Soft hat every half-beat
  const hatPhase = t % (BEAT_SEC / 2);
  const noise = (Math.sin(t * 17471.3) * 43758.5453) % 1;
  const hat = (noise * 2 - 1) * envelope(hatPhase, 0.001, 0.05, 0.005) * 0.08;

  // Mid pulse (square-ish) every bar
  const midFreq = 220 * (1 + (bar % 3) * 0.12);
  const mid =
    Math.sign(Math.sin(2 * Math.PI * midFreq * t)) *
    envelope(beatPos, 0.01, 0.35, 0.08) *
    (beatInBar === 0 || beatInBar === 2 ? 0.12 : 0.04);

  // High shimmer
  const shimmer = Math.sin(2 * Math.PI * 1320 * t) * Math.sin(2 * Math.PI * 0.5 * t) * 0.04;

  // Sustained low pad
  const pad = Math.sin(2 * Math.PI * 55 * t) * 0.1 + Math.sin(2 * Math.PI * 82.5 * t) * 0.05;

  return clamp(kick + hat + mid + shimmer + pad, -1, 1);
}

function encodeWav(samples, sampleRate) {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = clamp(Math.floor(samples[i] * 32767), -32768, 32767);
    view.setInt16(offset, s, true);
    offset += 2;
  }
  return Buffer.from(buffer);
}

const total = Math.floor(SAMPLE_RATE * DURATION_SEC);
const samples = new Float32Array(total);
for (let i = 0; i < total; i += 1) {
  samples[i] = sampleAt(i / SAMPLE_RATE);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, encodeWav(samples, SAMPLE_RATE));
console.log(`Wrote ${outPath} (${DURATION_SEC}s @ ${SAMPLE_RATE} Hz, ~${BPM} BPM)`);
