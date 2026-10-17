'use strict';
/**
 * 画面版式自检：检测「内容被画面边缘裁切」。
 *
 * 为什么需要它：canvas 是逐像素画出来的，DOM 层面看不到里面画了什么，
 * 所以「文字被切掉一半」这类问题，任何检查 HTML 结构的规则都查不出来。
 * 只能读真实渲染出的像素。
 *
 * 做法（业界验证过的 edge-band sharp-step 检测，见 NOTICE.md）：
 *   沿画面四条边取内侧一条几像素宽的窄带，统计亮度沿该边的「陡变次数」。
 *   平滑的全幅渐变（背景、光晕）不会触发；跨过边缘的文字和硬边图形会。
 *   一条边出现 2 次以上陡变，就判定有内容被裁切。
 *
 * 零额外依赖：用 ffmpeg 把视频解成 raw rgb24，Node 直接读字节。
 */
const { execFileSync } = require('child_process');
const { ffmpegBin } = require('./util');

const SAMPLE_W = 640;
const SAMPLE_H = 360;
const BAND = 3;        // 内侧窄带宽度（像素）
const STEP_THRESHOLD = 30; // 亮度陡变阈值（0-255）
const MIN_STEPS = 2;   // 一条边上至少这么多次陡变才算裁切

/**
 * 用 ffmpeg 按 fps 抽帧，返回 [{ index, rgb: Buffer }]。
 * cropBottom 是画面底部要裁掉的占比（0–1），用于避开烧录字幕区域。
 */
function sampleFrames(videoPath, {
  width = SAMPLE_W, height = SAMPLE_H, fps = 1, maxFrames = 180, cropBottom = 0
} = {}) {
  const cropFrac = Math.max(0, Math.min(0.6, Number(cropBottom) || 0));
  const outH = Math.max(1, Math.round(height * (1 - cropFrac)));
  const vf = `fps=${fps},scale=${width}:${height}` +
    (cropFrac > 0 ? `,crop=${width}:${outH}:0:0` : '');

  const buf = execFileSync(
    ffmpegBin(),
    [
      '-v', 'error',
      '-i', videoPath,
      '-vf', vf,
      '-frames:v', String(maxFrames),
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
    ],
    { maxBuffer: 1024 * 1024 * 512 }
  );

  const frameSize = width * outH * 3;
  const frames = [];
  for (let off = 0, i = 0; off + frameSize <= buf.length; off += frameSize, i++) {
    frames.push({ index: i, rgb: buf.subarray(off, off + frameSize) });
  }
  return { frames, width, height: outH };
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 沿一条边统计陡变次数 */
function sharpSteps(lums) {
  let steps = 0;
  for (let i = 1; i < lums.length; i++) {
    if (Math.abs(lums[i] - lums[i - 1]) >= STEP_THRESHOLD) steps++;
  }
  return steps;
}

/** 取四条边带上的亮度序列 */
function edgeBands(rgb, W, H) {
  const at = (x, y) => {
    const o = (y * W + x) * 3;
    return lum(rgb[o], rgb[o + 1], rgb[o + 2]);
  };

  // 每条边：对窄带内像素取平均亮度，得到沿边的一维序列
  const colAvg = (x, ys) => ys.reduce((s, y) => s + at(x, y), 0) / ys.length;
  const rowAvg = (y, xs) => xs.reduce((s, x) => s + at(x, y), 0) / xs.length;

  const leftYs = Array.from({ length: BAND }, (_, i) => i);
  const rightYs = Array.from({ length: BAND }, (_, i) => H - 1 - i);
  const topXs = Array.from({ length: BAND }, (_, i) => i);
  const bottomXs = Array.from({ length: BAND }, (_, i) => W - 1 - i);

  return {
    left: Array.from({ length: H }, (_, y) => colAvg(y, leftYs)),
    right: Array.from({ length: H }, (_, y) => colAvg(y, rightYs)),
    top: Array.from({ length: W }, (_, x) => rowAvg(x, topXs)),
    bottom: Array.from({ length: W }, (_, x) => rowAvg(x, bottomXs))
  };
}

/**
 * 分析视频，返回 { sampled, clipped: [{ time, edges }], clean }
 * clipped 里每条记录表示某个采样时刻有边被内容裁切。
 */
function analyzeVideo(videoPath, { fps = 1 } = {}) {
  const { frames, width, height } = sampleFrames(videoPath, { fps });
  const clipped = [];

  for (const f of frames) {
    const bands = edgeBands(f.rgb, width, height);
    const hit = [];
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      if (sharpSteps(bands[edge]) >= MIN_STEPS) hit.push(edge);
    }
    if (hit.length) {
      clipped.push({ time: f.index / fps, edges: hit });
    }
  }

  return { sampled: frames.length, clipped };
}

/**
 * 画面节奏分析：抽帧比较相邻帧，找出“长时间不动”的区段。
 *
 * 判据是相邻采样帧的平均亮度差（MAD，0–255）。在 320×180 下：
 *   ≥ 0.5 基本能看出元素在动；≤ 0.2 肉眼几乎就是静止。
 * 摄影机 3.5% 的缓慢推进会产生 0.1–0.3 的微小差异，不会掩盖真正的静止。
 *
 * 返回：
 *   staticSpans   —— 时长 ≥1s 的静止区段（按长度降序）
 *   overLimit     —— 超过 staticLimit（默认 4s）的静止区段
 *   hookChanges   —— 前 hookWindow 秒内检测到的视觉变化次数
 *   firstFrameLuma—— 首帧平均亮度（判断是否黑场开场）
 */
const FRAME_DIFF_THRESHOLD = 0.5;
const STATIC_LIMIT = 4;

function toLuma(rgb) {
  const out = new Float32Array(Math.floor(rgb.length / 3));
  for (let i = 0, j = 0; i + 2 < rgb.length; i += 3, j++) {
    out[j] = 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
  }
  return out;
}

function meanAbsDiff(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return n ? sum / n : 0;
}

function analyzePacing(videoPath, {
  fps = 4,
  width = 320,
  height = 180,
  maxFrames = 720,
  threshold = FRAME_DIFF_THRESHOLD,
  staticLimit = STATIC_LIMIT,
  hookWindow = 3,
  cropBottom = 0
} = {}) {
  const { frames } = sampleFrames(videoPath, { fps, width, height, maxFrames, cropBottom });
  if (frames.length < 2) {
    return {
      sampled: frames.length, fps, threshold, duration: 0,
      staticSpans: [], overLimit: [], longestStatic: null,
      hookChanges: 0, activeRatio: 0, firstFrameLuma: null, maxDiff: 0
    };
  }

  const lumas = frames.map((f) => toLuma(f.rgb));
  const diffs = new Array(lumas.length).fill(null);
  let activeCount = 0;
  for (let i = 1; i < lumas.length; i++) {
    const d = meanAbsDiff(lumas[i - 1], lumas[i]);
    diffs[i] = d;
    if (d >= threshold) activeCount++;
  }

  // 把连续“低差异”的采样点合成静止区段
  const staticSpans = [];
  let runStart = null;
  for (let i = 1; i < lumas.length; i++) {
    if (diffs[i] < threshold) {
      if (runStart === null) runStart = i;
    } else if (runStart !== null) {
      const start = runStart / fps;
      const end = i / fps;
      staticSpans.push({ start, end, duration: end - start });
      runStart = null;
    }
  }
  if (runStart !== null) {
    const start = runStart / fps;
    const end = lumas.length / fps;
    staticSpans.push({ start, end, duration: end - start });
  }
  staticSpans.sort((a, b) => b.duration - a.duration);

  const hookSamples = Math.min(lumas.length, Math.ceil(hookWindow * fps));
  const hookChanges = diffs.slice(1, hookSamples)
    .filter((d) => d !== null && d >= threshold).length;

  const firstFrameLuma = lumas[0].reduce((s, v) => s + v, 0) / lumas[0].length;
  const maxDiff = Math.max(...diffs.filter((d) => d !== null));

  return {
    sampled: lumas.length,
    fps,
    threshold,
    duration: lumas.length / fps,
    activeRatio: activeCount / Math.max(1, lumas.length - 1),
    staticSpans: staticSpans.filter((s) => s.duration >= 1),
    overLimit: staticSpans.filter((s) => s.duration > staticLimit),
    longestStatic: staticSpans[0] || null,
    hookChanges,
    firstFrameLuma,
    maxDiff
  };
}

/**
 * 构图占屏分析：估算「主画面到底占了多大」。
 *
 * 背景是深色底，主体通常是亮色/高饱和的图形与文字。这里用亮度或色度阈值
 * 提取前景像素，聚成 16×9 的网格，再取活跃网格的外接框。
 * 外接框的宽或高占视口的比例，就是「主焦点占屏比」的近似值。
 *
 * 这不是像素级分割，只用于抓“主体缩在角落、大片死黑”这类系统性构图问题；
 * 结果只告警，不做硬失败。背景光晕如果很暗，会被阈值过滤掉。
 *
 * 返回：
 *   medianFocusSpan —— 有效帧的主体占屏比中位数（0–1）
 *   lowFocusRatio   —— 主体占屏 < FOCUS_MIN_SPAN 的有效帧占比
 *   medianActiveRatio —— 前景像素占比中位数（判断画面是否整体过空）
 */
const FOCUS_MIN_SPAN = 0.30;
const COMPOSITION_LUMA = 32;
const COMPOSITION_CHROMA = 40;
const COMPOSITION_ACTIVE_MIN = 0.005; // 低于 0.5% 前景视为黑场/纯背景帧
const GRID_COLS = 16;
const GRID_ROWS = 9;
const CELL_ACTIVE_RATIO = 0.08;

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function analyzeComposition(videoPath, {
  fps = 1,
  width = 320,
  height = 180,
  maxFrames = 300,
  cropBottom = 0
} = {}) {
  const sampled = sampleFrames(videoPath, { fps, width, height, maxFrames, cropBottom });
  const W = sampled.width;
  const H = sampled.height;
  const cellW = Math.ceil(W / GRID_COLS);
  const cellH = Math.ceil(H / GRID_ROWS);
  const cellMin = Math.max(1, Math.ceil(cellW * cellH * CELL_ACTIVE_RATIO));

  const frames = [];
  for (const f of sampled.frames) {
    const grid = new Uint32Array(GRID_COLS * GRID_ROWS);
    let active = 0;

    for (let y = 0; y < H; y++) {
      const cy = Math.min(GRID_ROWS - 1, Math.floor(y / cellH));
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 3;
        const r = f.rgb[o];
        const g = f.rgb[o + 1];
        const b = f.rgb[o + 2];
        const l = lum(r, g, b);
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        if (l >= COMPOSITION_LUMA || chroma >= COMPOSITION_CHROMA) {
          active++;
          const cx = Math.min(GRID_COLS - 1, Math.floor(x / cellW));
          grid[cy * GRID_COLS + cx]++;
        }
      }
    }

    let minCx = GRID_COLS;
    let minCy = GRID_ROWS;
    let maxCx = -1;
    let maxCy = -1;
    for (let cy = 0; cy < GRID_ROWS; cy++) {
      for (let cx = 0; cx < GRID_COLS; cx++) {
        if (grid[cy * GRID_COLS + cx] < cellMin) continue;
        if (cx < minCx) minCx = cx;
        if (cx > maxCx) maxCx = cx;
        if (cy < minCy) minCy = cy;
        if (cy > maxCy) maxCy = cy;
      }
    }

    const bboxW = maxCx >= minCx ? Math.min(W, (maxCx - minCx + 1) * cellW) : 0;
    const bboxH = maxCy >= minCy ? Math.min(H, (maxCy - minCy + 1) * cellH) : 0;
    const activeRatio = active / (W * H);
    frames.push({
      time: f.index / fps,
      activeRatio,
      bboxW,
      bboxH,
      focusSpan: Math.max(bboxW / W, bboxH / H)
    });
  }

  const valid = frames.filter((f) => f.activeRatio >= COMPOSITION_ACTIVE_MIN);
  const spans = valid.map((f) => f.focusSpan);
  const lowFocus = valid.filter((f) => f.focusSpan < FOCUS_MIN_SPAN).length;

  return {
    sampled: frames.length,
    valid: valid.length,
    fps,
    focusMinSpan: FOCUS_MIN_SPAN,
    medianFocusSpan: median(spans),
    medianActiveRatio: median(valid.map((f) => f.activeRatio)),
    lowFocusFrames: lowFocus,
    lowFocusRatio: valid.length ? lowFocus / valid.length : 0,
    frames
  };
}

module.exports = {
  analyzeVideo, analyzePacing, analyzeComposition, sampleFrames, sharpSteps, edgeBands,
  FRAME_DIFF_THRESHOLD, STATIC_LIMIT, FOCUS_MIN_SPAN
};
