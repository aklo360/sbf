#!/usr/bin/env node
// Short character vocalisations (giggles, squeaks) through Gemini expressive TTS.
// Writes <out>.mp3 (44.1 kHz stereo, optional pitch shift) and <out>.receipt.json.
//
// Usage: node scripts/gen-gemini-giggle.mjs --out <path-without-extension> --voice Puck
//        --direction "<style direction>" --text "<what to vocalise>" [--pitch 1.2] [--model gemini-3.1-flash-tts-preview]
// Env: GEMINI_API_KEY.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const outStem = arg('--out');
const voice = arg('--voice', 'Puck');
const direction = arg('--direction');
const text = arg('--text');
const pitch = Number(arg('--pitch', '1'));
const model = arg('--model', 'gemini-3.1-flash-tts-preview');
if (!outStem || !direction || !text) throw new Error('Need --out, --direction, --text');
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('GEMINI_API_KEY not set');
const out = path.resolve(root, outStem);
if (!out.startsWith(root + path.sep)) throw new Error('Output must stay inside the project');
if (fs.existsSync(`${out}.mp3`)) throw new Error(`Output exists: ${out}.mp3`);
fs.mkdirSync(path.dirname(out), { recursive: true });

const prompt = `${direction}\n\nPerform exactly this, nothing else:\n${text}`;
const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST',
  headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  }),
});
const bodyText = await response.text();
if (!response.ok) throw new Error(`Gemini ${response.status}: ${bodyText.slice(0, 500)}`);
const parts = JSON.parse(bodyText)?.candidates?.[0]?.content?.parts ?? [];
const inline = parts.map((p) => p.inlineData ?? p.inline_data).find((d) => d?.data);
if (!inline) throw new Error(`No audio in response: ${bodyText.slice(0, 300)}`);
const mime = inline.mimeType ?? inline.mime_type ?? 'audio/L16;codec=pcm;rate=24000';
const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
const raw = Buffer.from(inline.data, 'base64');
// Trim leading/trailing silence, then optional pitch shift (asetrate + atempo keeps duration).
const filters = ['silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05', 'areverse', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05', 'areverse'];
if (pitch !== 1) filters.push(`asetrate=${rate}*${pitch}`, `aresample=${rate}`, `atempo=${(1 / pitch).toFixed(4)}`);
filters.push('aresample=44100');
execFileSync('ffmpeg', ['-v', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', '-', '-af', filters.join(','), '-ac', '2', '-b:a', '192k', '-n', `${out}.mp3`], { input: raw });
const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${out}.mp3`]).toString().trim());
fs.writeFileSync(`${out}.receipt.json`, `${JSON.stringify({ model, voice, direction, text, pitch, mime, duration_seconds: duration }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ file: path.relative(root, `${out}.mp3`), voice, pitch, duration_seconds: duration }));
