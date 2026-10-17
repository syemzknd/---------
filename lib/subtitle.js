'use strict';
/**
 * 字幕产物（srt / vtt / ass）。
 *
 * 时间轴来源是 edge-tts 的 SentenceBoundary（逐句，非逐字）——实测中文可拿到
 * 每句的起点与时长，零额外依赖。逐字对齐需要 Whisper，本项目暂不引入。
 *
 * ASS 是「字随音动」的落点：节点4 用 ffmpeg 的 ass 滤镜把字幕烧进成片。
 * 关键词高亮来自脚本每个场景的 `highlight` 字段（词必须原样出现在旁白里）；
 * 关键词的弹跳时刻按它在句子里的字符位置按比例估算——没有逐字时间戳，
 * 但比整句一起出现更贴近语速，且完全确定性、不需要额外模型。
 */

/** 解析 SRT 文本 → [{ start, end, text }]，时间单位为秒 */
function parseSrt(text) {
  const cues = [];
  if (!text) return cues;
  const blocks = String(text).replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti === -1) continue;
    const m = lines[ti].match(
      /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/
    );
    if (!m) continue;
    const toSec = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000;
    const body = lines.slice(ti + 1).join('\n').trim();
    if (!body) continue;
    cues.push({
      start: toSec(m[1], m[2], m[3], m[4]),
      end: toSec(m[5], m[6], m[7], m[8]),
      text: body
    });
  }
  return cues;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

function stamp(sec, sep) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(ss)}${sep}${pad(ms, 3)}`;
}

/** 把各段 SRT 的 cue 平移 start 秒后合并、按时间排序，并去掉重叠 */
function offsetAndMerge(segmentCues) {
  const all = [];
  for (const { cues, start } of segmentCues) {
    for (const c of cues) {
      // 保留 cue 上的 highlights / role / emotion，后续 ASS 要用
      all.push({ ...c, start: c.start + start, end: c.end + start });
    }
  }
  all.sort((a, b) => a.start - b.start);

  // 相邻字幕重叠会让播放器闪烁；把前一条的结束时间收紧到下一条开始之前
  for (let i = 0; i < all.length - 1; i++) {
    if (all[i].end > all[i + 1].start) {
      all[i].end = Math.max(all[i].start + 0.2, all[i + 1].start - 0.02);
    }
  }
  return all;
}

function toSrt(cues) {
  return cues
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`)
    .join('\n');
}

function toVtt(cues) {
  const head = 'WEBVTT\n\n';
  return head + cues
    .map((c, i) => `${i + 1}\n${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// ASS（带关键词高亮与弹跳缩放）
// ---------------------------------------------------------------------------

const ASS_DEFAULTS = {
  width: 1920,
  height: 1080,
  fontSize: 62,
  // libass 按字体族名匹配；Windows 上微软雅黑最稳
  fontName: process.platform === 'win32' ? 'Microsoft YaHei' : 'PingFang SC',
  marginV: 96,
  marginLR: 120,
  maxCharsPerLine: 18,
  highlightColor: '#fcd34d', // 荧光黄
  warningColor: '#ef4444'    // 警示红（情绪峰值）
};

// 没有显式 highlight 时的兜底词库：旧脚本也能有高亮，不至于全白
const FALLBACK_KEYWORDS = [
  '时间', '拖延', '计划', '效率', '焦虑', '专注', '手机', '截止',
  '工作', '大脑', '注意力', '睡眠', '行动', '目标', '选择', '习惯',
  '进度', '截止日期', '优先级', '精力'
];

const PEAK_ROLES = new Set(['顿悟', '反转', '奇观', '金句']);
const PEAK_EMOTIONS = new Set(['顿悟', '金句']);

/** #RRGGBB → ASS &HBBGGRR& */
function toAssColor(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '&HFFFFFF&';
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}

/** 秒 → ASS 时间 0:00:00.00（厘秒） */
function assTime(sec) {
  const totalCs = Math.round(Math.max(0, Number(sec) || 0) * 100);
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor(totalCs / 6000) % 60;
  const s = Math.floor(totalCs / 100) % 60;
  const cs = totalCs % 100;
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ASS 纯文本转义。中文旁白里几乎不会出现 {} 或 \，
 * 但一旦出现会被当成 override tag，所以换成全角，宁可字形略变也不让字幕解析崩掉。
 */
function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, '＼')
    .replace(/\{/g, '｛')
    .replace(/\}/g, '｝')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const s = String(item || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * 决定这一句字幕要高亮哪些词。
 * 优先用脚本里的 scene.highlight；没有或一个都没命中的，退回到数字 + 兜底词库。
 */
function pickHighlights(text, provided) {
  const words = Array.isArray(provided)
    ? provided
    : (provided ? [provided] : []);
  const matched = dedupe(words).filter((w) => text.includes(w));
  if (matched.length) return matched.slice(0, 3);

  const numbers = text.match(/\d+(?:\.\d+)?%?/g) || [];
  const lexicon = FALLBACK_KEYWORDS.filter((w) => text.includes(w));
  return dedupe([...numbers, ...lexicon]).slice(0, 3);
}

/**
 * 字符的“发音时间权重”。
 *
 * 没有逐字时间戳时，用“字符数 / 总字数”估算关键词出现时刻，会把标点当成
 * 和汉字一样长，导致关键词总是比真实发音晚到。按 TTS 的实际停顿规律加权：
 * 逗号≈1.8 个字的时长，句号/问号≈2.6 个字的时长，空格≈0.6 个字。
 * 这是经验模型，但比纯字数比例更贴近真实语流，且完全确定性。
 */
const PAUSE_WEIGHT = {
  '，': 1.8, '、': 1.5, '；': 2.0, '：': 1.8,
  ',': 1.4, ';': 1.8, ':': 1.6,
  '。': 2.6, '！': 2.6, '？': 2.6,
  '.': 2.2, '!': 2.2, '?': 2.2,
  '…': 2.0, '—': 1.5
};

function textWeight(text) {
  let w = 0;
  for (const ch of String(text || '')) {
    if (/\s/.test(ch)) w += 0.6;
    else w += PAUSE_WEIGHT[ch] || 1;
  }
  return w;
}

/** 按标点/长度把一句话折成多行；ASS 用 \N 显式换行，避免自动换行不可控 */
function wrapLines(text, maxChars) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  const lines = [];
  let rest = clean;
  while (rest.length > maxChars) {
    let cut = -1;
    const minCut = Math.max(4, Math.floor(maxChars * 0.55));
    for (let i = Math.min(maxChars, rest.length - 1); i >= minCut; i--) {
      if (/[，。、！？；：,.!?;:]/.test(rest[i - 1])) {
        cut = i;
        break;
      }
    }
    if (cut === -1) cut = maxChars;
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) lines.push(rest);
  return lines.filter((l) => l.length).slice(0, 3);
}

/** 把一行拆成普通片段 / 高亮片段 */
function buildRuns(line, keywords) {
  const kws = dedupe(keywords)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!kws.length) return [{ text: line, keyword: false }];

  const pattern = new RegExp(kws.map(escapeRegExp).join('|'), 'g');
  const runs = [];
  let last = 0;
  let m;
  while ((m = pattern.exec(line)) !== null) {
    if (m.index > last) runs.push({ text: line.slice(last, m.index), keyword: false });
    runs.push({ text: m[0], keyword: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last), keyword: false });
  return runs.length ? runs : [{ text: line, keyword: false }];
}

function isPeak(cue) {
  return PEAK_ROLES.has(String(cue.role || '')) ||
    PEAK_EMOTIONS.has(String(cue.emotion || ''));
}

/**
 * 生成 ASS 字幕。
 *
 * cues: [{ start, end, text, highlights?, role?, emotion? }]
 * 每句字幕：
 *   - 入场：淡入 + 轻微放大回弹（ease 曲线由 \t 分段近似）
 *   - 关键词：荧光黄/警示红，按字符位置估算延迟后弹跳 14% 再回落
 *   - 位置：底部居中，MarginV=96，给竖屏安全区留余地
 */
function toAss(cues, options = {}) {
  const o = { ...ASS_DEFAULTS, ...options };
  const marginV = Number(o.marginV) || ASS_DEFAULTS.marginV;

  const header = [
    '[Script Info]',
    '; Generated by 自动化产出简易视频 / lib/subtitle.js',
    'ScriptType: v4.00+',
    `PlayResX: ${o.width}`,
    `PlayResY: ${o.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${o.fontName},${o.fontSize},&H00FFFFFF,&H000000FF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,3,2,2,${o.marginLR},${o.marginLR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ].join('\n');

  const events = [];
  for (const cue of cues) {
    const text = String(cue.text || '').trim();
    if (!text) continue;

    const duration = Math.max(0.2, Number(cue.end) - Number(cue.start));
    const highlights = pickHighlights(text, cue.highlights);
    const lines = wrapLines(text, o.maxCharsPerLine);
    const totalWeight = Math.max(1, textWeight(lines.join('')));
    const keyColor = isPeak(cue) ? o.warningColor : o.highlightColor;

    let globalWeight = 0;
    const renderedLines = lines.map((line, lineIndex) => {
      const runs = buildRuns(line, highlights);
      let out = '';
      if (lineIndex === 0) {
        // 整句入场：淡入 + 0.18s 放大到 102% + 0.12s 回到 100%
        out += '{\\fad(120,100)\\fscx92\\fscy92\\t(0,180,\\fscx102\\fscy102)\\t(180,300,\\fscx100\\fscy100)}';
      }
      let lineWeight = 0;
      for (const run of runs) {
        if (run.keyword) {
          // 关键词出现时刻 = 它在整句里的“加权字符位置”比例 × 句子时长。
          // 标点处有停顿，把标点按更长的时长计入，卡点比纯字数比例更贴近语流。
          const ratio = (globalWeight + lineWeight) / totalWeight;
          const delay = Math.max(0, Math.min(
            Math.round(duration * 1000) - 320,
            Math.round(ratio * duration * 1000)
          ));
          out += `{\\c${toAssColor(keyColor)}\\t(${delay},${delay + 140},\\fscx114\\fscy114)` +
            `\\t(${delay + 140},${delay + 280},\\fscx100\\fscy100)}` +
            escapeAssText(run.text) +
            // 显式把颜色和缩放都还原，避免关键词的 \t 状态泄漏到后面的普通文字
            '{\\c&HFFFFFF&\\fscx100\\fscy100}';
        } else {
          out += escapeAssText(run.text);
        }
        lineWeight += textWeight(run.text);
      }
      globalWeight += textWeight(line);
      return out;
    });

    const body = renderedLines.join('\\N');
    events.push(
      `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${body}`
    );
  }

  return header + '\n' + events.join('\n') + '\n';
}

module.exports = {
  parseSrt,
  offsetAndMerge,
  toSrt,
  toVtt,
  toAss,
  assTime,
  toAssColor,
  pickHighlights,
  wrapLines,
  textWeight
};
