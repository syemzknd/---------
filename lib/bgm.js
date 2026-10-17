'use strict';
/**
 * BGM 风格库与自动选曲。
 *
 * 脚本 meta.bgm_style 指定情绪风格；节点4 按下面的顺序找曲子：
 *   1) --bgm 显式指定（用户说了算）
 *   2) audio/bgm/<style>.<ext>、audio/bgm-<style>.<ext>、audio/<style>.<ext>
 *   3) audio/bgm/ 或 audio/ 下文件名命中风格关键词的音频
 *   4) 兜底 audio/bgm.mp3
 *   5) audio/bgm/ 里只放了一个音频文件时直接用它
 *
 * 只做“选曲”，不下载、不生成音乐；找不到就明确告警，避免静默出片。
 */
const fs = require('fs');
const path = require('path');

const AUDIO_EXTS = ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac', '.opus'];

const BGM_STYLES = {
  ambient_tech_tension: {
    label: '科技悬疑氛围',
    keywords: ['tech', 'ambient', 'tension', 'suspense', 'dark', 'pulse', 'cyber', '行科技', '科技']
  },
  ambient_calm: {
    label: '平静氛围',
    keywords: ['calm', 'ambient', 'soft', 'quiet', 'piano', 'warm', '平静']
  },
  lofi_focus: {
    label: 'Lo-fi 专注',
    keywords: ['lofi', 'lo-fi', 'focus', 'study', 'chill', 'beat', '专注']
  },
  cinematic_uplift: {
    label: '电影感上扬',
    keywords: ['cinematic', 'uplift', 'epic', 'inspire', 'hope', 'rise', '上扬']
  },
  news_urgent: {
    label: '新闻快报紧迫感',
    keywords: ['news', 'urgent', 'ticker', 'breaking', 'tense', '快报']
  },
  minimal_pulse: {
    label: '极简脉冲',
    keywords: ['minimal', 'pulse', 'click', 'clock', 'tick', '极简']
  }
};

const DEFAULT_BGM_STYLE = 'ambient_tech_tension';

function styleNames() {
  return Object.keys(BGM_STYLES);
}

function isKnownStyle(style) {
  return Object.prototype.hasOwnProperty.call(BGM_STYLES, String(style || ''));
}

function styleLabel(style) {
  const s = BGM_STYLES[String(style || '')];
  return s ? s.label : String(style || '');
}

function listAudioFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && AUDIO_EXTS.includes(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(dir, e.name));
}

/** 风格名 + 中英文关键词，用于文件名模糊匹配 */
function tokensFor(style) {
  const known = BGM_STYLES[String(style || '')];
  const base = String(style || '')
    .toLowerCase()
    .split(/[^a-z0-9一-龥]+/)
    .filter(Boolean);
  return [...new Set([...base, ...((known && known.keywords) || [])])];
}

function scoreFile(file, tokens) {
  const stem = path.basename(file, path.extname(file)).toLowerCase();
  let score = 0;
  for (const token of tokens) {
    const t = String(token || '').toLowerCase();
    if (!t) continue;
    if (stem === t) score += 10;
    else if (stem.includes(t)) score += 3;
  }
  return score;
}

/**
 * 解析本片该用哪首 BGM。
 * @returns {{
 *   path: string|null, exists: boolean, style: string, label: string,
 *   requestedStyle: string, source: string
 * }}
 */
function resolveBgm({ script, bgmArg, styleArg, cwd = process.cwd() } = {}) {
  const meta = (script && script.meta) || {};
  const requestedStyle = String(styleArg || meta.bgm_style || DEFAULT_BGM_STYLE).trim() || DEFAULT_BGM_STYLE;
  const style = requestedStyle;
  const info = {
    path: null,
    exists: false,
    style,
    label: styleLabel(style),
    requestedStyle,
    source: 'none'
  };

  // 1) 用户显式指定：即使文件不存在也返回路径，交给节点4 明确告警
  if (bgmArg && typeof bgmArg === 'string') {
    const p = path.resolve(cwd, bgmArg);
    return { ...info, path: p, exists: fs.existsSync(p), source: 'cli' };
  }

  const audioDir = path.resolve(cwd, 'audio');
  const bgmDir = path.join(audioDir, 'bgm');

  // 2) 按风格精确命名
  const exact = [];
  for (const ext of AUDIO_EXTS) {
    exact.push(path.join(bgmDir, style + ext));
    exact.push(path.join(audioDir, `bgm-${style}${ext}`));
    exact.push(path.join(audioDir, `${style}${ext}`));
  }
  for (const p of exact) {
    if (fs.existsSync(p)) return { ...info, path: p, exists: true, source: 'style-exact' };
  }

  // 3) 文件名命中风格关键词（例如 tech-suspense.mp3）
  const tokens = tokensFor(style);
  const scored = [
    ...listAudioFiles(bgmDir).map((p) => ({ p, score: scoreFile(p, tokens) })),
    ...listAudioFiles(audioDir).map((p) => ({ p, score: scoreFile(p, tokens) }))
  ]
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length) {
    return { ...info, path: scored[0].p, exists: true, source: 'style-keyword' };
  }

  // 4) 通用兜底
  const generic = path.join(audioDir, 'bgm.mp3');
  if (fs.existsSync(generic)) {
    return { ...info, path: generic, exists: true, source: 'generic' };
  }

  // 5) audio/bgm/ 只有一个文件时，用户的意图足够明确
  const leftover = listAudioFiles(bgmDir);
  if (leftover.length === 1) {
    return { ...info, path: leftover[0], exists: true, source: 'only-file' };
  }

  return info;
}

module.exports = {
  AUDIO_EXTS,
  BGM_STYLES,
  DEFAULT_BGM_STYLE,
  styleNames,
  isKnownStyle,
  styleLabel,
  tokensFor,
  resolveBgm,
  listAudioFiles
};
