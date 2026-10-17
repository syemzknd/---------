#!/usr/bin/env node
'use strict';
/**
 * 节点3：用 Playwright 逐帧渲染 HTML，再用 ffmpeg 合成无声视频。
 *
 * 用法：
 *   node render.js --html index.html [--script script.yaml] [--frames frames]
 *                  [--out output] [--silent output/<标题>_silent.mp4] [--clean]
 *
 * 不传 --silent 时，按脚本 meta.title 输出 output/<标题>_silent.mp4。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  info, ok, warn, fail, dim, parseArgs, ensureDir, run, probeDuration,
  readYamlScript, ffmpegBin, humanSize, dirSize
} = require('./lib/util');
const { baseNameFromScript } = require('./lib/naming');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const htmlPath = path.resolve(args.html || 'index.html');
  const framesDir = path.resolve(args.frames || 'frames');
  const outDir = path.resolve(args.out || 'output');
  const width = Number(args.width || 1920);
  const height = Number(args.height || 1080);
  const cleanFrames = !!args.clean;
  const timeoutMs = Number(args['load-timeout'] || 30) * 1000;

  if (!fs.existsSync(htmlPath)) {
    fail(`找不到 HTML 文件：${htmlPath}`);
    console.error('  提示：先运行 node node2.js --script script.yaml 生成 index.html。');
    process.exit(1);
  }

  // 若给了脚本，校验 fps/时长一致性——fps 对不上会导致画面与音频错位
  let parsedScript = null;
  let scriptPath = '';
  if (args.script) {
    scriptPath = path.resolve(args.script);
    parsedScript = readYamlScript(scriptPath);
    if (parsedScript && parsedScript.meta) {
      const scriptFps = parsedScript.meta.fps || 30;
      if (scriptFps !== 30) {
        warn(`脚本 meta.fps = ${scriptFps}，但渲染契约固定为 30fps；以 HTML 内声明的 FPS 为准。`);
      }
    }
  }

  // 无声视频与成片同名：output/<meta.title>_silent.mp4。
  // --silent 由主控显式传入；单独运行时按脚本标题推导。
  let silentPath;
  if (args.silent) {
    silentPath = path.resolve(args.silent);
  } else if (args.name) {
    const { sanitizeTitle } = require('./lib/naming');
    silentPath = path.join(outDir, sanitizeTitle(args.name) + '_silent.mp4');
  } else if (scriptPath) {
    silentPath = path.join(outDir, baseNameFromScript(parsedScript, scriptPath) + '_silent.mp4');
  } else {
    silentPath = path.join(outDir, 'video_silent.mp4');
  }

  fs.rmSync(framesDir, { recursive: true, force: true });
  ensureDir(framesDir);
  ensureDir(outDir);

  info('[节点3] 启动 Chromium…');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1
  });

  let pageErrors = 0;
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      pageErrors++;
      console.log(`  [页面 console.error] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors++;
    console.log(`  [页面异常] ${err.message}`);
  });

  const url = pathToFileURL(htmlPath).href + '?frame=0';
  dim(`  加载：${url}`);
  await page.goto(url, { waitUntil: 'load' });

  // HTML 必须在截图模式下置位 __RENDER_DONE__，否则这里会一直等
  try {
    await page.waitForFunction(() => window.__RENDER_DONE__ === true, { timeout: timeoutMs });
  } catch {
    await browser.close();
    fail('等待 window.__RENDER_DONE__ 超时。');
    console.error(
      '  说明：HTML 未实现截图模式。带 ?frame=N 打开时，应只渲染第 N 帧，' +
      '并在渲染完成后设置 window.__RENDER_DONE__ = true。\n' +
      '  处理：检查 index.html（必要时重新生成），或调大 --load-timeout。'
    );
    process.exit(1);
  }

  const meta = await page.evaluate(() => ({
    FPS: window.FPS,
    DURATION: window.DURATION,
    TOTAL_FRAMES: window.TOTAL_FRAMES,
    hasRenderFrame: typeof window.renderFrame === 'function'
  }));

  if (!meta.hasRenderFrame) {
    await browser.close();
    fail('HTML 未暴露 window.renderFrame 函数，无法逐帧渲染。');
    process.exit(1);
  }

  const fps = Number(args.fps || meta.FPS || 30);
  const total = Number(meta.TOTAL_FRAMES) || Math.round((meta.DURATION || 30) * fps);

  if (!Number.isFinite(total) || total <= 0) {
    await browser.close();
    fail(`无法确定总帧数（TOTAL_FRAMES=${meta.TOTAL_FRAMES}, DURATION=${meta.DURATION}）。`);
    process.exit(1);
  }

  // ---- 预检：先把整条时间轴扫一遍再开始截图 ----
  // 逐帧渲染 1800 帧要十几分钟，而模型生成的代码常在某段动画里埋了
  // 「变量名写错」这类只在特定时间才走到的错误。实测过：渲染到第 1681 帧
  // （56 秒处）才抛 ReferenceError，前面 28 分钟的截图全部白做。
  // 这里只调用 renderFrame、不截图，几秒钟就能扫完整条时间轴。
  info('[节点3] 预检：扫描整条时间轴…');
  const step = Math.max(1, Math.floor(fps / 4)); // 每秒采样 4 帧
  const sweepErrors = [];
  for (let f = 0; f < total; f += step) {
    try {
      await page.evaluate((frame) => window.renderFrame(frame), f);
    } catch (err) {
      const msg = err && err.message ? err.message.split('\n')[0] : String(err);
      sweepErrors.push({ frame: f, time: (f / fps).toFixed(2), msg });
      if (sweepErrors.length >= 5) break;
    }
  }
  if (sweepErrors.length) {
    await browser.close();
    fail(`预检发现 renderFrame 在渲染时抛错，共 ${sweepErrors.length}${sweepErrors.length >= 5 ? '+' : ''} 处：`);
    for (const e of sweepErrors) {
      console.error(`  第 ${e.frame} 帧（${e.time}s）：${e.msg}`);
    }
    console.error(
      '\n  这类错误通常只在某一段动画被走到时才触发，靠静态检查看不出来。' +
      '\n  处理：重新生成 HTML（--force-node2），或按报错位置修正 index.html。'
    );
    process.exit(1);
  }
  ok(`  预检通过（${Math.ceil(total / step)} 个采样点，无异常）`);

  // 提前提示体积：1920x1080 的 PNG 每帧约 1~3MB，900 帧就可能上 GB
  const estGB = (total * 2 * 1024 * 1024) / 1024 / 1024 / 1024;
  info(`[节点3] 总帧数 ${total}，帧率 ${fps}fps，时长 ${(total / fps).toFixed(1)}s`);
  dim(`  预计截图体积约 ${estGB.toFixed(1)}GB 存于 ${path.relative(process.cwd(), framesDir)}/`);
  if (estGB > 2) {
    warn(`  截图会占用较大磁盘空间，渲染完成后可用 --clean 自动清理。`);
  }

  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    await page.evaluate(async (frame) => {
      window.renderFrame(frame);
      // 等两帧：第一次 rAF 触发绘制，第二次确保该帧已提交合成，
      // 避免截图抓到上一帧（单次 rAF 存在抓到旧帧的可能）
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
    }, i);

    const file = path.join(framesDir, `frame-${String(i).padStart(5, '0')}.png`);
    await page.screenshot({ path: file, type: 'png' });

    if (i % 10 === 0 || i === total - 1) {
      const pct = (((i + 1) / total) * 100).toFixed(1);
      const used = (Date.now() - t0) / 1000;
      const eta = i > 0 ? ((used / (i + 1)) * (total - i - 1)).toFixed(0) : '?';
      process.stdout.write(`\r  [节点3] 渲染 ${i + 1}/${total} (${pct}%) 已用 ${used.toFixed(0)}s ETA ${eta}s   `);
    }
  }
  process.stdout.write('\n');
  await browser.close();

  if (pageErrors > 0) {
    warn(`[节点3] 渲染期间页面共报出 ${pageErrors} 条错误，画面可能不完整。`);
  }

  ensureDir(path.dirname(silentPath));
  info(`[节点3] 合成无声视频 → ${path.relative(process.cwd(), silentPath)}…`);
  run(
    `${ffmpegBin()} -y -framerate ${fps} -i "${path.join(framesDir, 'frame-%05d.png')}" ` +
    `-c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium "${silentPath}"`
  );

  const dur = probeDuration(silentPath);
  ok(`[节点3] 完成 → ${silentPath}（${dur ? dur.toFixed(2) + 's' : '?'}，${humanSize(fs.statSync(silentPath).size)}）`);

  if (cleanFrames) {
    const freed = dirSize(framesDir);
    fs.rmSync(framesDir, { recursive: true, force: true });
    ok(`[节点3] 已清理截图目录，释放 ${humanSize(freed)}`);
  } else {
    dim(`  截图保留在 ${path.relative(process.cwd(), framesDir)}/（${humanSize(dirSize(framesDir))}），加 --clean 可自动清理`);
  }
}

main().catch((err) => {
  fail('[节点3] 失败：' + (err && err.message ? err.message : err));
  process.exit(1);
});
