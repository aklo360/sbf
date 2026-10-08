#!/usr/bin/env node
// ElevenLabs sound effects through fal.ai (fal-ai/elevenlabs/sound-effects).
// Writes <out>.mp3 and <out>.receipt.json; refuses to overwrite.
//
// Usage: node scripts/gen-fal-sfx.mjs --text "<description>" --seconds <0.5-30> --out <path-without-extension> [--influence 0.3]
// Env: FAL_KEY. Verified price 2026-09-21: $0.002 per generated second.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const text = arg('--text');
const seconds = Number(arg('--seconds'));
const outStem = arg('--out');
const influence = Number(arg('--influence', '0.3'));
if (!text || !outStem || !(seconds >= 0.5 && seconds <= 30)) throw new Error('Need --text, --seconds (0.5-30) and --out');
if (!process.env.FAL_KEY) throw new Error('FAL_KEY not set');

const out = path.resolve(root, outStem);
if (!out.startsWith(root + path.sep)) throw new Error('Output must stay inside the project');
for (const ext of ['.mp3', '.receipt.json']) if (fs.existsSync(out + ext)) throw new Error(`Output exists: ${out}${ext}`);
fs.mkdirSync(path.dirname(out), { recursive: true });

// The unversioned fal-ai/elevenlabs/sound-effects endpoint pins a retired ElevenLabs
// model id upstream and fails with 400 (checked 2026-09-21); the /v2 endpoint works.
const endpoint = arg('--endpoint', 'fal-ai/elevenlabs/sound-effects/v2');
const input = { text, duration_seconds: seconds, prompt_influence: influence };
const started = performance.now();
const response = await fetch(`https://fal.run/${endpoint}`, {
  method: 'POST',
  headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
});
const bodyText = await response.text();
if (!response.ok) throw new Error(`fal ${response.status}: ${bodyText.slice(-500)}`);
const result = JSON.parse(bodyText);
const url = result?.audio?.url ?? result?.audio_file?.url;
if (!url) throw new Error(`No audio url in response: ${bodyText.slice(0, 400)}`);
const audio = Buffer.from(await (await fetch(url)).arrayBuffer());
fs.writeFileSync(`${out}.mp3`, audio, { flag: 'wx' });
const receipt = {
  endpoint,
  input,
  bytes: audio.length,
  sha256: crypto.createHash('sha256').update(audio).digest('hex'),
  price_usd_estimate: +(seconds * 0.002).toFixed(4),
  elapsed_seconds: +((performance.now() - started) / 1000).toFixed(1),
  response_keys: Object.keys(result),
};
fs.writeFileSync(`${out}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ file: path.relative(root, `${out}.mp3`), bytes: audio.length, elapsed_seconds: receipt.elapsed_seconds }));
