'use strict';
/**
 * Jamendo 自动选曲。
 *
 * 背景：主流商业歌曲（包括剪映曲库里的同名单曲）没有可编程下载接口，
 * 脚本里由模型给出的「歌曲 + 片段」只能作为参考元数据；实际音轨从
 * Jamendo 的 Creative Commons 曲库里找同情绪、同器乐编制的授权替代曲。
 *
 * 流程：
 *   1) 从 meta.bgm 取 jamendo_query / fallback_queries / mood / tags；
 *   2) 调 /v3.0/tracks/ 搜索，优先器乐、可商用（排除 NC）、可下载；
 *   3) 下载 mp3 到 audio/bgm/jamendo-<id>.mp3（按 id 缓存）；
 *   4) 按参考片段的起点，为视频挑一个合适的切入位置。
 *
 * 需要免费 Client ID：https://devportal.jamendo.com/
 * 配置环境变量 JAMENDO_CLIENT_ID，或用 --jamendo-client-id 传入。
 */
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./util');
const { styleLabel, tokensFor, DEFAULT_BGM_STYLE } = require('./bgm');
const { sanitizeTitle } = require('./naming');

// 允许用环境变量指向本地 mock，便于离线测试；生产环境保持官方地址
const API_BASE = process.env.JAMENDO_API_BASE || 'https://api.jamendo.com/v3.0/tracks/';
const DEFAULT_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 60000;

function getClientId(explicit) {
  return String(explicit || process.env.JAMENDO_CLIENT_ID || '').trim();
}

/** "01:23" / "1:02:03" / 83 / "83s" → 秒 */
function parseClock(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  const parts = s.split(':').map(Number);
  if (parts.every((n) => Number.isFinite(n))) {
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  const m = s.match(/^([\d.]+)\s*s?$/i);
  return m ? Number(m[1]) : null;
}

/** 秒 → "mm:ss" */
function formatClock(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** 把脚本里的推荐字段整理成最多 4 条搜索词（按优先级） */
function buildQueries(meta = {}) {
  const bgm = meta.bgm || {};
  const raw = [
    bgm.jamendo_query,
    ...(Array.isArray(bgm.fallback_queries) ? bgm.fallback_queries : []),
    ...(Array.isArray(bgm.queries) ? bgm.queries : []),
    ...(Array.isArray(bgm.jamendo_queries) ? bgm.jamendo_queries : [])
  ];
  if (bgm.mood) raw.push(String(bgm.mood));
  if (Array.isArray(bgm.jamendo_tags) && bgm.jamendo_tags.length) {
    raw.push(bgm.jamendo_tags.join(' '));
  }
  // 最后兜底：脚本风格名对应的关键词（例如 dark ambient tension）
  raw.push(...tokensFor(meta.bgm_style || DEFAULT_BGM_STYLE).slice(0, 4));

  const out = [];
  for (const q of raw) {
    const s = String(q == null ? '' : q).replace(/\s+/g, ' ').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 4);
}

function collectTags(meta = {}) {
  const bgm = meta.bgm || {};
  const tags = [
    ...(Array.isArray(bgm.jamendo_tags) ? bgm.jamendo_tags : []),
    ...(Array.isArray(bgm.tags) ? bgm.tags : [])
  ]
    .map((t) => String(t || '').toLowerCase().replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean);
  if (bgm.instrumental) tags.push('instrumental');
  return [...new Set(tags)].slice(0, 5);
}

/** 解析 CC 授权：NC（非商业）直接排除，ND 只降权 */
function readLicense(track) {
  const url = String(track.license_ccurl || track.license_url || '');
  const m = url.match(/creativecommons\.org\/licenses\/([a-z-]+)/i);
  const code = (m ? m[1] : '').toLowerCase();
  const nc = /(^|-)nc($|-)/.test(code) || /\/nc\//i.test(url);
  const nd = /(^|-)nd($|-)/.test(code) || /\/nd\//i.test(url);
  let label = '未标注';
  if (code) label = `CC ${code.toUpperCase()}`;
  else if (url) label = 'Jamendo 授权（以曲目页为准）';

  return {
    url,
    code,
    nc,
    nd,
    commercial: !nc,
    attributionRequired: !!url,
    label
  };
}

function normalizeTrack(t) {
  return {
    id: String(t.id || ''),
    name: String(t.name || ''),
    artist: String(t.artist_name || ''),
    album: String(t.album_name || ''),
    duration: Number(t.duration) || 0,
    audio: String(t.audio || ''),
    downloadUrl: String(t.audiodownload || t.audio || ''),
    downloadAllowed: t.audiodownload_allowed !== false,
    shareUrl: String(t.shareurl || ''),
    license: readLicense(t),
    instrumental: String((t.musicinfo && t.musicinfo.vocalinstrumental) || '').toLowerCase() === 'instrumental',
    tags: [
      ...(((t.musicinfo || {}).tags || {}).genres || []),
      ...(((t.musicinfo || {}).tags || {}).vartags || [])
    ].map((x) => String(x).toLowerCase())
  };
}

async function fetchJson(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'auto-video-project/1.0 (BGM resolver)' }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const status = data && data.headers && data.headers.status;
    if (status && status !== 'success') {
      const msg = (data.headers && data.headers.error_message) || '未知错误';
      throw new Error(`Jamendo API 返回失败：${msg}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 按多条查询搜索并合并去重。
 * @returns {Promise<{tracks: object[], errors: string[], queries: string[]}>}
 */
async function searchJamendo({
  clientId, queries, tags = [], instrumental = true,
  limit = 12, timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const tracks = new Map();
  const errors = [];
  const usedQueries = [];

  for (const q of queries) {
    usedQueries.push(q);
    const base = {
      client_id: clientId,
      format: 'json',
      limit: String(limit),
      search: q,
      include: 'musicinfo licenses',
      audioformat: 'mp32',
      audiodlformat: 'mp32',
      order: 'relevance'
    };
    if (tags.length) base.fuzzytags = tags.join('+');

    const tryOnce = async (withInstrumental) => {
      const params = { ...base };
      if (withInstrumental) params.vocalinstrumental = 'instrumental';
      const url = new URL(API_BASE);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      return fetchJson(url, timeoutMs);
    };

    try {
      let data;
      try {
        data = await tryOnce(instrumental);
      } catch (err) {
        // 某些 API 版本不认识 vocalinstrumental，参数被拒时去掉后重试一次
        if (instrumental && /HTTP 400|vocalinstrumental/i.test(String(err.message))) {
          data = await tryOnce(false);
        } else {
          throw err;
        }
      }
      for (const raw of (data.results || [])) {
        const t = normalizeTrack(raw);
        if (!t.id || !t.downloadUrl || !t.downloadAllowed) continue;
        if (t.license.nc) continue; // 非商业授权不适合可能投稿/变现的成片
        if (!tracks.has(t.id)) tracks.set(t.id, t);
      }
    } catch (err) {
      errors.push(`${q}：${err && err.message ? err.message : err}`);
    }

    // 已经有足够多可商用候选就不再发后续请求
    if (tracks.size >= Math.max(6, limit / 2)) break;
  }

  return { tracks: [...tracks.values()], errors, queries: usedQueries };
}

function scoreTrack(t, { videoDuration = 45, tags = [] } = {}) {
  let score = 0;
  if (t.instrumental) score += 8;
  if (t.license.commercial) score += 5;
  if (!t.license.nd) score += 2;
  if (t.duration >= videoDuration) score += 2;
  if (t.duration >= 60) score += 1;
  const overlap = t.tags.filter((x) => tags.includes(x)).length;
  score += Math.min(4, overlap);
  return score;
}

function pickStartOffset(referenceStart, trackDuration, videoDuration) {
  const start = Number(referenceStart);
  if (!Number.isFinite(start) || start <= 0) return 0;
  if (!trackDuration || trackDuration <= 0) return start;
  const usable = Math.max(0, trackDuration - Math.min(videoDuration || 45, trackDuration));
  return Math.max(0, Math.min(start, usable));
}

async function downloadTrack(track, { cwd = process.cwd(), timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  const dir = ensureDir(path.join(cwd, 'audio', 'bgm'));
  const file = path.join(dir, `jamendo-${sanitizeTitle(track.id, 'track')}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 10 * 1024) return file;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(track.downloadUrl, {
      signal: ac.signal,
      headers: { 'User-Agent': 'auto-video-project/1.0 (BGM resolver)' }
    });
    if (!res.ok) throw new Error(`下载 BGM 失败 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10 * 1024) throw new Error('下载的音频过小，疑似失败');
    const tmp = file + '.part';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
    return file;
  } finally {
    clearTimeout(timer);
  }
}

function referenceText(reference = {}) {
  const song = reference.song || reference.reference_song || reference.title || '';
  const artist = reference.artist || reference.reference_artist || '';
  const version = reference.version || reference.reference_version || '原版';
  const start = reference.segment_start || '';
  const end = reference.segment_end || '';
  const cue = reference.lyric_cue || reference.reference_cue || '';
  const head = [song, artist].filter(Boolean).join(' — ') || '未注明参考曲';
  const seg = start || end ? `，${start || '?'}–${end || '?'}` : '';
  const cueText = cue ? `，${cue}` : '';
  return `${head}（${version}${seg}${cueText}）`;
}

function buildAttribution(track) {
  const lic = track.license;
  const where = track.shareUrl || `https://www.jamendo.com/track/${track.id}`;
  return `${track.name} — ${track.artist}（${lic.label}${lic.url ? '，' + lic.url : ''}，来源 Jamendo：${where}）`;
}

/**
 * 主入口：按脚本 BGM 推荐搜索、打分、下载。
 * 没有任何可用结果时返回 null（由调用方回退本地选曲）。
 *
 * @returns {Promise<null | {
 *   path: string, exists: true, source: 'jamendo', style: string, label: string,
 *   startOffset: number, reference: object, track: object, license: object,
 *   attribution: string, query: string
 * }>}
 */
async function resolveJamendoBgm({
  script, clientId, videoDuration = 45, cwd = process.cwd(),
  limit = 12, timeoutMs = DEFAULT_TIMEOUT_MS, onLog = () => {}
} = {}) {
  const id = getClientId(clientId);
  if (!id) return null;

  const meta = (script && script.meta) || {};
  const bgm = meta.bgm || {};
  const queries = buildQueries(meta);
  const tags = collectTags(meta);
  const referenceStart = parseClock(bgm.segment_start);
  const wantInstrumental = bgm.instrumental !== false;

  onLog(`Jamendo 搜索：${queries.join(' / ')}`);
  const { tracks, errors, queries: used } = await searchJamendo({
    clientId: id,
    queries,
    tags,
    instrumental: wantInstrumental,
    limit,
    timeoutMs
  });

  if (!tracks.length) {
    const detail = errors.length ? errors.join('；') : '没有可商用/可下载的匹配曲目';
    throw new Error(`Jamendo 未找到可用 BGM（${detail}）`);
  }

  const ranked = tracks
    .map((t) => ({ track: t, score: scoreTrack(t, { videoDuration, tags }) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  let lastErr = null;
  for (const { track } of ranked) {
    try {
      const file = await downloadTrack(track, { cwd });
      const useVocal = wantInstrumental && !track.instrumental;
      if (useVocal) {
        onLog(`注意：${track.name} 未标注为器乐，可能有人声，已按评分次选使用。`);
      }
      const startOffset = pickStartOffset(referenceStart, track.duration, videoDuration);
      const reference = {
        ...bgm,
        segment_start: bgm.segment_start || (referenceStart != null ? formatClock(referenceStart) : ''),
        text: referenceText(bgm)
      };
      const style = String(meta.bgm_style || DEFAULT_BGM_STYLE);
      return {
        path: file,
        exists: true,
        source: 'jamendo',
        style,
        label: styleLabel(style),
        startOffset,
        reference,
        track: {
          id: track.id,
          name: track.name,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          shareUrl: track.shareUrl,
          instrumental: track.instrumental,
          tags: track.tags
        },
        license: track.license,
        attribution: buildAttribution(track),
        query: used[used.length - 1] || queries[0] || ''
      };
    } catch (err) {
      lastErr = err;
      onLog(`下载失败，尝试下一首：${err && err.message ? err.message : err}`);
    }
  }

  throw lastErr || new Error('Jamendo 候选曲目均无法下载');
}

module.exports = {
  API_BASE,
  getClientId,
  parseClock,
  formatClock,
  buildQueries,
  collectTags,
  searchJamendo,
  resolveJamendoBgm,
  readLicense,
  referenceText
};
