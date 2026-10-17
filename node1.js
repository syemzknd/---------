#!/usr/bin/env node
'use strict';
/**
 * 节点1：用 DeepSeek 生成「选题 / 视频脚本 / 拆书知识点 / 知识点脚本」。
 *
 * 四种用法：
 *   node node1.js --topics "二进制"                  → output/topics.md（10 个选题）
 *   node node1.js --topic "计算机差点不用二进制"      → script.yaml（视频脚本）
 *   node node1.js --extract 某本书.txt               → output/points.md（拆书知识点）
 *   node node1.js --book output/points.md --index 1  → script.yaml（把知识点写成脚本）
 *
 * 鉴权：读取环境变量 DEEPSEEK_API_KEY（必需）。
 * 可选环境变量：DEEPSEEK_MODEL、DEEPSEEK_BASE_URL、DEEPSEEK_MAX_TOKENS。
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { info, ok, warn, fail, dim, parseArgs, ensureDir } = require('./lib/util');
const { callDeepSeek, resolveOptions } = require('./lib/deepseek');
const { DEFAULT_BGM_STYLE, isKnownStyle, styleNames } = require('./lib/bgm');
const { parseClock } = require('./lib/jamendo');

const PROMPT_DIR = path.resolve(__dirname, 'prompts');
const MAX_MATERIAL_CHARS = 100000;

function readPrompt(name) {
  const file = path.join(PROMPT_DIR, name);
  if (!fs.existsSync(file)) {
    fail(`找不到提示词文件：${file}`);
    process.exit(1);
  }
  return fs.readFileSync(file, 'utf8');
}

/** 去掉模型可能加上的 ```yaml / ``` 围栏 */
function stripFence(text) {
  return String(text || '')
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

function writeOut(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n', 'utf8');
}

const TEXT_ONLY_TYPES = new Set(['title', 'subtitle', 'text', 'caption', 'formula', 'code']);
const ACT_ROLES = ['钩子', '共情', '拆解', '顿悟', '金句'];

const narrationChars = (s) =>
  String(s || '').replace(/[^一-龥a-zA-Z0-9]/g, '').length;

/** 元素时间窗覆盖检查：场景里不能被“没东西在动”的空窗填满 */
function findVisualGaps(scene, limitSec = 3.0) {
  const start = Number(scene.start);
  const end = Number(scene.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const els = Array.isArray(scene.elements) ? scene.elements : [];
  const intervals = els
    .map((el) => (el && Array.isArray(el.at) ? el.at.map(Number) : null))
    .filter((iv) => iv && iv.length >= 2 && iv.every(Number.isFinite))
    .map(([a, b]) => [Math.max(a, start), Math.min(b, end)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);

  const gaps = [];
  let cursor = start;
  for (const [a, b] of intervals) {
    if (a - cursor > limitSec) gaps.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (end - cursor > limitSec) gaps.push([cursor, end]);
  return gaps;
}

/**
 * 脚本内容自检：提示词是建议，这里把能机器判断的硬性要求查一遍。
 * 不阻断生成，只告警——模型偶尔会把 highlight 写错、把旁白写得太密。
 */
function validateScriptContent(script, requestedDuration) {
  const warnings = [];
  const meta = script.meta || {};
  const scenes = Array.isArray(script.scenes) ? script.scenes : [];
  const duration = Number(meta.duration || requestedDuration) || 0;

  if (!meta.golden_line) {
    warnings.push('缺少 meta.golden_line（金句），成片结尾少一个可截屏的传播点。');
  } else if ([...String(meta.golden_line)].length > 20) {
    warnings.push(`meta.golden_line 有 ${[...String(meta.golden_line)].length} 字，超过 20 字，不适合截屏。`);
  }
  if (!meta.visual_motif) {
    warnings.push('缺少 meta.visual_motif（视觉母题），渲染器可能每个场景换一套图形。');
  }

  // BGM 风格：节点4 会按这个值自动选曲；缺失时退回默认风格
  const bgmStyle = String(meta.bgm_style || '').trim();
  if (!bgmStyle) {
    warnings.push(
      `缺少 meta.bgm_style（BGM 风格），节点4 将默认使用 ${DEFAULT_BGM_STYLE}。` +
      `可选：${styleNames().join(' / ')}`
    );
  } else if (!isKnownStyle(bgmStyle)) {
    warnings.push(
      `meta.bgm_style「${bgmStyle}」不在推荐风格里（${styleNames().join(' / ')}），` +
      '节点4 只能按文件名关键词尝试匹配。'
    );
  }

  // BGM 具体推荐：模型必须说清参考歌曲、版本与片段，节点4 才能去 Jamendo 找替代曲。
  const bgm = meta.bgm;
  if (!bgm || typeof bgm !== 'object' || Array.isArray(bgm)) {
    warnings.push('缺少 meta.bgm（参考歌曲 + 具体片段 + Jamendo 检索词），只能按风格兜底选曲。');
  } else {
    const required = ['song', 'artist', 'version', 'segment_start', 'segment_end', 'lyric_cue'];
    const missing = required.filter((k) => !String(bgm[k] || '').trim());
    if (missing.length) {
      warnings.push(`meta.bgm 缺少字段：${missing.join('、')}；BGM 推荐要具体到歌名、版本和片段。`);
    }
    const start = parseClock(bgm.segment_start);
    const end = parseClock(bgm.segment_end);
    if (start === null) {
      warnings.push(`meta.bgm.segment_start「${bgm.segment_start || ''}」不是有效时间，应写成 mm:ss。`);
    }
    if (end === null) {
      warnings.push(`meta.bgm.segment_end「${bgm.segment_end || ''}」不是有效时间，应写成 mm:ss。`);
    }
    if (start !== null && end !== null) {
      if (end <= start) warnings.push('meta.bgm 的 segment_end 必须晚于 segment_start。');
      else if (end - start < 20) warnings.push(`meta.bgm 参考片段只有 ${Math.round(end - start)} 秒，建议至少 20 秒。`);
    }
    if (typeof bgm.instrumental !== 'boolean') {
      warnings.push('meta.bgm.instrumental 必须是 true / false，纯音乐要明确标 true。');
    }
    const bpm = Number(bgm.bpm);
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 220) {
      warnings.push(`meta.bgm.bpm「${bgm.bpm}」不是合理 BPM（40–220）。`);
    }
    const query = String(bgm.jamendo_query || '').trim();
    if (!query) {
      warnings.push('缺少 meta.bgm.jamendo_query，节点4 只能用风格词兜底搜索。');
    } else if (/[一-龥]/.test(query)) {
      warnings.push('meta.bgm.jamendo_query 应使用英文声音特征词，不要写中文或歌名。');
    }
    const fallback = bgm.fallback_queries;
    if (fallback !== undefined && !Array.isArray(fallback)) {
      warnings.push('meta.bgm.fallback_queries 必须是数组。');
    }
    if (bgm.jamendo_tags !== undefined && !Array.isArray(bgm.jamendo_tags)) {
      warnings.push('meta.bgm.jamendo_tags 必须是数组。');
    }
  }

  // 开头钩子：只允许三种策略，且不能踩禁用开场词
  const hookTypes = Array.isArray(meta.hook_type)
    ? meta.hook_type.join(' ')
    : String(meta.hook_type || '');
  if (!/极端假设|扎心拷问|预期反转/.test(hookTypes)) {
    warnings.push('meta.hook_type 不是「极端假设 / 扎心拷问 / 预期反转」，开头可能留不住人。');
  }
  const firstNarration = String((scenes[0] && scenes[0].narration) || '');
  if (/^(大家好|今天|本期|入门|简介|让我们|有没有想过)/.test(firstNarration.trim())) {
    warnings.push(`开场旁白使用了禁用词：「${firstNarration.slice(0, 12)}…」`);
  }
  if (!scenes.some((s) => String(s.role || '') === '金句')) {
    warnings.push('没有 role: 金句 的场景，meta.golden_line 可能没有真正出现在画面里。');
  }

  // 五幕必须齐：缺一幕，情绪曲线就断了
  if (scenes.length < 5) {
    warnings.push(`全片只有 ${scenes.length} 个场景，五幕情绪曲线不完整。`);
  }
  const roles = new Set(scenes.map((s) => String(s.role || '').trim()));
  const missingRoles = ACT_ROLES.filter((r) => !roles.has(r));
  if (missingRoles.length) {
    warnings.push(`缺少情绪幕：${missingRoles.join('、')}（role 必须是 钩子/共情/拆解/顿悟/金句）。`);
  }

  // 开场的机器可查部分
  const first = scenes[0] || {};
  if (String(first.role || '').trim() !== '钩子') {
    warnings.push('第一个场景的 role 不是「钩子」，开场可能不够抓人。');
  }
  const firstEnd = Number(first.end);
  if (Number.isFinite(firstEnd) && firstEnd > Math.max(6, duration * 0.12)) {
    warnings.push(`钩子场景持续到 ${firstEnd}s，太长；前 3–5 秒必须完成钩子。`);
  }
  const firstElements = Array.isArray(first.elements) ? first.elements : [];
  if (!firstElements.some((el) => el && !TEXT_ONLY_TYPES.has(String(el.type || '')))) {
    warnings.push('开场只有文字元素，没有图形/运动；第一帧不能是纯文字淡入。');
  }
  const earlyEvents = firstElements.filter((el) => {
    const at = el && Array.isArray(el.at) ? el.at.map(Number) : null;
    return at && Number.isFinite(at[0]) && at[0] <= 3;
  }).length;
  if (earlyEvents < 2) {
    warnings.push(`前 3 秒只有 ${earlyEvents} 个视觉事件，至少需要 2 个。`);
  }
  const firstSentence = String(firstNarration).split(/[。！？!?]/)[0].trim();
  const firstSentenceChars = narrationChars(firstSentence);
  if (firstSentenceChars > 18) {
    warnings.push(`开场第一句 ${firstSentenceChars} 字，超过 18 字，冲击力会被稀释。`);
  }

  // 语速：目标 3.2–3.5 字/秒。高于 3.5 来不及消化，低于 3.2 就是大段空白。
  // ±0.05 是估算容差：字数比例不等于 TTS 实际时长，差一个字不该报“大段空白”。
  const RATE_TOLERANCE = 0.05;
  const totalChars = scenes.reduce((n, s) => n + narrationChars(s.narration), 0);
  if (duration > 0 && totalChars > 0) {
    const rate = totalChars / duration;
    const targetMin = Math.ceil(duration * 3.2);
    const targetMax = Math.floor(duration * 3.5);
    if (rate > 3.5 + RATE_TOLERANCE) {
      warnings.push(
        `旁白密度 ${rate.toFixed(2)} 字/秒，高于 3.5；${duration} 秒建议 ${targetMin}–${targetMax} 字，` +
        `当前 ${totalChars} 字，需压缩 ${totalChars - targetMax} 字左右。`
      );
    } else if (rate < 3.2 - RATE_TOLERANCE) {
      warnings.push(
        `旁白密度 ${rate.toFixed(2)} 字/秒，低于目标 3.2；${duration} 秒建议 ${targetMin}–${targetMax} 字，` +
        `当前 ${totalChars} 字，还差 ${Math.max(0, targetMin - totalChars)} 字。旁白太稀会变成中段大段空白。`
      );
    }
  }

  // 每个场景的旁白要撑住自己的时长，不能靠静止画面硬熬
  for (const s of scenes) {
    const chars = narrationChars(s.narration);
    const sceneStart = Number(s.start);
    const sceneEnd = Number(s.end);
    if (!chars || !Number.isFinite(sceneStart) || !Number.isFinite(sceneEnd) || sceneEnd <= sceneStart) continue;
    const sceneDur = sceneEnd - sceneStart;
    const voiceEst = chars / 3.3 + 0.4;
    if (voiceEst < sceneDur * 0.6) {
      warnings.push(
        `场景 ${s.id || '?'} 预计配音只有 ${voiceEst.toFixed(1)}s，占场景 ${sceneDur}s 的 ` +
        `${Math.round((voiceEst / sceneDur) * 100)}%，画面后半段会空。`
      );
    }
  }

  // 场景时间必须首尾相接覆盖全片
  let cursor = 0;
  for (const s of scenes) {
    const start = Number(s.start);
    const end = Number(s.end);
    if (Number.isFinite(start) && Math.abs(start - cursor) > 0.05) {
      warnings.push(`场景 ${s.id || '?'} 从 ${start}s 开始，与上一场景结束 ${cursor}s 不相接。`);
    }
    if (!Number.isFinite(end) || end <= start) {
      warnings.push(`场景 ${s.id || '?'} 的 end 不合法（${s.end}）。`);
    } else {
      cursor = end;
    }
  }
  if (duration > 0 && Math.abs(cursor - duration) > 0.5) {
    warnings.push(`场景总时长 ${cursor}s，与 meta.duration ${duration}s 不一致。`);
  }

  // 旁白可读性：长句、连接词、结尾大词
  for (const s of scenes) {
    const text = String(s.narration || '').trim();
    if (!text) {
      warnings.push(`场景 ${s.id || '?'} 没有旁白，画面会变成默片。`);
      continue;
    }
    const sentences = text.split(/[。！？!?]+/).map((x) => x.trim()).filter(Boolean);
    const tooLong = sentences.find((x) => narrationChars(x) > 24);
    if (tooLong) {
      warnings.push(`场景 ${s.id || '?'} 有一句 ${narrationChars(tooLong)} 字，超过 20 字上限：「${tooLong.slice(0, 16)}…」`);
    }
    if (/^(首先|其次|然后|最后|因此|综上所述)/.test(text)) {
      warnings.push(`场景 ${s.id || '?'} 以连接词开头，删掉它会更像人话。`);
    }
    if (/我们可以看|不难发现|众所周知/.test(text)) {
      warnings.push(`场景 ${s.id || '?'} 使用了书面套话：「${text.match(/我们可以看|不难发现|众所周知/)[0]}」。`);
    }
  }
  const lastNarration = String((scenes[scenes.length - 1] || {}).narration || '').trim();
  if (/(世界|一切|力量|未来|全人类|宇宙)[。！？!?]?$/.test(lastNarration)) {
    warnings.push('结尾旁白落在大词上，最后一句要落回具体的人、身体或日常动作。');
  }

  // 视觉节奏：元素必须覆盖场景时间，不能被空窗拖住
  for (const s of scenes) {
    const els = Array.isArray(s.elements) ? s.elements : [];
    if (!els.length) {
      warnings.push(`场景 ${s.id || '?'} 没有任何 elements，渲染器将无内容可画。`);
      continue;
    }
    for (const gap of findVisualGaps(s)) {
      warnings.push(
        `场景 ${s.id || '?'} 在 ${gap[0].toFixed(1)}–${gap[1].toFixed(1)}s 没有任何元素，` +
        `会出现 ${(gap[1] - gap[0]).toFixed(1)}s 视觉空窗。`
      );
    }
    const noEase = els.filter((el) => el && el.motion && !el.easing);
    if (noEase.length) {
      warnings.push(`场景 ${s.id || '?'} 有 ${noEase.length} 个运动元素没写 easing，渲染器可能退回匀速。`);
    }
    const linear = els.filter((el) => el && /linear/i.test(String(el.easing || '')));
    if (linear.length) {
      warnings.push(`场景 ${s.id || '?'} 有 ${linear.length} 个元素使用 linear 缓动，禁止匀速。`);
    }
  }

  // 视觉聚焦：每个场景一个主焦点，且占屏比不能太小
  for (const s of scenes) {
    const els = Array.isArray(s.elements) ? s.elements : [];
    if (!els.length) continue;
    const focusEls = els.filter((el) => el && el.focus === true);
    if (focusEls.length === 0) {
      warnings.push(`场景 ${s.id || '?'} 没有标 focus: true 的主焦点元素，渲染时容易主体过小、视线发散。`);
    } else if (focusEls.length > 1) {
      warnings.push(`场景 ${s.id || '?'} 有 ${focusEls.length} 个 focus: true，同一时刻只能有一个主焦点。`);
    }
    for (const el of focusEls) {
      if (el.occupancy === undefined || el.occupancy === null) {
        warnings.push(`场景 ${s.id || '?'} 的主焦点没写 occupancy（建议 0.40–0.65，最低 0.30）。`);
        continue;
      }
      const occ = Number(el.occupancy);
      if (Number.isFinite(occ) && occ < 0.3) {
        warnings.push(`场景 ${s.id || '?'} 的主焦点 occupancy=${occ}，低于 0.30，画面会显得空、主体太小。`);
      }
    }
  }

  // 截屏级奇观必须真正落到元素上
  if (!meta.spectacle) {
    warnings.push('缺少 meta.spectacle（截屏级画面），成片少一个传播点。');
  } else if (!scenes.some((s) => (Array.isArray(s.elements) ? s.elements : [])
    .some((el) => el && el.spectacle === true))) {
    warnings.push('meta.spectacle 已写，但没有任何元素标 spectacle: true，渲染器不会重点处理。');
  }

  // highlight 必须原样出现在该场景旁白里，否则字幕高亮会落空
  for (const s of scenes) {
    const words = Array.isArray(s.highlight)
      ? s.highlight.map(String)
      : (s.highlight ? [String(s.highlight)] : []);
    if (!words.filter(Boolean).length) {
      warnings.push(`场景 ${s.id || '?'} 缺少 highlight（字幕关键词高亮会退回到数字/兜底词库）。`);
      continue;
    }
    if (words.filter(Boolean).length > 3) {
      warnings.push(`场景 ${s.id || '?'} 有 ${words.filter(Boolean).length} 个 highlight，超过 3 个，字幕会花。`);
    }
    const missing = words.filter((w) => w && !String(s.narration || '').includes(w));
    if (missing.length) {
      warnings.push(`场景 ${s.id || '?'} 的 highlight 词没出现在旁白里：${missing.join('、')}`);
    }
  }

  return warnings;
}

const HOOK_TYPE_NAMES = ['极端假设', '扎心拷问', '预期反转'];
const DAILY_LIFE_HINT = /生活|拖延|认知|效率|时间|注意力|决策|情绪|手机|睡眠|工作|通勤|社交|日历|闹钟|转账|购物|学习/;

/**
 * 选题列表自检：配额和字段能不能机器查，先查一遍。
 * 输出格式：选题名 | 选题类型 | 生活痛点映射 | 一句话核心 | 钩子类型 | 钩子 | 截屏级画面
 */
function validateTopicsContent(text) {
  const warnings = [];
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length !== 10) {
    warnings.push(`候选选题有 ${lines.length} 行，要求正好 10 行。`);
  }

  let daily = 0;
  let extreme = 0;
  let badField = 0;
  let longHook = 0;
  for (const line of lines) {
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length < 7) { badField++; continue; }
    const [type, pain, , hookType, hook] = [cols[1], cols[2], cols[3], cols[4], cols[5]];
    if (DAILY_LIFE_HINT.test(type + pain)) daily++;
    if (HOOK_TYPE_NAMES.some((t) => hookType.includes(t))) {
      if (hookType.includes('极端假设')) extreme++;
    } else {
      badField++;
    }
    // 钩子是念出来的：标点不占发音时长，不计入 18 字
    if (narrationChars(hook) > 18) longHook++;
  }

  if (lines.length === 10) {
    if (daily < 7) warnings.push(`生活相关选题只有 ${daily} 个，要求至少 7 个。`);
    if (extreme < 3) warnings.push(`「极端假设」钩子只有 ${extreme} 个，要求至少 3 个。`);
  }
  if (badField) warnings.push(`${badField} 行缺少字段或钩子类型不合法（必须是 极端假设/扎心拷问/预期反转）。`);
  if (longHook) warnings.push(`${longHook} 个钩子超过 18 字，第一句会被稀释。`);
  return warnings;
}

/** 把知识点 markdown 按 "## " 切成独立条目 */
function splitPoints(markdown) {
  const parts = markdown.split(/^##\s+/m).slice(1);
  if (parts.length === 0) return [{ title: '整份资料', body: markdown.trim() }];
  return parts.map((p) => {
    const lines = p.split('\n');
    return { title: lines[0].trim(), body: lines.join('\n').trim() };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const duration = Number(args.duration || 45);

  let mode = null;
  let systemPrompt = '';
  let userPrompt = '';
  let outPath = '';

  if (args.topics) {
    mode = 'topics';
    outPath = path.resolve(args.out || 'output/topics.md');
    systemPrompt = readPrompt('node1-topics.md');
    userPrompt =
      `领域 / 方向：${args.topics}\n` +
      `请按提示词输出 10 个候选选题。`;
  } else if (args.topic) {
    mode = 'script';
    outPath = path.resolve(args.out || 'script.yaml');
    systemPrompt = readPrompt('node1-script.md');
    userPrompt =
      `选题：${args.topic}\n` +
      `时长：${duration} 秒\n` +
      `分辨率：1920x1080，帧率：30fps\n\n` +
      `请写一条完整的视频脚本，只输出 YAML。`;
  } else if (args.extract) {
    mode = 'points';
    outPath = path.resolve(args.out || 'output/points.md');
    systemPrompt = readPrompt('node1-points.md');

    const materialFile = path.resolve(args.extract);
    if (!fs.existsSync(materialFile)) {
      fail(`找不到资料文件：${materialFile}`);
      process.exit(1);
    }
    let material = fs.readFileSync(materialFile, 'utf8').trim();
    if (material.length > MAX_MATERIAL_CHARS) {
      warn(`资料 ${material.length} 字，超过 ${MAX_MATERIAL_CHARS} 字，只取前 ${MAX_MATERIAL_CHARS} 字。`);
      dim('  超长书籍建议先按章节切分，再分批拆知识点。');
      material = material.slice(0, MAX_MATERIAL_CHARS);
    }
    if (!material) {
      fail('资料文件是空的。');
      process.exit(1);
    }
    userPrompt = `下面是要拆解的材料：\n\n<material>\n${material}\n</material>\n\n请按提示词拆出知识点。`;
  } else if (args.book) {
    mode = 'script';
    outPath = path.resolve(args.out || 'script.yaml');
    systemPrompt = readPrompt('node1-script.md') + '\n\n' + readPrompt('node1-point-script.md');

    const pointsFile = path.resolve(args.book);
    if (!fs.existsSync(pointsFile)) {
      fail(`找不到知识点文件：${pointsFile}`);
      process.exit(1);
    }
    const points = splitPoints(fs.readFileSync(pointsFile, 'utf8'));
    const index = Math.max(1, Math.min(points.length, Number(args.index || 1))) - 1;
    const point = points[index];

    info(`[节点1] 共 ${points.length} 个知识点，使用第 ${index + 1} 个：${point.title}`);
    userPrompt =
      `知识点：\n\n<point>\n## ${point.body}\n</point>\n\n` +
      `时长：${duration} 秒\n分辨率：1920x1080，帧率：30fps\n\n` +
      `把这个知识点写成一条完整的视频脚本，只输出 YAML。`;
  } else {
    fail('请指定一种模式。');
    console.error(`
用法：
  node node1.js --topics "领域/方向"        生成 10 个候选选题
  node node1.js --topic "选题"              根据选题写视频脚本
  node node1.js --extract 资料.txt          从资料里拆知识点
  node node1.js --book points.md --index 1  把某个知识点写成视频脚本

常用参数：
  --out <文件>       输出路径（默认见上）
  --duration <秒>    视频时长，默认 45
  --model <名称>     deepseek-v4-pro / deepseek-flash
`);
    process.exit(1);
  }

  const opts = resolveOptions(args, 16384);
  info(`[节点1] 模式：${{ topics: '生成选题', script: '生成脚本', points: '拆书知识点' }[mode]}`);
  info(`[节点1] 模型：${opts.model}，时长：${mode === 'topics' ? '—' : duration + 's'}`);
  info('[节点1] 正在请求 DeepSeek…');

  const started = Date.now();
  const { content, usage } = await callDeepSeek({
    ...opts,
    systemPrompt,
    userPrompt
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const text = stripFence(content);

  if (!text) {
    fail('模型没有返回正文内容。');
    process.exit(1);
  }

  // 脚本模式下先解析一遍，避免把坏 YAML 交给节点2
  if (mode === 'script') {
    let parsed;
    try {
      parsed = yaml.load(text);
    } catch (err) {
      const badPath = outPath.replace(/\.ya?ml$/i, '') + '.bad.yaml';
      writeOut(badPath, text);
      fail(`模型输出的 YAML 无法解析：${err.message}`);
      console.error(`  原始输出已另存：${path.relative(process.cwd(), badPath)}`);
      process.exit(1);
    }
    if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      const badPath = outPath.replace(/\.ya?ml$/i, '') + '.bad.yaml';
      writeOut(badPath, text);
      fail('脚本缺少 scenes 数组。');
      console.error(`  原始输出已另存：${path.relative(process.cwd(), badPath)}`);
      process.exit(1);
    }
    const declared = parsed.meta && Number(parsed.meta.duration);
    if (declared && Math.abs(declared - duration) > 0.01) {
      warn(`脚本声明 ${declared}s，与请求的 ${duration}s 不一致。`);
    }
    const contentWarnings = validateScriptContent(parsed, duration);
    for (const w of contentWarnings) warn(`[节点1] ${w}`);
  } else if (mode === 'topics') {
    for (const w of validateTopicsContent(text)) warn(`[节点1] ${w}`);
  }

  writeOut(outPath, text);

  console.log('');
  ok(`[节点1] 完成 → ${path.relative(process.cwd(), outPath)}（耗时 ${elapsed}s）`);
  if (usage) {
    dim(`  token 用量：prompt ${usage.prompt_tokens}，completion ${usage.completion_tokens}，合计 ${usage.total_tokens}`);
  }

  if (mode === 'topics') {
    console.log('\n' + text + '\n');
    dim('  下一步：挑一个选题，运行 node node1.js --topic "选题" --out script.yaml');
  } else if (mode === 'points') {
    const count = splitPoints(text).length;
    console.log('\n' + text.slice(0, 1200) + (text.length > 1200 ? '\n…' : '') + '\n');
    dim(`  共 ${count} 个知识点。下一步：node node1.js --book ${path.relative(process.cwd(), outPath)} --index 1`);
  } else {
    dim('  下一步：node node2.js --script ' + path.relative(process.cwd(), outPath));
  }
}

if (require.main === module) {
  main().catch((err) => {
    fail('[节点1] 失败：' + (err && err.message ? err.message : err));
    process.exit(1);
  });
}

module.exports = {
  validateScriptContent,
  validateTopicsContent,
  findVisualGaps,
  splitPoints
};
