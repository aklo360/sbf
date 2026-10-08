#!/usr/bin/env node
// Image-to-video (first frame, optional last frame) through fal's queue API, no SDK.
// Default model: Seedance 2.0 standard. Uploads frames to fal storage, submits, polls,
// downloads, and writes <out-dir>/<id>-submit.json, -result.json, <id>.mp4, <id>.receipt.json.
//
// Usage: node scripts/gen-fal-video.mjs --id A-v001 --first <png> [--last <png>] --prompt-file <txt>
//        --out-dir <dir> [--duration 4] [--resolution 720p] [--aspect 16:9] [--seed n] [--no-audio]
//        [--model bytedance/seedance-2.0/image-to-video]
// Env: FAL_KEY. Verified price 2026-09-21: $0.3034 per generated 720p second (audio included).

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
const duration = String(arg('--duration', '4'));
const resolution = arg('--resolution', '720p');
const aspect = arg('--aspect', '16:9');
const seed = arg('--seed');
const model = arg('--model', 'bytedance/seedance-2.0/image-to-video');
const audio = !argv.includes('--no-audio');
if (!id || !first || !promptFile || !outDir) throw new Error('Need --id, --first, --prompt-file, --out-dir');
if (!process.env.FAL_KEY) throw new Error('FAL_KEY not set');
const key = process.env.FAL_KEY;

const local = (p) => {
  const abs = path.resolve(root, p);
  if (!abs.startsWith(root + path.sep)) throw new Error(`Path escapes the project: ${p}`);
  return abs;
};
const out = local(outDir);
fs.mkdirSync(out, { recursive: true });
const video = path.join(out, `${id}.mp4`);
if (fs.existsSync(video)) throw new Error(`Output exists: ${video}`);

const upload = async (file) => {
  const abs = local(file);
  const bytes = fs.readFileSync(abs);
  const contentType = /\.png$/i.test(abs) ? 'image/png' : 'image/jpeg';
  const initiate = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: contentType, file_name: path.basename(abs) }),
  });
  if (!initiate.ok) throw new Error(`storage initiate ${initiate.status}: ${(await initiate.text()).slice(0, 300)}`);
  const { upload_url: uploadUrl, file_url: fileUrl } = await initiate.json();
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
  if (!put.ok) throw new Error(`storage put ${put.status}`);
  return fileUrl;
};

const started = performance.now();
const prompt = fs.readFileSync(local(promptFile), 'utf8').trim();
const input = { prompt, image_url: await upload(first), resolution, duration, aspect_ratio: aspect, generate_audio: audio };
if (last) input.end_image_url = await upload(last);
if (seed !== undefined) input.seed = Number(seed);
fs.writeFileSync(path.join(out, `${id}-submit.json`), `${JSON.stringify({ model, input }, null, 2)}\n`);

const submit = await fetch(`https://queue.fal.run/${model}`, {
  method: 'POST',
  headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
});
if (!submit.ok) throw new Error(`submit ${submit.status}: ${(await submit.text()).slice(-500)}`);
const { request_id: requestId, status_url: statusUrl, response_url: responseUrl } = await submit.json();
console.log(`${id}: queued ${requestId}`);

let status = 'IN_QUEUE';
const deadline = Date.now() + 15 * 60 * 1000;
while (status !== 'COMPLETED') {
  if (Date.now() > deadline) throw new Error(`${id}: timed out after 15 minutes (${status})`);
  await new Promise((r) => setTimeout(r, 5000));
  const poll = await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } });
  if (!poll.ok) throw new Error(`status ${poll.status}: ${(await poll.text()).slice(-300)}`);
  const body = await poll.json();
  if (body.status !== status) console.log(`${id}: ${body.status}`);
  status = body.status;
  if (status === 'FAILED') throw new Error(`${id}: generation failed: ${JSON.stringify(body).slice(-500)}`);
}
const result = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } });
if (!result.ok) throw new Error(`result ${result.status}: ${(await result.text()).slice(-500)}`);
const data = await result.json();
fs.writeFileSync(path.join(out, `${id}-result.json`), `${JSON.stringify(data, null, 2)}\n`);
const url = data?.video?.url;
if (!url) throw new Error(`${id}: no video url in result: ${JSON.stringify(data).slice(0, 400)}`);
const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
fs.writeFileSync(video, bytes, { flag: 'wx' });

const receipt = {
  id,
  model,
  first,
  last: last ?? null,
  prompt_file: promptFile,
  duration_seconds: Number(duration),
  resolution,
  aspect_ratio: aspect,
  generate_audio: audio,
  seed: data?.seed ?? null,
  request_id: requestId,
  bytes: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  price_usd_estimate: +(Number(duration) * (resolution === '1080p' ? 0.682 : 0.3034)).toFixed(3),
  elapsed_seconds: +((performance.now() - started) / 1000).toFixed(1),
};
fs.writeFileSync(path.join(out, `${id}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ id, file: path.relative(root, video), seed: receipt.seed, elapsed_seconds: receipt.elapsed_seconds, price_usd_estimate: receipt.price_usd_estimate }));
