'use strict';
/**
 * 产物命名：用脚本 meta.title 作为成片、无声视频与字幕的基名。
 *
 * 规则：
 *   - 去掉 Windows 文件名非法字符（<>:"/\|?*）与控制字符；
 *   - 保留中文、空格与常见标点，便于在资源管理器里辨认；
 *   - 去掉结尾的点和空格（Windows 不允许）；
 *   - 过长时按 Unicode 字符截断（不用 slice，避免劈开 emoji）；
 *   - 同名产物已存在时追加 _2、_3…，不覆盖历史成片。
 */
const fs = require('fs');
const path = require('path');

const INVALID_CHARS = /[\u0000-\u001f<>:"/\\|?*]/g;
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const MAX_BASE_CHARS = 80;

/** 把标题整理成可用的文件名基名 */
function sanitizeTitle(input, fallback = '未命名视频') {
  let s = String(input == null ? '' : input)
    .replace(INVALID_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  if (!s) s = fallback;
  if (RESERVED_NAMES.test(s)) s = '_' + s;

  const chars = [...s];
  if (chars.length > MAX_BASE_CHARS) {
    s = chars.slice(0, MAX_BASE_CHARS).join('').replace(/[. ]+$/g, '').trim();
  }
  return s || fallback;
}

/**
 * 从脚本推导基名：优先 meta.title，退回脚本文件名。
 * @param {object} script 已解析的 YAML
 * @param {string} scriptPath 脚本路径（用于兜底）
 * @param {string} [explicit] 命令行显式指定的名称
 */
function baseNameFromScript(script, scriptPath = '', explicit = '') {
  if (explicit) return sanitizeTitle(explicit);
  const title = script && script.meta && script.meta.title;
  const fallback = scriptPath
    ? path.basename(scriptPath, path.extname(scriptPath))
    : '未命名视频';
  return sanitizeTitle(title || fallback, fallback);
}

/** 一个基名会占用的配套文件（判断重名时一起看） */
function artifactPaths(dir, base) {
  return [
    path.join(dir, base + '.mp4'),
    path.join(dir, base + '_silent.mp4'),
    path.join(dir, base + '.audio.json')
  ];
}

/** 任一配套产物已存在，就认为该基名被占用 */
function isBaseTaken(dir, base) {
  return artifactPaths(dir, base).some((p) => fs.existsSync(p));
}

/**
 * 找一个不冲突的基名。默认覆盖同名（重跑同一标题时更新），
 * 传 unique=true 时才追加 _2、_3（用于“保存每一版成片”）。
 */
function resolveBaseName(dir, base, { unique = false } = {}) {
  if (!unique || !isBaseTaken(dir, base)) return base;
  let i = 2;
  let candidate = `${base}_${i}`;
  while (isBaseTaken(dir, candidate)) {
    i++;
    candidate = `${base}_${i}`;
  }
  return candidate;
}

/** 成片 / 无声视频 / 混音清单的标准路径 */
function outputPaths(dir, base) {
  return {
    base,
    video: path.join(dir, base + '.mp4'),
    silent: path.join(dir, base + '_silent.mp4'),
    manifest: path.join(dir, base + '.audio.json'),
    srt: path.join(dir, base + '.srt'),
    vtt: path.join(dir, base + '.vtt'),
    ass: path.join(dir, base + '.ass')
  };
}

module.exports = {
  MAX_BASE_CHARS,
  sanitizeTitle,
  baseNameFromScript,
  resolveBaseName,
  isBaseTaken,
  outputPaths
};
