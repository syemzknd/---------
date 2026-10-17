#!/usr/bin/env node
'use strict';
/**
 * 主控：串起节点2 → 节点3 → 节点4 → 节点5。
 *
 * 用法：
 *   node main.js --topic "选题"                 一句话选题 → 脚本 → 成片
 *   node main.js --material 资料.txt            导入资料 → 拆知识点 → 脚本 → 成片
 *   node main.js --topics "领域"                只生成 10 个候选选题（不渲染）
 *   node main.js --script script.yaml           已有脚本 → 成片
 *   常用：[--duration 45] [--bgm audio/bgm.mp3] [--bgm-style ambient_tech_tension]
 *        [--html index.html] [--video output/final.mp4] [--force-node2] [--clean]
 *   命名：默认 output/<meta.title>.mp4（无声视频/字幕/混音清单同名）；
 *        [--name 自定义基名] [--unique 重名时加 _2 保留旧版]
 *   BGM：设置 JAMENDO_CLIENT_ID 后按脚本 meta.bgm 自动搜索并下载授权音轨；
 *        [--no-jamendo] 关闭，回退本地 audio/bgm/。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  info, ok, warn, fail, dim, parseArgs, readYamlScript
} = require('./lib/util');
const {
  sanitizeTitle, baseNameFromScript, resolveBaseName, outputPaths
} = require('./lib/naming');

function step(n, title) {
  console.log(`\n${'─'.repeat(60)}`);
  info(`节点${n}：${title}`);
  console.log('─'.repeat(60));
}

/** 用数组传参，避免提示词里的引号/空格被 shell 拆坏 */
function runNode(script, argv) {
  console.log(`\x1b[2m$ node ${script} ${argv.join(' ')}\x1b[0m`);
  const r = spawnSync(process.execPath, [path.resolve(__dirname, script), ...argv], {
    stdio: 'inherit'
  });
  if (r.status !== 0) {
    throw new Error(`${script} 退出码 ${r.status}`);
  }
}

const USAGE = `用法：
  node main.js --topic "选题" [--duration 45]     一句话选题 → 脚本 → 成片
  node main.js --material 资料.txt [--index 1]    资料 → 知识点 → 脚本 → 成片
  node main.js --points points.md [--index 1]     现成知识点 → 脚本 → 成片
  node main.js --topics "领域"                     只生成 10 个候选选题
  node main.js --script script.yaml               已有脚本 → 成片

命名：默认 output/<meta.title>.mp4，无声视频/字幕/混音清单同名
      [--name 自定义基名] [--unique 重名时加 _2 保留旧版] [--out-dir 目录]

BGM：设置 JAMENDO_CLIENT_ID 后按脚本 meta.bgm 自动选曲下载；
      [--no-jamendo] 关闭在线选曲，回退本地 audio/bgm/；
      [--bgm 文件] 显式指定音轨。

其它：[--html index.html] [--video output/x.mp4] [--force-node2] [--clean]
      [--skip-node4] [--no-bgm] [--no-duck] [--rate +5%] [--theme midnight]`;

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(USAGE);
    return;
  }

  const script = path.resolve(args.script || 'script.yaml');
  const html = path.resolve(args.html || 'index.html');
  const bgmArg = typeof args.bgm === 'string' ? args.bgm : '';
  const bgm = bgmArg ? path.resolve(bgmArg) : null;
  const video = args.video ? path.resolve(args.video) : null;
  const clean = !!args.clean;

  const t0 = Date.now();

  // 节点1：--topic / --material / --points 时，先用 DeepSeek 产出脚本
  const topic = typeof args.topic === 'string' ? args.topic : '';
  const material = typeof args.material === 'string' ? args.material : '';
  const points = typeof args.points === 'string' ? args.points : '';
  const duration = String(args.duration || 45);

  if (args.topics) {
    if (typeof args.topics !== 'string') {
      fail('--topics 需要一个领域/方向，例如 --topics "二进制"');
      process.exit(1);
    }
    step(1, 'DeepSeek 生成候选选题');
    runNode('node1.js', [
      '--topics', args.topics,
      '--out', path.resolve(args['topics-out'] || 'output/topics.md')
    ]);
    return;
  }

  const fromLLM = !!(topic || material || points);
  if (fromLLM && !args['skip-node1']) {
    step(1, 'DeepSeek 生成视频脚本');
    if (topic) {
      runNode('node1.js', ['--topic', topic, '--duration', duration, '--out', script]);
    } else {
      let pointFile = points;
      if (!pointFile) {
        pointFile = path.resolve(args['points-out'] || 'output/points.md');
        runNode('node1.js', ['--extract', material, '--out', pointFile]);
      }
      runNode('node1.js', [
        '--book', pointFile,
        '--index', String(args.index || 1),
        '--duration', duration,
        '--out', script
      ]);
    }
  } else if (fromLLM) {
    dim(`跳过节点1，直接使用 ${path.relative(process.cwd(), script)}`);
  }

  // 节点1 跑完后才校验脚本是否存在（--topic/--material 模式下脚本是刚生成的）
  if (!fs.existsSync(script)) {
    fail(`找不到视频脚本：${script}`);
    console.error('  提示：节点1 的产出应保存为该文件。可先用示例跑通：');
    console.error('    node main.js --script examples/script.yaml --html examples/index.html --skip-node2');
    process.exit(1);
  }

  // 产物统一用脚本标题命名：output/<标题>.mp4、<标题>_silent.mp4、字幕同名。
  // --name 可覆盖标题；--unique 在重名时追加 _2 保留上一版，默认覆盖同名旧成片。
  const parsedScript = readYamlScript(script);
  if (!parsedScript) {
    fail(`脚本无法解析为 YAML：${script}`);
    process.exit(1);
  }
  const outDir = path.resolve(args['out-dir'] || 'output');
  const requestedBase = args.name
    ? sanitizeTitle(args.name)
    : baseNameFromScript(parsedScript, script);
  const base = resolveBaseName(outDir, requestedBase, { unique: !!args.unique });
  const paths = outputPaths(outDir, base);
  const finalVideo = video || paths.video;
  const silentVideo = args.silent ? path.resolve(args.silent) : paths.silent;

  info(`[产物] 标题：${(parsedScript.meta && parsedScript.meta.title) || base}`);
  dim(`  成片：${path.relative(process.cwd(), finalVideo)}`);
  dim(`  无声：${path.relative(process.cwd(), silentVideo)}`);

  // 节点2：AI 生成 HTML（脚本是新生成的，或已有产物缺失/被要求重生成时才跑）
  const needNode2 = args['force-node2'] || fromLLM || !fs.existsSync(html);
  if (args['skip-node2']) {
    if (!fs.existsSync(html)) {
      fail(`--skip-node2 指定了跳过节点2，但 ${path.relative(process.cwd(), html)} 不存在。`);
      process.exit(1);
    }
    dim(`跳过节点2，直接使用 ${path.relative(process.cwd(), html)}`);
  } else if (needNode2) {
    step(2, 'DeepSeek 生成 HTML 渲染器');
    runNode('node2.js', ['--script', script, '--out', html]);
  } else {
    dim(`节点2 已有产出 ${path.relative(process.cwd(), html)}，跳过（加 --force-node2 可强制重生成）`);
  }

  // 节点3：逐帧渲染 + 合成无声视频
  step(3, '逐帧渲染并合成无声视频');
  runNode('render.js', [
    '--html', html,
    '--script', script,
    '--out', outDir,
    '--silent', silentVideo,
    ...(clean ? ['--clean'] : [])
  ]);

  // 节点4：配音 + BGM
  if (args['skip-node4']) {
    dim('按要求跳过节点4（不生成配音与 BGM）。');
    console.log('');
    ok(`产出无声视频：${path.relative(process.cwd(), silentVideo)}`);
    return;
  }

  step(4, 'AI 配音 + BGM + 特效字幕');
  // 节点4 的选曲顺序：--bgm > Jamendo（有 JAMENDO_CLIENT_ID 且脚本有 meta.bgm）> audio/bgm/ 本地文件。
  const audioArgs = ['--script', script, '--video', silentVideo, '--out', finalVideo];
  if (bgm) audioArgs.push('--bgm', bgm);
  if (typeof args['bgm-style'] === 'string') audioArgs.push('--bgm-style', args['bgm-style']);
  if (args.rate) audioArgs.push('--rate', String(args.rate));
  if (args['jamendo-client-id']) audioArgs.push('--jamendo-client-id', String(args['jamendo-client-id']));
  if (args['no-bgm']) audioArgs.push('--no-bgm');
  if (args['no-jamendo']) audioArgs.push('--no-jamendo');
  if (args['no-duck']) audioArgs.push('--no-duck');
  if (args['no-text-normalize']) audioArgs.push('--no-text-normalize');
  if (args['no-subs']) audioArgs.push('--no-subs');
  else if (args.subs) audioArgs.push('--subs', String(args.subs));
  runNode('audio.js', audioArgs);

  // 节点5：质检
  step(5, '成片质检');
  const qaArgs = ['--script', script, '--video', finalVideo, '--silent', silentVideo];
  if (args.blackdetect) qaArgs.push('--blackdetect');
  try {
    runNode('qa.js', qaArgs);
  } catch {
    warn('质检发现问题，请查看上方输出。');
  }

  const mins = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n${'─'.repeat(60)}`);
  ok(`全流程完成，总耗时 ${mins} 分钟`);
  console.log(`  成片：${finalVideo}`);
  console.log(`  无声视频：${silentVideo}`);
  console.log(`  字幕/清单：${path.join(outDir, base)}.{srt,vtt,ass,audio.json}`);
  console.log('─'.repeat(60) + '\n');
}

try {
  main();
} catch (err) {
  fail('流程中断：' + (err && err.message ? err.message : err));
  process.exit(1);
}
