#!/usr/bin/env node
// Assembles the ALL ABOARD animatic from a timeline (EDL) JSON with ffmpeg.
// Each event is a still image or a video file placed frame-accurately at the
// EDL frame rate; audio entries are mixed on top. Swap a still for a generated
// clip by changing that event's source (and `in` for handles) and rebuilding.
//
// Usage: node scripts/build-opensea-animatic.mjs --edl <timeline.json> [--labels]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const edlPath = argv.includes('--edl') ? argv[argv.indexOf('--edl') + 1] : null;
if (!edlPath) throw new Error('Usage: --edl <timeline.json> [--labels]');
const labels = argv.includes('--labels');
const FONT = '/System/Library/Fonts/Helvetica.ttc';

const resolveLocal = (p) => {
  const abs = path.resolve(root, p);
  if (!abs.startsWith(root + path.sep)) throw new Error(`Path escapes the project: ${p}`);
  if (!fs.existsSync(abs)) throw new Error(`Missing source: ${p}`);
  return abs;
};

const edl = JSON.parse(fs.readFileSync(path.resolve(root, edlPath), 'utf8'));
const { fps, width: W, height: H } = edl;
if (!Number.isInteger(fps) || !Number.isInteger(W) || !Number.isInteger(H)) throw new Error('EDL needs integer fps, width, height');
const output = path.resolve(root, `${edl.output}${labels ? '-labeled' : ''}.mp4`);
const receiptPath = output.replace(/\.mp4$/, '.receipt.json');
for (const f of [output, receiptPath]) if (fs.existsSync(f)) throw new Error(`Output exists; bump the EDL output version: ${f}`);

// ---------- validate and frame-quantise the events ----------

const isImage = (p) => /\.(png|jpe?g|webp)$/i.test(p);
const events = edl.events.map((e, i) => {
  const startFrame = Math.round(e.start * fps);
  const endFrame = Math.round(e.end * fps);
  if (i === 0 && startFrame !== 0) throw new Error('First event must start at 0');
  if (i > 0 && Math.abs(e.start - edl.events[i - 1].end) > 1e-6) throw new Error(`Gap or overlap before event ${e.id}`);
  if (endFrame <= startFrame) throw new Error(`Event ${e.id} has no frames`);
  return { ...e, startFrame, frames: endFrame - startFrame, inFrame: Math.round((e.in ?? 0) * fps), abs: resolveLocal(e.source) };
});
const totalFrames = events[events.length - 1].startFrame + events[events.length - 1].frames;
const totalSeconds = totalFrames / fps;

// ---------- build the ffmpeg command ----------

const escapeText = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '');
const args = ['-v', 'error', '-y'];
const filters = [];
events.forEach((e, i) => {
  if (isImage(e.abs)) args.push('-loop', '1', '-framerate', String(fps), '-t', String(e.frames / fps + 1), '-i', e.abs);
  else args.push('-i', e.abs);
  // `speed` > 1 plays a longer source faster (a 4 s generated clip filling a 3 s shot);
  // `fit: "cover"` crops instead of padding when the source aspect differs.
  const speed = e.speed ?? 1;
  const chain = [
    e.fit === 'cover' ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}` : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    `fps=${fps}`,
    `trim=start_frame=${e.inFrame}:end_frame=${e.inFrame + Math.ceil(e.frames * speed)}`,
    `setpts=(PTS-STARTPTS)/${speed}`,
    ...(speed !== 1 ? [`fps=${fps}`] : []),
    // Guarantee exactly e.frames frames after any speed change: clone the last frame if short, then cut.
    'tpad=stop_mode=clone:stop=2',
    `trim=start_frame=0:end_frame=${e.frames}`,
    'setpts=PTS-STARTPTS',
    'format=yuv420p',
  ];
  if (labels) {
    const text = escapeText(`${e.id}  ${e.label}  ${e.start.toFixed(2)}s`);
    chain.push(`drawtext=fontfile=${FONT}:text='${text}':x=24:y=h-56:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=10`);
  }
  filters.push(`[${i}:v]${chain.join(',')}[v${i}]`);
});
let videoLabel = '[vcat]';
filters.push(`${events.map((_, i) => `[v${i}]`).join('')}concat=n=${events.length}:v=1:a=0${videoLabel}`);
if (labels) {
  const stamp = escapeText(`${path.basename(edl.output)}  ${totalSeconds.toFixed(1)}s  ${fps}fps`);
  filters.push(`${videoLabel}drawtext=fontfile=${FONT}:text='${stamp}':x=w-tw-24:y=24:fontsize=22:fontcolor=white@0.85:box=1:boxcolor=black@0.35:boxborderw=8[vout]`);
  videoLabel = '[vout]';
}

// ---------- audio ----------

// Events with `clip_audio_db` contribute their own generated sound (trimmed and
// speed-matched to the picture) alongside the separate audio entries.
const clipAudio = [];
events.forEach((e, i) => {
  if (e.clip_audio_db === undefined) return;
  const speed = e.speed ?? 1;
  const chain = [
    `atrim=start=${(e.in ?? 0)}:duration=${(e.frames * speed) / fps}`,
    'asetpts=PTS-STARTPTS',
    ...(speed !== 1 ? [`atempo=${speed}`] : []),
    'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
    `volume=${e.clip_audio_db}dB`,
    `afade=t=in:st=0:d=${e.clip_audio_fade ?? 0.08}`,
    `afade=t=out:st=${Math.max(0, e.frames / fps - (e.clip_audio_fade ?? 0.08))}:d=${e.clip_audio_fade ?? 0.08}`,
    `adelay=${Math.round(e.start * 1000)}|${Math.round(e.start * 1000)}`,
  ];
  filters.push(`[${i}:a]${chain.join(',')}[ca${i}]`);
  clipAudio.push(`[ca${i}]`);
});

const audio = (edl.audio ?? []).map((a) => ({ ...a, abs: resolveLocal(a.source) }));
let audioLabel = null;
if (audio.length || clipAudio.length) {
  audio.forEach((a, j) => {
    args.push('-i', a.abs);
    const inputIndex = events.length + j;
    const duration = a.end !== undefined ? a.end - a.start : null;
    const chain = [
      `atrim=start=${a.in ?? 0}${duration !== null ? `:duration=${duration}` : ''}`,
      'asetpts=PTS-STARTPTS',
      'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
      `volume=${a.gain_db ?? 0}dB`,
    ];
    if (a.fade_in) chain.push(`afade=t=in:st=0:d=${a.fade_in}`);
    if (a.fade_out && duration !== null) chain.push(`afade=t=out:st=${Math.max(0, duration - a.fade_out)}:d=${a.fade_out}`);
    const delayMs = Math.round(a.start * 1000);
    chain.push(`adelay=${delayMs}|${delayMs}`);
    filters.push(`[${inputIndex}:a]${chain.join(',')}[a${j}]`);
  });
  // Master stage: optional trim, then a true-peak-safe limiter at about -1 dBFS.
  const master = `volume=${edl.master_gain_db ?? 0}dB,alimiter=limit=0.891:attack=5:release=60:level=false`;
  // Voice bus: entries with bus "vo" duck everything else through a sidechain compressor,
  // then sit on top. Tunable via edl.duck {threshold (linear), ratio, attack_ms, release_ms}.
  const voLabels = audio.map((a, j) => (a.bus === 'vo' ? `[a${j}]` : null)).filter(Boolean);
  const bedLabels = [...audio.map((a, j) => (a.bus === 'vo' ? null : `[a${j}]`)).filter(Boolean), ...clipAudio];
  const mixOf = (labels, out) => {
    if (labels.length === 1) filters.push(`${labels[0]}anull${out}`);
    else filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest${out}`);
  };
  if (voLabels.length && bedLabels.length) {
    const duck = { threshold: 0.03, ratio: 3, attack_ms: 30, release_ms: 600, ...(edl.duck ?? {}) };
    mixOf(bedLabels, '[bedmix]');
    mixOf(voLabels, '[vomix]');
    filters.push('[vomix]asplit=2[vosc][vomain]');
    filters.push(`[bedmix][vosc]sidechaincompress=threshold=${duck.threshold}:ratio=${duck.ratio}:attack=${duck.attack_ms}:release=${duck.release_ms}:makeup=1:level_sc=1[bedduck]`);
    filters.push(`[bedduck][vomain]amix=inputs=2:normalize=0:duration=longest,${master},atrim=0:${totalSeconds},apad=whole_dur=${totalSeconds}[aout]`);
  } else {
    const mixInputs = [...voLabels, ...bedLabels];
    filters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0:duration=longest,${master},atrim=0:${totalSeconds},apad=whole_dur=${totalSeconds}[aout]`);
  }
  audioLabel = '[aout]';
}

args.push('-filter_complex', filters.join(';'), '-map', videoLabel);
if (audioLabel) args.push('-map', audioLabel, '-c:a', 'aac', '-b:a', '192k');
args.push('-frames:v', String(totalFrames), '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output);

const started = performance.now();
execFileSync('ffmpeg', args, { stdio: 'inherit', maxBuffer: 1 << 26 });

// ---------- verify and record ----------

const probe = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,r_frame_rate,width,height', '-of', 'json', output]).toString();
const stream = JSON.parse(probe).streams[0];
if (Number(stream.nb_read_frames) !== totalFrames) throw new Error(`Frame count ${stream.nb_read_frames} != ${totalFrames}`);
const receipt = {
  edl: edlPath,
  output: path.relative(root, output),
  labels,
  fps,
  dimensions: [W, H],
  total_frames: totalFrames,
  total_seconds: totalSeconds,
  events: events.map((e) => ({ id: e.id, label: e.label, start: e.start, end: e.end, start_frame: e.startFrame, frames: e.frames, source: e.source, in: e.in ?? 0, speed: e.speed ?? 1, fit: e.fit ?? 'contain' })),
  audio: audio.map(({ abs, ...a }) => a),
  sha256: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'),
  elapsed_seconds: +((performance.now() - started) / 1000).toFixed(1),
};
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output: receipt.output, total_frames: totalFrames, total_seconds: totalSeconds, events: events.length, audio: audio.length, elapsed_seconds: receipt.elapsed_seconds }));
