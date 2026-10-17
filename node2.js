#!/usr/bin/env node
'use strict';
/**
 * 节点2：把「渲染引擎提示词 + 视频脚本」交给 DeepSeek，产出 index.html。
 *
 * 用法：
 *   node node2.js --script script.yaml [--out index.html] [--model deepseek-v4-pro]
 *
 * 鉴权：读取环境变量 DEEPSEEK_API_KEY（必需）。
 * 可选环境变量：DEEPSEEK_MODEL、DEEPSEEK_BASE_URL、DEEPSEEK_MAX_TOKENS。
 */
const fs = require('fs');
const path = require('path');
const {
  info, ok, warn, fail, dim, parseArgs, ensureDir, readYamlScript
} = require('./lib/util');
const { themeBlock, themeNames } = require('./lib/theme');

const { loadApiKey, callDeepSeek, DEFAULT_BASE_URL, DEFAULT_MODEL } = require('./lib/deepseek');

// 该模型 max_output_tokens 上限为 393216；这里给一个足够宽松的默认值，
// 避免长 HTML 被截断（截断会直接导致渲染失败）。
const DEFAULT_MAX_TOKENS = 65536;

/**
 * 检查模型是否把旁白台词画进了画面。
 *
 * 字幕由节点4 统一以 srt/vtt 产出；HTML 里再画一份就会在成片里重叠成双份字幕。
 * 提示词里已经明令禁止，但提示词只是建议，这里做实际拦查。
 *
 * 取旁白中一段足够长的连续子串去 HTML 里找：太短容易误命中
 * （旁白和画面文案可能都含「二进制」这类词），所以取 10 个字以上。
 */
function auditNarrationLeak(html, script) {
  const sceneList = (script && script.scenes) || [];
  const leaks = [];
  const flatten = (s) => String(s || '').replace(/[，。、！？：；""''（）\s]/g, '');
  const flatHtml = flatten(html);
  for (const scene of sceneList) {
    // elements[].text 是脚本明确允许上画面的文案（例如最后一幕的金句卡片）。
    // 当旁白和画面文案本来就是同一句时，不能算“把台词画进了画面”。
    const allowed = (Array.isArray(scene.elements) ? scene.elements : [])
      .map((el) => flatten(el && (el.text ?? el.content ?? el.label ?? '')))
      .filter(Boolean);

    // 逐句检查：只探旁白开头会漏掉“后一句被画进画面”的情况
    // （金句页把第二句 CTA 画成小字，就被开头探针 + 标题白名单一起放过了）。
    const sentences = String(scene.narration || '')
      .split(/[。！？!?；;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sentence of sentences) {
      // 去掉标点后取前 10 个字作为探针，避开因标点写法差异导致的漏判
      const probe = flatten(sentence).slice(0, 10);
      if (probe.length < 8) continue;
      if (!flatHtml.includes(probe)) continue;
      if (!allowed.some((t) => t.includes(probe))) {
        leaks.push({ id: scene.id || '?', probe });
      }
    }
  }
  return leaks;
}

function auditHtml(html) {
  const checks = [];
  checks.push({ name: 'HTML 完整（以 </html> 结束）', pass: /<\/html>\s*$/i.test(html.trim()) });
  checks.push({ name: '暴露 window.renderFrame', pass: /renderFrame\s*=/.test(html) });
  checks.push({ name: '支持 ?frame=N 截图模式', pass: /__RENDER_DONE__/.test(html) });
  checks.push({ name: '暴露 window.TOTAL_FRAMES', pass: /TOTAL_FRAMES\s*=/.test(html) });

  const extDeps = [];
  if (/<script[^>]+src\s*=\s*["']https?:/i.test(html)) extDeps.push('<script src="http...">');
  if (/<link[^>]+href\s*=\s*["']https?:/i.test(html)) extDeps.push('<link href="http...">');
  if (/@import\s+url\(\s*["']?https?:/i.test(html)) extDeps.push('@import url(http...)');
  if (/url\(\s*["']?https?:/i.test(html)) extDeps.push('CSS url(http...)');
  checks.push({ name: '无外部网络依赖（可离线渲染）', pass: extDeps.length === 0, detail: extDeps.join(', ') });

  return checks;
}

/**
 * 视觉语言自检：只检查“有没有把提示词里的硬性要求落进代码”，不判断画面好坏。
 * 提示词写了但模型没执行，是最常见的情况，所以至少把这些可静态发现的信号查出来。
 */
function auditVisualLanguage(html) {
  const checks = [];
  const easingNames = ['easeInOutCubic', 'easeOutCubic', 'easeOutBack', 'smootherstep'];
  const defined = easingNames.filter((n) => new RegExp(n + '\\s*=').test(html));
  checks.push({
    name: '包含并定义平滑缓动函数（至少两种）',
    pass: defined.length >= 2,
    detail: defined.length ? defined.join('、') : '未找到缓动函数定义'
  });

  // 定义了却不用，等于没写：去掉注释后函数名至少要出现两次（定义 + 至少一次引用）。
  // 缓动函数常见的用法是作为参数传入（easeProgress(t, a, b, easeOutBack)），
  // 不能只匹配 `name(`，否则会把合法的函数引用误判成“未使用”。
  const code = html
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '');
  const used = easingNames.filter((n) => {
    const hits = code.match(new RegExp('\\b' + n + '\\b', 'g')) || [];
    return hits.length >= 2;
  });
  checks.push({
    name: '缓动函数被实际调用（至少两种）',
    pass: used.length >= 2,
    detail: used.length ? used.join('、') : '只定义未使用，或全部退回匀速'
  });

  // 函数声明 `function drawMotif(` 本身也算一次匹配，减掉后才是场景调用数
  const motifDecls = (html.match(/function\s+drawMotif\s*\(/g) || []).length;
  const motifCalls = (html.match(/\bdrawMotif\s*\(/g) || []).length - motifDecls;
  checks.push({
    name: '视觉母题实际贯穿（drawMotif 至少 3 处场景调用）',
    pass: /drawMotif|visual[_-]?motif|motif/i.test(html) && motifCalls >= 3,
    detail: motifCalls > 0 ? `检测到 ${motifCalls} 处调用` : '没有可复用的 drawMotif 调用'
  });

  const hasBackground = /function\s+drawBackground\s*\(/.test(html);
  checks.push({
    name: '三层结构：drawBackground + drawMotif 均已实现',
    pass: hasBackground && /function\s+drawMotif\s*\(/.test(html),
    detail: hasBackground ? '缺少 drawMotif' : '缺少 drawBackground，背景层可能只是一块纯色'
  });

  checks.push({
    name: '母题按全局时间连续（motifAt 跨场景复用）',
    pass: /function\s+motifAt\s*\(|(?:const|let|var)\s+motifAt\s*=/.test(html),
    detail: '未找到 motifAt(t)：场景边界可能重新初始化母题，转场会断'
  });

  // 主焦点占屏约束：脚本里的 focus / occupancy 应当在绘制代码里被消费
  checks.push({
    name: '主焦点占屏约束落地（focus / occupancy / FOCUS_MIN）',
    pass: /\boccupancy\b|FOCUS_MIN|focus(?:Point|El)?\b|occupancyOf/i.test(code),
    detail: '未找到 focus / occupancy 相关实现，主体可能仍然画得过小'
  });

  // 粒子、尾迹、代码雨这类随机视觉元素必须走固定种子 PRNG
  const hasSeededPrng = /(?:function\s+)?(?:mulberry32|splitmix32|xorshift|sfc32|seedRandom|seededRandom|createRandom|createRng|makeRng|prng)\b/i.test(html);
  const hasRandomFx = /粒子|particle|尾迹|trail|codeRain|星点|spark/i.test(html);
  checks.push({
    name: '随机视觉元素使用固定种子 PRNG',
    pass: hasSeededPrng || !hasRandomFx,
    detail: hasRandomFx && !hasSeededPrng
      ? '检测到粒子/尾迹，但没有 mulberry32 等固定种子函数'
      : ''
  });

  checks.push({
    name: '包含路径/数据图形绘制（arc/lineTo/贝塞尔）',
    pass: /\.arc\(|\.lineTo\(|\.bezierCurveTo\(|\.quadraticCurveTo\(/.test(html)
  });

  // 排除 createLinearGradient：它包含 "Linear" 但不是缓动。
  const linearEase = /\beaseLinear\b|\blinearEase\b|\blinear\s*\(\s*[a-zA-Z_$]/i.test(html);
  checks.push({
    name: '未使用线性匀速缓动',
    pass: !linearEase
  });

  const randomUses = (html.match(/Math\.random\s*\(/g) || []).length;
  checks.push({
    name: '未使用未播种的 Math.random（保证逐帧确定性）',
    pass: randomUses === 0,
    detail: randomUses ? `${randomUses} 处，请改用固定种子` : ''
  });

  const clockUses = (html.match(/\b(?:Date\.now|performance\.now)\s*\(/g) || []).length;
  checks.push({
    name: 'renderFrame 不依赖真实时钟',
    pass: clockUses === 0,
    detail: clockUses ? `${clockUses} 处 Date.now/performance.now（只在预览循环计时可忽略）` : ''
  });

  return checks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['list-themes']) {
    console.log('可用风格：');
    for (const n of themeNames()) console.log('  - ' + n);
    return;
  }

  const scriptPath = path.resolve(args.script || 'script.yaml');
  const outPath = path.resolve(args.out || 'index.html');
  const promptPath = path.resolve(args.prompt || 'prompts/node2-prompt.md');

  if (!fs.existsSync(scriptPath)) {
    fail(`找不到视频脚本：${scriptPath}`);
    console.error('  提示：可先用示例脚本跑通流程，例如 --script examples/script.yaml');
    process.exit(1);
  }
  if (!fs.existsSync(promptPath)) {
    fail(`找不到提示词文件：${promptPath}`);
    process.exit(1);
  }

  const apiKey = loadApiKey();
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = args.model || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
  const maxTokens = Number(args['max-tokens'] || process.env.DEEPSEEK_MAX_TOKENS || DEFAULT_MAX_TOKENS);
  const temperature = args.temperature !== undefined ? Number(args.temperature) : 0.2;
  const stallMs = Number(process.env.DEEPSEEK_STALL_TIMEOUT || 240) * 1000;

  // 风格包：把设计令牌拼进系统提示词，避免模型每次自行发明配色
  const themeName = args.theme || 'midnight';
  let themeText;
  try {
    themeText = themeBlock(themeName);
  } catch (err) {
    fail(err.message);
    process.exit(1);
  }

  const scriptText = fs.readFileSync(scriptPath, 'utf8');
  const systemPrompt = fs.readFileSync(promptPath, 'utf8') + '\n\n' + themeText + '\n';

  // 脚本结构校验：节点2 依赖 meta/scenes，缺了就别浪费一次 API 调用
  const parsed = readYamlScript(scriptPath);
  if (!parsed) {
    fail('脚本不是合法 YAML，无法解析。');
    process.exit(1);
  }
  const duration = parsed.meta && parsed.meta.duration;
  const fps = (parsed.meta && parsed.meta.fps) || 30;
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    fail('脚本缺少 scenes 数组。');
    process.exit(1);
  }
  if (!duration) warn('脚本 meta.duration 缺失，模型将按默认 30 秒处理。');

  const userPrompt =
    '下面是一份视频脚本，请严格按系统提示词的要求，输出完整的 HTML 渲染器。\n\n' +
    '```yaml\n' + scriptText.trim() + '\n```\n';

  info(`[节点2] 模型：${model}`);
  info(`[节点2] 风格：${themeName}`);
  info(`[节点2] 脚本：${path.relative(process.cwd(), scriptPath)}（${parsed.scenes.length} 个场景，${duration || 30} 秒 @ ${fps}fps）`);
  info('[节点2] 正在请求 DeepSeek，长脚本可能需要几分钟…');

  const started = Date.now();
  const { content, reasoning, usage } = await callDeepSeek({
    apiKey, baseUrl, model,
    systemPrompt,
    userPrompt,
    maxTokens,
    temperature,
    stallMs
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const { stripCodeFence } = require('./lib/util');
  const html = stripCodeFence(content);

  if (!html) {
    fail('模型没有返回正文内容。');
    if (reasoning) {
      console.error('  仅收到推理内容，通常说明 max_tokens 被推理消耗殆尽，请调大 DEEPSEEK_MAX_TOKENS。');
    }
    process.exit(1);
  }

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, html, 'utf8');

  console.log('');
  ok(`HTML 已生成：${outPath}（${(html.length / 1024).toFixed(1)} KB，耗时 ${elapsed}s）`);
  if (usage) {
    dim(`  token 用量：prompt ${usage.prompt_tokens}，completion ${usage.completion_tokens}` +
      (usage.completion_tokens_details ? `（其中推理 ${usage.completion_tokens_details.reasoning_tokens}）` : '') +
      `，合计 ${usage.total_tokens}`);
  }

  console.log('');
  info('[节点2] 产出物自检：');
  const checks = auditHtml(html).concat(auditVisualLanguage(html));
  let hardFail = false;
  for (const c of checks) {
    if (c.pass) {
      ok(`  ${c.name}`);
    } else {
      warn(`  ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
      if (c.name.startsWith('HTML 完整')) hardFail = true;
    }
  }

  const leaks = auditNarrationLeak(html, parsed);
  if (leaks.length === 0) {
    ok('  画面未出现旁白台词（字幕不会重复）');
  } else {
    warn(`  画面里疑似出现了旁白台词，成片会出现双份字幕：`);
    for (const l of leaks) {
      warn(`    场景 ${l.id}：命中「${l.probe}…」`);
    }
    dim('  字幕由节点4 以 srt/vtt 产出，HTML 不应再画一份。');
    dim('  可用 --force-node2 重新生成试试；若反复出现，说明提示词需再加强。');
  }

  if (hardFail) {
    const partialPath = outPath.replace(/\.html?$/i, '') + '.partial.html';
    fs.writeFileSync(partialPath, html, 'utf8');
    fail(`生成的 HTML 不完整（疑似被截断），已另存：${partialPath}`);
    console.error('  建议：调大 DEEPSEEK_MAX_TOKENS，或把脚本拆成更少的场景后重试。');
    process.exit(1);
  }

  console.log('');
  ok('[节点2] 完成。下一步：node render.js --html ' + path.relative(process.cwd(), outPath));
}

if (require.main === module) {
  main().catch((err) => {
    fail('[节点2] 失败：' + (err && err.message ? err.message : err));
    process.exit(1);
  });
}

module.exports = { auditHtml, auditVisualLanguage, auditNarrationLeak };
