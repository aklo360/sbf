#!/usr/bin/env node
// Deterministic rigid rotation of the extruded OpenSea sailboat emblem for the
// ALL ABOARD ending (24.6 s to 26.5 s). It replaces the AI-approximated spin
// poses so the match cut, the spin and the 2D lock share one exact vector
// silhouette. Zero npm dependencies: Node for geometry and shading, ffmpeg for
// image codecs and the mp4.
//
// Usage: node scripts/render-opensea-logo-spin.mjs [--version v001] [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const board = path.join(root, 'output/opensea-storyboard');
const argv = process.argv.slice(2);
const version = argv.includes('--version') ? argv[argv.indexOf('--version') + 1] : 'v001';
if (!/^v\d{3}$/.test(version)) throw new Error('--version must look like v001');
const dryRun = argv.includes('--dry-run');
// Optional replacement background (1376x768). With it, every still is rebuilt over that
// plate: the emblem still from the 28c layer, the flat mark from the matte, no tint step.
const plateArg = argv.includes('--plate') ? argv[argv.indexOf('--plate') + 1] : null;
// Optional end-card resolve: after the flat mark, the mark shrinks onto the end card's
// subtitle emblem while the plate dissolves into the end card, then holds to 30.0 s.
// --glyph gives the subtitle emblem's pixel bounds in the end card (x0,y0,x1,y1).
const endcardArg = argv.includes('--endcard') ? argv[argv.indexOf('--endcard') + 1] : null;
const glyphArg = argv.includes('--glyph') ? argv[argv.indexOf('--glyph') + 1].split(',').map(Number) : null;
if (endcardArg && (!plateArg || !glyphArg || glyphArg.length !== 4 || glyphArg.some(Number.isNaN))) throw new Error('--endcard needs --plate and --glyph x0,y0,x1,y1');
// Motion end card: --plate-video replaces the still plate with a video's frames (moving water)
// for every frame; --title-layer is an RGBA lettering layer that swoops in and scales up
// instead of dissolving to a still end card. --glyph then gives the emblem bounds in the layer.
const plateVideoArg = argv.includes('--plate-video') ? argv[argv.indexOf('--plate-video') + 1] : null;
const titleLayerArg = argv.includes('--title-layer') ? argv[argv.indexOf('--title-layer') + 1] : null;
if (titleLayerArg && (!plateArg || !glyphArg || glyphArg.length !== 4 || glyphArg.some(Number.isNaN))) throw new Error('--title-layer needs --plate and --glyph x0,y0,x1,y1');
if (titleLayerArg && endcardArg) throw new Error('Use either --endcard or --title-layer');
const resolveMode = Boolean(endcardArg || titleLayerArg);
// --scale renders the whole sequence at a multiple of the 1376x768 storyboard size
// (1.40625 = 1080 tall). Inputs are resampled to the canvas; the emblem silhouette is
// re-rasterised from the vector, so it stays exact at any size.
const scaleArg = argv.includes('--scale') ? Number(argv[argv.indexOf('--scale') + 1]) : 1;
if (!(scaleArg > 0)) throw new Error('--scale must be a positive number');

// Timeline (24 fps). Frame k is at T0 + k / FPS.
const W = Math.round(1376 * scaleArg);
const H = Math.round(768 * scaleArg);
const SS = 3; // supersampling factor for the emblem layer
const FPS = 24;
const T0 = 24.6; // boat-aligned hold begins
const CUT_FRAME = 3; // 24.725 s: first physical-logo frame (approved 28c still)
const SPIN_FRAMES = 32; // one full turn completes at LOCK_FRAME (26.058 s)
const LOCK_FRAME = CUT_FRAME + SPIN_FRAMES;
const DISSOLVE_FRAMES = 4; // lock resolves to the flat white mark by 26.225 s
const RESOLVE_START_FRAME = LOCK_FRAME + DISSOLVE_FRAMES + 5; // 26.433 s (end-card mode only)
const RESOLVE_FRAMES = 17; // mark shrinks onto the subtitle emblem by 27.142 s
const END_FRAME = resolveMode ? 130 : 46; // resolve modes hold to 30.0 s; otherwise 26.517 s, title follows
const HOLD_SCALE = 1.04; // subtle scale-up of lettering and mark across the end-card hold
const SWOOP_RISE = Math.round(420 * scaleArg); // px the lettering travels up from below during the swoop
const SWOOP_SCALE_FROM = 0.72; // lettering starts at this scale and settles at 1.0
const EASE_K = 0.3; // 0 = constant angular speed; 0.3 = gentle ease in and out
const THICKNESS_RATIO = 0.1; // extrusion depth as a fraction of emblem width
const CAMERA_DISTANCE = 12000; // px; very long lens. Keeps the inner extrusion walls sub-pixel at 0 degrees so frame 4 continues cleanly from the flat 28c still
const POSE_TIMES = { '28d': 25.05, '28e': 25.4, '28f': 25.75 };

const inputs = {
  boat: '27a-boat-aligned-match-v001.png',
  logo: '28c-logo-match-3d-v001.png',
  layer: '28c-logo-match-3d-v001-layer.png',
  flat: '28-logo-match-final-v001.png',
  ocean: '28-logo-match-background-nb2-v001.jpg',
  matte: 'opensea-match-matte-v001.png',
  matteSvg: 'opensea-match-matte-v001.svg',
  overlaySvg: '28-logo-match-overlay-v002.svg',
};
const stem = `28-logo-spin-rigid-${version}`;
const outputs = {
  sequenceDir: path.join(board, stem),
  video: path.join(board, `${stem}.mp4`),
  receipt: path.join(board, `${stem}.receipt.json`),
  review: path.join(board, `ending-review-v${String(Number(version.slice(1)) + 2).padStart(3, '0')}.png`), // Codex's sheets end at v002
  poses: {
    '28d': path.join(board, `28d-logo-spin-quarter-rigid-${version}.png`),
    '28e': path.join(board, `28e-logo-spin-back-rigid-${version}.png`),
    '28f': path.join(board, `28f-logo-spin-return-rigid-${version}.png`),
  },
};

for (const file of [outputs.sequenceDir, outputs.video, outputs.receipt, outputs.review, ...Object.values(outputs.poses)]) {
  if (fs.existsSync(file)) throw new Error(`Output exists; choose a new --version: ${file}`);
}

// ---------- image codecs through ffmpeg ----------

const ffmpeg = (args, input) =>
  execFileSync('ffmpeg', ['-v', 'error', ...args], { input, maxBuffer: 1 << 30 });

const readRGBA = (file) => {
  const resample = scaleArg === 1 ? [] : ['-vf', `scale=${W}:${H}:flags=lanczos`];
  const buf = ffmpeg(['-i', file, ...resample, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  if (buf.length !== W * H * 4) throw new Error(`Unexpected dimensions for ${file}`);
  return buf;
};

const writePNG = (file, rgb) => {
  if (fs.existsSync(file)) throw new Error(`Refusing to overwrite ${file}`);
  ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', '-', '-frames:v', '1', '-n', file], rgb);
};

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ---------- vector geometry ----------

const parseTransforms = (svg) => {
  // Outer to inner <g transform="translate(tx ty) scale(s)"> groups.
  const groups = [...svg.matchAll(/<g transform="([^"]+)">/g)].map((m) => m[1]);
  const steps = groups.map((t) => {
    const tr = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(t);
    const sc = /scale\(([-\d.]+)\)/.exec(t);
    if (!tr || !sc) throw new Error(`Unsupported transform: ${t}`);
    return { tx: +tr[1], ty: +tr[2], s: +sc[1] };
  });
  return ([x, y]) => {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      x = steps[i].tx + steps[i].s * x;
      y = steps[i].ty + steps[i].s * y;
    }
    return [x, y];
  };
};

const parsePath = (d) => {
  const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi);
  const subpaths = [];
  let current = null;
  let cmd = null;
  let x = 0;
  let y = 0;
  let i = 0;
  const num = () => +tokens[i++];
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const n = 24;
    for (let k = 1; k <= n; k += 1) {
      const t = k / n;
      const u = 1 - t;
      current.push([
        u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
    x = x3;
    y = y3;
  };
  while (i < tokens.length) {
    if (/^[A-Z]$/i.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M':
        x = num(); y = num();
        current = [[x, y]];
        subpaths.push(current);
        cmd = 'L';
        break;
      case 'L': x = num(); y = num(); current.push([x, y]); break;
      case 'H': x = num(); current.push([x, y]); break;
      case 'V': y = num(); current.push([x, y]); break;
      case 'C': cubic(num(), num(), num(), num(), num(), num()); break;
      case 'Z': cmd = null; break;
      default: throw new Error(`Unsupported path command: ${cmd}`);
    }
  }
  return subpaths.map((pts) => {
    const clean = [];
    for (const p of pts) {
      const last = clean[clean.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) clean.push(p);
    }
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) clean.pop();
    return clean;
  });
};

const signedArea = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};

const matteSvg = fs.readFileSync(path.join(board, inputs.matteSvg), 'utf8');
const overlaySvg = fs.readFileSync(path.join(board, inputs.overlaySvg), 'utf8');
const pathData = /<path d="([^"]+)"/.exec(matteSvg)?.[1];
if (!pathData) throw new Error('Matte SVG path not found');
const toCanvasBase = parseTransforms(matteSvg);
const toCanvas = (p) => toCanvasBase(p).map((v) => v * scaleArg);
const polygons = parsePath(pathData).map((poly) => poly.map(toCanvas));
const bbox = polygons.flat().reduce(
  (b, [x, y]) => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
);
const CX = (bbox.x0 + bbox.x1) / 2;
const CY = (bbox.y0 + bbox.y1) / 2;
const WIDTH = bbox.x1 - bbox.x0;
const THICK = THICKNESS_RATIO * WIDTH;
const F = CAMERA_DISTANCE - THICK / 2; // scale is exactly 1 on the front cap at 0 degrees
const local = polygons.map((poly) => ({
  points: poly.map(([x, y]) => [x - CX, y - CY]),
  ccw: signedArea(poly) > 0,
}));

const tint = /<rect[^>]*fill="(#[0-9a-fA-F]{6})"[^>]*opacity="([\d.]+)"/.exec(overlaySvg);
if (!tint) throw new Error('Overlay tint rect not found');
const TINT = [1, 3, 5].map((k) => parseInt(tint[1].slice(k, k + 2), 16));
const TINT_OPACITY = +tint[2];

// ---------- plates ----------

// 2D even-odd rasterisation of the flat mark at scale s centred on (cx, cy), supersampled.
const rasterizeMark = (s, cx, cy) => {
  const edges = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const poly of local) {
    const pts = poly.points.map(([lx, ly]) => [SS * (cx + s * lx), SS * (cy + s * ly)]);
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a[1] !== b[1]) edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1]] : [b[0], b[1], a[0], a[1]]);
      minY = Math.min(minY, a[1]);
      maxY = Math.max(maxY, a[1]);
    }
  }
  const hits = new Uint8Array(W * H);
  for (let j = Math.max(0, Math.floor(minY)); j <= Math.min(H * SS - 1, Math.ceil(maxY)); j += 1) {
    const yc = j + 0.5;
    const xs = [];
    for (const [x0, y0, x1, y1] of edges) if (yc >= y0 && yc < y1) xs.push(x0 + ((yc - y0) * (x1 - x0)) / (y1 - y0));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = Math.max(0, Math.ceil(xs[k] - 0.5)); i < Math.min(W * SS, Math.ceil(xs[k + 1] - 0.5)); i += 1) hits[Math.floor(j / SS) * W + Math.floor(i / SS)] += 1;
    }
  }
  const coverage = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p += 1) coverage[p] = Math.round((255 * hits[p]) / (SS * SS));
  return coverage;
};

const boat = readRGBA(path.join(board, inputs.boat));
const logo = readRGBA(path.join(board, inputs.logo));
const layer = readRGBA(path.join(board, inputs.layer));
const flat = readRGBA(path.join(board, inputs.flat));
const ocean = readRGBA(path.join(board, inputs.ocean));
// At native size the matte PNG is the verified rsvg raster; at other scales the vector is re-rasterised exactly.
const matte = scaleArg === 1
  ? readRGBA(path.join(board, inputs.matte))
  : (() => {
      const coverage = rasterizeMark(1, CX, CY);
      const rgba = Buffer.alloc(W * H * 4);
      for (let p = 0; p < W * H; p += 1) rgba[p * 4 + 3] = coverage[p];
      return rgba;
    })();

// Ocean plate: approved 28-final pixels outside the matte; tinted open water inside it.
// The matte is dilated by one pixel so the flat mark's anti-aliased white edge never
// bleeds into the plate behind the rotating emblem.
const nearMatte = (p) => {
  const x = p % W;
  const y = (p - x) / W;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 0 && xx < W && yy >= 0 && yy < H && matte[(yy * W + xx) * 4 + 3] > 0) return true;
    }
  }
  return false;
};
const plate = Buffer.alloc(W * H * 3);
let outsideDiffSum = 0;
let outsideDiffMax = 0;
let outsideCount = 1;
if (plateArg) {
  const custom = readRGBA(path.resolve(root, plateArg));
  for (let p = 0; p < W * H; p += 1) plate.set(custom.subarray(p * 4, p * 4 + 3), p * 3);
} else {
  for (let p = 0; p < W * H; p += 1) {
    const inside = nearMatte(p);
    for (let c = 0; c < 3; c += 1) {
      const tinted = ocean[p * 4 + c] * (1 - TINT_OPACITY) + TINT[c] * TINT_OPACITY;
      plate[p * 3 + c] = inside ? Math.round(tinted) : flat[p * 4 + c];
      if (!inside) {
        const diff = Math.abs(tinted - flat[p * 4 + c]);
        outsideDiffSum += diff;
        outsideDiffMax = Math.max(outsideDiffMax, diff);
        outsideCount += 1;
      }
    }
  }
}

// Cut-point stills. Without --plate they are the approved 27a / 28c / 28 files verbatim;
// with --plate they are rebuilt over the new background from the same layer and matte.
const stillRGB = (rgba) => {
  const rgb = Buffer.alloc(W * H * 3);
  for (let p = 0; p < W * H; p += 1) rgb.set(rgba.subarray(p * 4, p * 4 + 3), p * 3);
  return rgb;
};
const overPlate = (colorAt, alphaAt, bg = plate) => {
  const rgb = Buffer.alloc(W * H * 3);
  for (let p = 0; p < W * H; p += 1) {
    const a = alphaAt(p) / 255;
    for (let c = 0; c < 3; c += 1) rgb[p * 3 + c] = Math.round(colorAt(p, c) * a + bg[p * 3 + c] * (1 - a));
  }
  return rgb;
};
const logoStill = plateArg ? overPlate((p, c) => layer[p * 4 + c], (p) => layer[p * 4 + 3]) : stillRGB(logo);
const flatStill = plateArg ? overPlate(() => 255, (p) => matte[p * 4 + 3]) : stillRGB(flat);
const boatStill = plateArg ? logoStill : stillRGB(boat);

// End-card resolve geometry: the mark scales from its full frame onto the subtitle emblem.
const endcard = endcardArg ? stillRGB(readRGBA(path.resolve(root, endcardArg))) : null;
const GLYPH = glyphArg ? { x0: glyphArg[0], y0: glyphArg[1], x1: glyphArg[2], y1: glyphArg[3] } : null;
const RESOLVE_SCALE = GLYPH ? Math.max((GLYPH.x1 - GLYPH.x0 + 1) / WIDTH, (GLYPH.y1 - GLYPH.y0 + 1) / (bbox.y1 - bbox.y0)) : 1;
const RESOLVE_CENTER = GLYPH ? [(GLYPH.x0 + GLYPH.x1 + 1) / 2, (GLYPH.y0 + GLYPH.y1 + 1) / 2] : [CX, CY];

const markOver = (bg, coverage) => {
  const rgb = Buffer.alloc(W * H * 3);
  for (let p = 0; p < W * H; p += 1) {
    const a = coverage[p] / 255;
    for (let c = 0; c < 3; c += 1) rgb[p * 3 + c] = Math.round(255 * a + bg[p * 3 + c] * (1 - a));
  }
  return rgb;
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// Moving plate: one rgb24 frame per output frame, scaled and cropped to the canvas.
const FRAME_BYTES = W * H * 3;
const plateFrames = plateVideoArg
  ? (() => {
      const buf = ffmpeg(['-i', path.resolve(root, plateVideoArg), '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS}`, '-frames:v', String(END_FRAME + 1), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const n = Math.floor(buf.length / FRAME_BYTES);
      if (n < END_FRAME + 1) throw new Error(`Plate video yields ${n} frames; ${END_FRAME + 1} needed`);
      return buf;
    })()
  : null;
const plateAt = (k) => (plateFrames ? plateFrames.subarray(k * FRAME_BYTES, (k + 1) * FRAME_BYTES) : plate);

// Lettering layer (straight-alpha RGBA) drawn at scale s about the frame centre, offset (dx, dy).
const titleLayer = titleLayerArg ? readRGBA(path.resolve(root, titleLayerArg)) : null;
const drawTitle = (bg, s, dx, dy, opacity) => {
  const out = Buffer.from(bg);
  if (opacity <= 0) return out;
  for (let y = 0; y < H; y += 1) {
    const v = (y - H / 2) / s + H / 2 - dy;
    if (v < 0 || v >= H - 1) continue;
    const y0 = Math.floor(v);
    const fy = v - y0;
    for (let x = 0; x < W; x += 1) {
      const u = (x - W / 2) / s + W / 2 - dx;
      if (u < 0 || u >= W - 1) continue;
      const x0 = Math.floor(u);
      const fx = u - x0;
      let a = 0;
      const rgb = [0, 0, 0];
      for (const [ox, oy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
        const q = ((y0 + oy) * W + x0 + ox) * 4;
        const wa = (titleLayer[q + 3] / 255) * w;
        a += wa;
        for (let c = 0; c < 3; c += 1) rgb[c] += titleLayer[q + c] * wa;
      }
      if (a <= 0) continue;
      const alpha = Math.min(1, a) * opacity;
      const p = (y * W + x) * 3;
      for (let c = 0; c < 3; c += 1) out[p + c] = Math.round((rgb[c] / a) * alpha + bg[p + c] * (1 - alpha));
    }
  }
  return out;
};

// Resolve: the mark shrinks onto the subtitle emblem. Still end card: the plate dissolves into it.
// Motion end card: the lettering swoops up into frame and lands as the mark lands, then both
// scale up subtly over the hold while the water keeps moving.
const resolveFrame = (k) => {
  const p = easeInOut(Math.min(1, Math.max(0, (k - RESOLVE_START_FRAME) / RESOLVE_FRAMES)));
  const holdT = Math.min(1, Math.max(0, (k - (RESOLVE_START_FRAME + RESOLVE_FRAMES)) / (END_FRAME - RESOLVE_START_FRAME - RESOLVE_FRAMES)));
  const hs = titleLayer ? 1 + (HOLD_SCALE - 1) * easeOut(holdT) : 1;
  const targetX = W / 2 + (RESOLVE_CENTER[0] - W / 2) * hs;
  const targetY = H / 2 + (RESOLVE_CENTER[1] - H / 2) * hs;
  const s = (1 + (RESOLVE_SCALE - 1) * p) * (p >= 1 ? hs : 1);
  const cx = CX + (targetX - CX) * p;
  const cy = CY + (targetY - CY) * p;
  let bg;
  if (titleLayer) {
    const q = easeOut(p);
    bg = drawTitle(plateAt(k), (SWOOP_SCALE_FROM + (1 - SWOOP_SCALE_FROM) * q) * hs, 0, SWOOP_RISE * (1 - q), Math.min(1, p * 2.5));
  } else {
    bg = Buffer.alloc(W * H * 3);
    for (let i = 0; i < bg.length; i += 1) bg[i] = Math.round(plate[i] * (1 - p) + endcard[i] * p);
  }
  return markOver(bg, rasterizeMark(s, cx, cy));
};
let endHoldFrame = null;

// Albedo for the extrusion walls: the layer's mean colour divided by its front lighting.
const layerMean = [0, 0, 0];
let layerCount = 0;
for (let p = 0; p < W * H; p += 1) {
  if (layer[p * 4 + 3] === 255) {
    for (let c = 0; c < 3; c += 1) layerMean[c] += layer[p * 4 + c];
    layerCount += 1;
  }
}
for (let c = 0; c < 3; c += 1) layerMean[c] /= layerCount * 255;

// ---------- shading ----------

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const KEY = norm([0.55, -0.55, -0.62]); // warm sun, upper right, in front of the emblem
const FILL = norm([-0.5, 0.45, -0.35]); // cool bounce from the sea, lower left
const AMBIENT = [0.42, 0.43, 0.45];
const FILL_COLOR = [0.5, 0.62, 0.8];

const lighting = (n) => {
  const nl = Math.max(0, dot(n, KEY));
  const nf = Math.max(0, dot(n, FILL));
  return [0, 1, 2].map((c) => AMBIENT[c] + 0.62 * nl + 0.18 * nf * FILL_COLOR[c]);
};
const specular = (n, V, strength, exponent = 60) => {
  const h = norm([KEY[0] + V[0], KEY[1] + V[1], KEY[2] + V[2]]);
  return strength * Math.pow(Math.max(0, dot(n, h)), exponent);
};
const FRONT_LIGHT = lighting([0, 0, -1]);
const ALBEDO = layerMean.map((m, c) => Math.min(1, m / FRONT_LIGHT[c]));
const WALL_ALBEDO = ALBEDO.map((a, c) => Math.min(1, a * [1.02, 0.985, 0.94][c])); // warm ivory walls
const WALL_DEPTH_SHADE = 0.16; // walls darken slightly toward the back cap
const WALL_CREASE_COS = Math.cos((30 * Math.PI) / 180); // corners sharper than 30 degrees stay hard-edged

const sampleLayer = (tx, ty) => {
  const x = Math.min(W - 1.001, Math.max(0, tx - 0.5));
  const y = Math.min(H - 1.001, Math.max(0, ty - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const out = [0, 0, 0];
  let alpha = 0;
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const p = ((y0 + dy) * W + x0 + dx) * 4;
    const a = layer[p + 3] / 255;
    alpha += a * w;
    for (let c = 0; c < 3; c += 1) out[c] += (layer[p + c] / 255) * a * w;
  }
  if (alpha < 1e-3) return ALBEDO.map((a, c) => a * FRONT_LIGHT[c]);
  return out.map((v) => v / alpha);
};

// ---------- rasterizer ----------

const WS = W * SS;
const HS = H * SS;
const color = new Float32Array(WS * HS * 4); // premultiplied RGBA
const zbuf = new Float32Array(WS * HS);

const rayDir = (i, j) => [((i + 0.5) / SS - CX) / F, ((j + 0.5) / SS - CY) / F, 1];

const project = ([X, Y, Z]) => [SS * (CX + (F * X) / Z), SS * (CY + (F * Y) / Z), Z];

const put = (idx, rgb, spec) => {
  color[idx * 4] = Math.min(1, rgb[0] + spec);
  color[idx * 4 + 1] = Math.min(1, rgb[1] + spec);
  color[idx * 4 + 2] = Math.min(1, rgb[2] + spec);
  color[idx * 4 + 3] = 1;
};

const renderCap = (theta, sign) => {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const z = (sign * THICK) / 2;
  const P0 = [z * s, 0, CAMERA_DISTANCE + z * c];
  const N = [sign * s, 0, sign * c];
  const NP0 = dot(N, P0);
  const light = lighting(N);
  const gain = light.map((l, k) => l / FRONT_LIGHT[k]);
  const edges = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const poly of local) {
    const pts = poly.points.map(([x, y]) => project([x * c + z * s, y, CAMERA_DISTANCE + (-x * s + z * c)]));
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a[1] !== b[1]) edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1]] : [b[0], b[1], a[0], a[1]]);
      minY = Math.min(minY, a[1]);
      maxY = Math.max(maxY, a[1]);
    }
  }
  for (let j = Math.max(0, Math.floor(minY)); j <= Math.min(HS - 1, Math.ceil(maxY)); j += 1) {
    const yc = j + 0.5;
    const xs = [];
    for (const [x0, y0, x1, y1] of edges) if (yc >= y0 && yc < y1) xs.push(x0 + ((yc - y0) * (x1 - x0)) / (y1 - y0));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = Math.max(0, Math.ceil(xs[k] - 0.5)); i < Math.min(WS, Math.ceil(xs[k + 1] - 0.5)); i += 1) {
        const d = rayDir(i, j);
        const nd = dot(N, d);
        if (Math.abs(nd) < 1e-9) continue;
        const depth = NP0 / nd;
        const idx = j * WS + i;
        if (depth <= 0 || depth >= zbuf[idx]) continue;
        zbuf[idx] = depth;
        const Q = [depth * d[0], depth * d[1], depth];
        const Zl = Q[2] - CAMERA_DISTANCE;
        const lx = Q[0] * c - Zl * s; // inverse rotation back to the flat emblem
        const V = norm([-Q[0], -Q[1], -Q[2]]);
        const tex = sampleLayer(CX + lx, CY + Q[1]);
        put(idx, tex.map((t, ch) => t * gain[ch]), specular(N, V, 0.2));
      }
    }
  }
};

// Wall triangle with smooth shading. n0..n2 are per-vertex normals (camera space);
// f0..f2 are each vertex's position along the extrusion (0 = front cap, 1 = back cap).
const renderTriangle = (p0, p1, p2, [n0, n1, n2], [f0, f1, f2]) => {
  const edge = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const area = edge(p0, p1, p2[0], p2[1]);
  if (Math.abs(area) < 1e-9) return;
  const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
  const maxX = Math.min(WS - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
  const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
  const maxY = Math.min(HS - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
  for (let j = minY; j <= maxY; j += 1) {
    for (let i = minX; i <= maxX; i += 1) {
      const x = i + 0.5;
      const y = j + 0.5;
      const w0 = edge(p1, p2, x, y) / area;
      const w1 = edge(p2, p0, x, y) / area;
      const w2 = edge(p0, p1, x, y) / area;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const depth = 1 / (w0 / p0[2] + w1 / p1[2] + w2 / p2[2]);
      const idx = j * WS + i;
      if (depth >= zbuf[idx]) continue;
      zbuf[idx] = depth;
      const n = norm([
        w0 * n0[0] + w1 * n1[0] + w2 * n2[0],
        w0 * n0[1] + w1 * n1[1] + w2 * n2[1],
        w0 * n0[2] + w1 * n1[2] + w2 * n2[2],
      ]);
      const shade = 1 - WALL_DEPTH_SHADE * (w0 * f0 + w1 * f1 + w2 * f2);
      const light = lighting(n);
      const d = rayDir(i, j);
      const V = norm([-depth * d[0], -depth * d[1], -depth]);
      put(idx, WALL_ALBEDO.map((a, c) => a * light[c] * shade), specular(n, V, 0.28, 30));
    }
  }
};

const renderWalls = (theta) => {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const place = (x, y, z) => project([x * c + z * s, y, CAMERA_DISTANCE + (-x * s + z * c)]);
  const rotate = ([nx, ny]) => [nx * c, ny, -nx * s];
  for (const poly of local) {
    const pts = poly.points;
    const count = pts.length;
    const edgeNormal = pts.map(([ax, ay], i) => {
      const [bx, by] = pts[(i + 1) % count];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      return [(poly.ccw ? dy : -dy) / len, (poly.ccw ? -dx : dx) / len];
    });
    // Smooth normals across flattened curves; keep a hard edge at real corners.
    const vertexNormal = (i, j) => {
      const a = edgeNormal[i];
      const b = edgeNormal[j];
      if (a[0] * b[0] + a[1] * b[1] < WALL_CREASE_COS) return a;
      const len = Math.hypot(a[0] + b[0], a[1] + b[1]);
      return [(a[0] + b[0]) / len, (a[1] + b[1]) / len];
    };
    for (let i = 0; i < count; i += 1) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % count];
      const nA = rotate(vertexNormal(i, (i + count - 1) % count));
      const nB = rotate(vertexNormal(i, (i + 1) % count));
      const af = place(ax, ay, -THICK / 2);
      const bf = place(bx, by, -THICK / 2);
      const bb = place(bx, by, THICK / 2);
      const ab = place(ax, ay, THICK / 2);
      renderTriangle(af, bf, bb, [nA, nB, nB], [0, 0, 1]);
      renderTriangle(af, bb, ab, [nA, nB, nA], [0, 1, 1]);
    }
  }
};

const renderFrame = (theta, bg = plate) => {
  color.fill(0);
  zbuf.fill(Infinity);
  renderWalls(theta);
  renderCap(theta, -1);
  renderCap(theta, 1);
  const rgb = Buffer.alloc(W * H * 3);
  const coverage = new Uint8Array(W * H);
  const inv = 1 / (SS * SS);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const idx = ((y * SS + sy) * WS + x * SS + sx) * 4;
          r += color[idx];
          g += color[idx + 1];
          b += color[idx + 2];
          a += color[idx + 3];
        }
      }
      r *= inv; g *= inv; b *= inv; a *= inv;
      const p = y * W + x;
      coverage[p] = Math.round(a * 255);
      rgb[p * 3] = Math.round(255 * r + bg[p * 3] * (1 - a));
      rgb[p * 3 + 1] = Math.round(255 * g + bg[p * 3 + 1] * (1 - a));
      rgb[p * 3 + 2] = Math.round(255 * b + bg[p * 3 + 2] * (1 - a));
    }
  }
  return { rgb, coverage };
};

// ---------- timeline ----------

const ease = (s) => s - (EASE_K * Math.sin(2 * Math.PI * s)) / (2 * Math.PI);
const thetaAt = (k) => 2 * Math.PI * ease((k - CUT_FRAME) / SPIN_FRAMES);
const timeAt = (k) => +(T0 + k / FPS).toFixed(4);
const mix = (a, b, t) => {
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.round(a[i] * (1 - t) + b[i] * t);
  return out;
};

// With a moving plate the cut-point stills are rebuilt over that frame's water.
const logoAt = (k) => (plateFrames ? overPlate((p, c) => layer[p * 4 + c], (p) => layer[p * 4 + 3], plateAt(k)) : logoStill);
const flatAt = (k) => (plateFrames ? overPlate(() => 255, (p) => matte[p * 4 + 3], plateAt(k)) : flatStill);

const frameFor = (k) => {
  if (k < CUT_FRAME) return { kind: plateArg ? 'emblem still (lead-in)' : 'boat-still (27a)', rgb: plateFrames ? logoAt(k) : boatStill };
  if (k === CUT_FRAME || k === LOCK_FRAME) return { kind: k === CUT_FRAME ? 'match-cut still (28c)' : 'front lock still (28c)', rgb: logoAt(k) };
  if (k < LOCK_FRAME) {
    const theta = thetaAt(k);
    return { kind: 'rigid render', degrees: +((theta * 180) / Math.PI).toFixed(2), ...renderFrame(theta, plateAt(k)) };
  }
  if (k <= LOCK_FRAME + DISSOLVE_FRAMES) {
    const t = (k - LOCK_FRAME) / DISSOLVE_FRAMES;
    return { kind: `dissolve to flat mark (${t.toFixed(2)})`, rgb: mix(logoAt(k), flatAt(k), t) };
  }
  if (resolveMode && k >= RESOLVE_START_FRAME) {
    if (k < RESOLVE_START_FRAME + RESOLVE_FRAMES) return { kind: titleLayer ? 'resolve: mark shrinks onto the subtitle emblem, lettering swoops in' : 'resolve: mark shrinks onto the subtitle emblem, end card dissolves in', rgb: resolveFrame(k) };
    if (plateFrames || titleLayer) return { kind: 'end card hold (water moving, subtle scale-up)', rgb: resolveFrame(k) };
    if (!endHoldFrame) endHoldFrame = resolveFrame(RESOLVE_START_FRAME + RESOLVE_FRAMES);
    return { kind: 'end card hold', rgb: endHoldFrame };
  }
  return { kind: 'flat mark still (28)', rgb: flatAt(k) };
};

// Continuity evidence: the 0-degree render against the approved cut-point still.
const zero = renderFrame(0);
let silhouetteHard = 0;
let silhouetteSoft = 0;
let insideDiffSum = 0;
let insideCount = 0;
let insideOver12 = 0;
for (let p = 0; p < W * H; p += 1) {
  const dm = Math.abs(zero.coverage[p] - matte[p * 4 + 3]);
  if (dm > 128) silhouetteHard += 1;
  if (dm > 16) silhouetteSoft += 1;
  if (matte[p * 4 + 3] === 255) {
    let diff = 0;
    for (let c = 0; c < 3; c += 1) diff += Math.abs(zero.rgb[p * 3 + c] - logoStill[p * 3 + c]);
    insideDiffSum += diff / 3;
    insideCount += 1;
    if (diff / 3 > 12) insideOver12 += 1;
  }
}

const receipt = {
  title: 'ALL ABOARD ending: rigid extruded OpenSea emblem rotation',
  version,
  method: 'Official vector silhouette extruded and rotated about its vertical centre axis; front and back caps textured from the approved 28c layer; walls shaded ivory; supersampled and composited over the approved tinted ocean plate. No AI generation.',
  fps: FPS,
  dimensions: [W, H],
  supersample: SS,
  thickness_px: +THICK.toFixed(2),
  camera_distance_px: CAMERA_DISTANCE,
  ease: EASE_K,
  emblem_bbox: bbox,
  tint: { color: tint[1], opacity: TINT_OPACITY },
  timeline: {
    boat_hold: { frames: [0, CUT_FRAME - 1], seconds: [timeAt(0), timeAt(CUT_FRAME - 1)] },
    match_cut_still: { frame: CUT_FRAME, seconds: timeAt(CUT_FRAME) },
    spin: { frames: [CUT_FRAME + 1, LOCK_FRAME - 1], seconds: [timeAt(CUT_FRAME + 1), timeAt(LOCK_FRAME - 1)] },
    front_lock_still: { frame: LOCK_FRAME, seconds: timeAt(LOCK_FRAME) },
    dissolve_to_flat: { frames: [LOCK_FRAME + 1, LOCK_FRAME + DISSOLVE_FRAMES], seconds: [timeAt(LOCK_FRAME + 1), timeAt(LOCK_FRAME + DISSOLVE_FRAMES)] },
    flat_hold: { frames: [LOCK_FRAME + DISSOLVE_FRAMES + 1, END_FRAME], seconds: [timeAt(LOCK_FRAME + DISSOLVE_FRAMES + 1), timeAt(END_FRAME)] },
  },
  verification: {
    plate_outside_matte_vs_28_final: { mean_abs_diff: +(outsideDiffSum / outsideCount).toFixed(3), max_abs_diff: outsideDiffMax },
    render0_vs_matte_silhouette: { pixels_over_128: silhouetteHard, pixels_over_16: silhouetteSoft, matte_pixels: insideCount },
    render0_vs_28c_inside_matte: { mean_abs_diff: +(insideDiffSum / insideCount).toFixed(3), pixels_over_12: insideOver12 },
    note: 'Frames 3 and 35 are the approved 28c still itself, so the cut and the lock keep the verified 0-pixel silhouette match. The numbers above measure how closely the first rendered frame continues from that still.',
  },
  inputs: { ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, `output/opensea-storyboard/${v}`])), ...(plateArg ? { plate: plateArg } : {}) },
  frames: [],
  poses: {},
  outputs: {},
};

console.log(JSON.stringify({ emblem: { width: +WIDTH.toFixed(2), center: [+CX.toFixed(2), +CY.toFixed(2)], polygons: local.map((p) => p.points.length) }, verification: receipt.verification }, null, 2));
if (argv.includes('--coverage-out')) fs.writeFileSync(argv[argv.indexOf('--coverage-out') + 1], zero.coverage); // raw 8-bit coverage of the 0-degree render, for offline checks
if (dryRun) process.exit(0);

fs.mkdirSync(outputs.sequenceDir, { recursive: false });
const started = performance.now();
for (let k = 0; k <= END_FRAME; k += 1) {
  const frame = frameFor(k);
  const file = path.join(outputs.sequenceDir, `frame-${String(k).padStart(3, '0')}.png`);
  writePNG(file, frame.rgb);
  receipt.frames.push({ frame: k, seconds: timeAt(k), kind: frame.kind, ...(frame.degrees !== undefined ? { degrees: frame.degrees } : {}) });
  for (const [id, t] of Object.entries(POSE_TIMES)) {
    if (k === Math.round((t - T0) * FPS)) {
      writePNG(outputs.poses[id], frame.rgb);
      receipt.poses[id] = { frame: k, seconds: timeAt(k), degrees: frame.degrees, file: path.relative(root, outputs.poses[id]) };
    }
  }
  process.stdout.write(`frame ${k}/${END_FRAME} ${frame.kind}${frame.degrees !== undefined ? ` ${frame.degrees}°` : ''}\n`);
}

// yuv420p needs even dimensions; scaled renders can be odd (1935 wide at 1080 tall), so crop 1 px if necessary.
ffmpeg(['-framerate', String(FPS), '-i', path.join(outputs.sequenceDir, 'frame-%03d.png'), '-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-n', outputs.video]);

// Review sheet: boat, cut, three spin poses, lock, flat mark, end of hold.
const reviewFrames = [CUT_FRAME, receipt.poses['28d'].frame, receipt.poses['28e'].frame, receipt.poses['28f'].frame, LOCK_FRAME, LOCK_FRAME + DISSOLVE_FRAMES, resolveMode ? RESOLVE_START_FRAME + 8 : CUT_FRAME - 1, END_FRAME];
if (resolveMode) {
  if (plateVideoArg) receipt.inputs.plate_video = plateVideoArg;
  if (titleLayerArg) {
    receipt.inputs.title_layer = titleLayerArg;
    receipt.title_motion = { swoop_rise_px: SWOOP_RISE, swoop_scale_from: SWOOP_SCALE_FROM, hold_scale: HOLD_SCALE };
  }
  receipt.timeline.flat_hold.frames[1] = RESOLVE_START_FRAME - 1;
  receipt.timeline.flat_hold.seconds[1] = timeAt(RESOLVE_START_FRAME - 1);
  receipt.timeline.resolve = { frames: [RESOLVE_START_FRAME, RESOLVE_START_FRAME + RESOLVE_FRAMES - 1], seconds: [timeAt(RESOLVE_START_FRAME), timeAt(RESOLVE_START_FRAME + RESOLVE_FRAMES - 1)] };
  receipt.timeline.end_card_hold = { frames: [RESOLVE_START_FRAME + RESOLVE_FRAMES, END_FRAME], seconds: [timeAt(RESOLVE_START_FRAME + RESOLVE_FRAMES), timeAt(END_FRAME)] };
  receipt.inputs.endcard = endcardArg;
  receipt.resolve = { glyph: GLYPH, scale: +RESOLVE_SCALE.toFixed(5), center: RESOLVE_CENTER, note: 'The exact vector mark stays drawn over the end card at the glyph position through the hold, so the landing has no pop.' };
}
const reviewInputs = reviewFrames.flatMap((k) => ['-i', path.join(outputs.sequenceDir, `frame-${String(k).padStart(3, '0')}.png`)]);
const scaled = reviewFrames.map((_, i) => `[${i}:v]scale=688:384[s${i}]`).join(';');
const concat = reviewFrames.map((_, i) => `[s${i}]`).join('');
ffmpeg([...reviewInputs, '-filter_complex', `${scaled};${concat}concat=n=${reviewFrames.length}:v=1:a=0,tile=4x2:padding=8:margin=8:color=0x0b1220`, '-frames:v', '1', '-n', outputs.review]);

receipt.review_frames = reviewFrames;
receipt.outputs = {
  sequence: path.relative(root, outputs.sequenceDir),
  video: { file: path.relative(root, outputs.video), sha256: sha256(outputs.video) },
  review: { file: path.relative(root, outputs.review), sha256: sha256(outputs.review) },
};
for (const pose of Object.values(receipt.poses)) pose.sha256 = sha256(path.join(root, pose.file));
receipt.elapsed_seconds = +((performance.now() - started) / 1000).toFixed(1);
fs.writeFileSync(outputs.receipt, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ video: receipt.outputs.video, review: receipt.outputs.review, poses: receipt.poses, elapsed_seconds: receipt.elapsed_seconds }, null, 2));
