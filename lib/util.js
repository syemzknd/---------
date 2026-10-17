'use strict';
/**
 * 公共工具：参数解析、日志、外部命令探测、ffprobe 探测。
 * 被 node2 / render / audio / qa / main 复用，避免每个脚本各抄一份。
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

const info = (m) => console.log(`${C.cyan}${m}${C.reset}`);
const ok = (m) => console.log(`${C.green}✓${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}!${C.reset} ${m}`);
const fail = (m) => console.error(`${C.red}✗${C.reset} ${m}`);
const dim = (m) => console.log(`${C.dim}${m}${C.reset}`);

/** 解析 --key value / --flag；返回 { key: 'value' | true } */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[k] = next;
        i++;
      } else {
        out[k] = true;
      }
    }
  }
  return out;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 内部：带 shell 执行并捕获，供探测命令用（不打印、不抛错） */
function tryExec(cmd) {
  const r = spawnSync(cmd, {
    shell: true,
    stdio: 'pipe',
    encoding: 'utf8',
    windowsHide: true
  });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

function hasCommand(cmd) {
  return tryExec(`${cmd} --version`) !== null || tryExec(`where ${cmd}`) !== null;
}

/** 在 PATH 上找可用的 ffmpeg / ffprobe */
function ffmpegBin() {
  return process.env.FFMPEG_BIN || 'ffmpeg';
}
function ffprobeBin() {
  return process.env.FFPROBE_BIN || 'ffprobe';
}

/** 同步执行并回显（用于渲染/编码这类需要实时看进度的命令） */
function run(cmd, opts = {}) {
  console.log(`${C.dim}$ ${cmd}${C.reset}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

/** 探测媒体文件时长（秒），失败返回 null */
function probeDuration(file) {
  try {
    const out = execSync(
      `${ffprobeBin()} -v error -show_entries format=duration -of csv=p=0 "${file}"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const n = parseFloat(String(out).trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** 用 ffprobe 读 JSON 元信息 */
function probeJson(file) {
  try {
    const out = execSync(
      `${ffprobeBin()} -v error -print_format json -show_format -show_streams "${file}"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * 定位可用的 edge-tts。
 * 关键：Windows 上 `python`/`pip` 常被 Microsoft Store 的 0 字节占位符劫持，
 * 且 pip 装出来的 edge-tts.exe 落在 Python\Scripts 下、往往不在 PATH 上。
 * 所以这里按可靠性排序逐个探测，最后退回 `py -3 -m edge_tts`（模块方式调用）。
 */
function resolveTts() {
  if (process.env.EDGE_TTS_CMD) {
    const parts = process.env.EDGE_TTS_CMD.split(' ').filter(Boolean);
    if (tryExec(`${process.env.EDGE_TTS_CMD} --version`) !== null) {
      return { parts, label: process.env.EDGE_TTS_CMD, source: 'EDGE_TTS_CMD' };
    }
    warn(`EDGE_TTS_CMD 指定的命令不可用：${process.env.EDGE_TTS_CMD}`);
  }

  const candidates = [
    ['edge-tts'],
    ['py', '-3', '-m', 'edge_tts'],
    ['python3', '-m', 'edge_tts'],
    ['python', '-m', 'edge_tts']
  ];
  for (const parts of candidates) {
    const cmd = parts.join(' ');
    if (tryExec(`${cmd} --version`) !== null) {
      return { parts, label: cmd, source: parts.length === 1 ? 'PATH' : 'python -m' };
    }
  }
  return null;
}

/** 把参数数组 + 附加参数拼成一条带引号的命令字符串 */
function buildCmd(parts, args) {
  const quote = (s) => (/[\s"]/.test(String(s)) ? `"${String(s).replace(/"/g, '\\"')}"` : String(s));
  return [...parts, ...args].map(quote).join(' ');
}

/** 剥离 AI 输出外层的 ```html 代码块围栏 */
function stripCodeFence(text) {
  let t = String(text || '').trim();
  // 去掉 ```html / ``` 开头（允许前面有说明文字的情况在后面单独处理）
  t = t.replace(/^```[a-zA-Z]*\s*\n?/, '');
  t = t.replace(/\n?```\s*$/, '');
  t = t.trim();

  // 模型偶尔会在代码块前后多写几句解释，这里按标签裁剪到真正的 HTML 范围
  const start = t.search(/<!DOCTYPE\s+html|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  const end = t.lastIndexOf('</html>');
  if (end !== -1) t = t.slice(0, end + '</html>'.length);
  return t.trim();
}

function readYamlScript(file) {
  const yaml = require('js-yaml');
  if (!fs.existsSync(file)) return null;
  return yaml.load(fs.readFileSync(file, 'utf8'));
}

/** 秒 → mm:ss */
function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function humanSize(bytes) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)}${u[i]}`;
}

/** 统计目录占用（用于提示 frames/ 的体积） */
function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    total += st.isDirectory() ? dirSize(p) : st.size;
  }
  return total;
}

module.exports = {
  C,
  info,
  ok,
  warn,
  fail,
  dim,
  parseArgs,
  ensureDir,
  hasCommand,
  ffmpegBin,
  ffprobeBin,
  run,
  probeDuration,
  probeJson,
  resolveTts,
  buildCmd,
  stripCodeFence,
  readYamlScript,
  fmtTime,
  humanSize,
  dirSize,
  tryExec
};
