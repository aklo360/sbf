#!/usr/bin/env node
// Veo 3.1 image-to-video (first frame, optional last frame) through the Gemini API.
// Submits predictLongRunning, polls the operation, downloads the mp4, and writes
// <out-dir>/<id>-submit.json (no image bytes), <id>-operation.json, <id>.mp4, <id>.receipt.json.
//
// Usage: node scripts/gen-veo-video.mjs --id C-v002 --first <png> [--last <png>] --prompt-file <txt>
//        --out-dir <dir> [--duration 4|6|8] [--resolution 720p|1080p] [--aspect 16:9]
//        [--model veo-3.1-generate-preview|veo-3.1-fast-generate-preview] [--negative "<text>"] [--no-audio]
// Env: GEMINI_API_KEY. Verified price 2026-09-21: standard $0.40/s (720p, 1080p), fast $0.10/s (720p), audio included.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const id = arg('--id');
const first = arg('--first');
const last = arg('--last');
const promptFile = arg('--prompt-file');
const outDir = arg('--out-dir');
const duration = Number(arg('--duration', '4'));
const resolution = arg('--resolution', '720p');
const aspect = arg('--aspect', '16:9');
const model = arg('--model', 'veo-3.1-generate-preview');
const negative = arg('--negative');
const audio = !argv.includes('--no-audio');
if (!id || !first || !promptFile || !outDir) throw new Error('Need --id, --first, --prompt-file, --out-dir');
if (![4, 6, 8].includes(duration)) throw new Error('--duration must be 4, 6 or 8');
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('GEMINI_API_KEY not set');

const local = (p) => {
  const abs = path.resolve(root, p);
  if (!abs.startsWith(root + path.sep)) throw new Error(`Path escapes the project: ${p}`);
  return abs;
};
const out = local(outDir);
fs.mkdirSync(out, { recursive: true });
const video = path.join(out, `${id}.mp4`);
if (fs.existsSync(video)) throw new Error(`Output exists: ${video}`);

const frame = (file) => {
  const abs = local(file);
  return { bytesBase64Encoded: fs.readFileSync(abs).toString('base64'), mimeType: /\.png$/i.test(abs) ? 'image/png' : 'image/jpeg' };
};
const prompt = fs.readFileSync(local(promptFile), 'utf8').trim();
const instance = { prompt, image: frame(first) };
if (last) instance.lastFrame = frame(last);
// Veo 3.1 always generates audio; the API rejects an explicit generateAudio parameter.
const parameters = { aspectRatio: aspect, resolution, durationSeconds: duration };
if (negative) parameters.negativePrompt = negative;
fs.writeFileSync(path.join(out, `${id}-submit.json`), `${JSON.stringify({ model, prompt, first, last: last ?? null, parameters }, null, 2)}\n`);

const headers = { 'x-goog-api-key': key, 'Content-Type': 'application/json' };
const started = performance.now();
const submit = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ instances: [instance], parameters }),
});
const submitText = await submit.text();
if (!submit.ok) throw new Error(`${id}: submit ${submit.status}: ${submitText.slice(0, 600)}`);
const { name } = JSON.parse(submitText);
if (!name) throw new Error(`${id}: no operation name: ${submitText.slice(0, 300)}`);
console.log(`${id}: operation ${name}`);

let operation = null;
const deadline = Date.now() + 20 * 60 * 1000;
for (;;) {
  if (Date.now() > deadline) throw new Error(`${id}: timed out after 20 minutes`);
  await new Promise((r) => setTimeout(r, 8000));
  const poll = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, { headers: { 'x-goog-api-key': key } });
  const text = await poll.text();
  if (!poll.ok) throw new Error(`${id}: poll ${poll.status}: ${text.slice(0, 400)}`);
  operation = JSON.parse(text);
  if (operation.error) throw new Error(`${id}: operation error: ${JSON.stringify(operation.error).slice(0, 600)}`);
  if (operation.done) break;
}
fs.writeFileSync(path.join(out, `${id}-operation.json`), `${JSON.stringify(operation, null, 2)}\n`);
const response = operation.response ?? {};
const sample = response.generateVideoResponse?.generatedSamples?.[0] ?? response.generatedVideos?.[0] ?? response.generatedSamples?.[0];
const uri = sample?.video?.uri;
if (!uri) throw new Error(`${id}: no video uri in operation: ${JSON.stringify(response).slice(0, 600)}`);
const download = await fetch(uri, { headers: { 'x-goog-api-key': key }, redirect: 'follow' });
if (!download.ok) throw new Error(`${id}: download ${download.status}`);
const bytes = Buffer.from(await download.arrayBuffer());
fs.writeFileSync(video, bytes, { flag: 'wx' });

const receipt = {
  id,
  model,
  first,
  last: last ?? null,
  prompt_file: promptFile,
  duration_seconds: duration,
  resolution,
  aspect_ratio: aspect,
  generate_audio: audio,
  negative_prompt: negative ?? null,
  operation: name,
  rai_filtered: response.generateVideoResponse?.raiMediaFilteredCount ?? null,
  bytes: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  price_usd_estimate: +(duration * (resolution === '4k' ? (model.includes('fast') ? 0.3 : 0.6) : model.includes('fast') ? (resolution === '1080p' ? 0.12 : 0.1) : model.includes('lite') ? (resolution === '1080p' ? 0.08 : 0.05) : 0.4)).toFixed(2),
  elapsed_seconds: +((performance.now() - started) / 1000).toFixed(1),
};
fs.writeFileSync(path.join(out, `${id}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ id, file: path.relative(root, video), elapsed_seconds: receipt.elapsed_seconds, price_usd_estimate: receipt.price_usd_estimate }));
