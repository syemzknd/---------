#!/usr/bin/env node
'use strict';
/**
 * 节点0：环境检测与搭建。
 *
 * 用法：
 *   node setup.js          交互式（缺失项会询问是否安装）
 *   node setup.js --auto   自动安装缺失依赖
 *   node setup.js --check  只检测、不安装
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { C, resolveTts, tryExec, ok, warn, fail, info, dim, parseArgs } = require('./lib/util');

const args = parseArgs(process.argv.slice(2));
const auto = !!args.auto;
const checkOnly = !!args.check;

const results = {};

function line(state, name, detail = '') {
  const mark =
    state === true ? `${C.green}✓${C.reset}` :
    state === 'warn' ? `${C.yellow}!${C.reset}` :
    `${C.red}✗${C.reset}`;
  console.log(`  ${mark} ${name.padEnd(30)} ${detail}`);
}

function moduleVersion(name) {
  try {
    return 'v' + require(`${name}/package.json`).version;
  } catch {
    return null;
  }
}

function ask(msg) {
  if (auto) {
    console.log(`  ${C.dim}自动确认：${msg}${C.reset}`);
    return Promise.resolve(true);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) =>
    rl.question(`  ${msg} [y/N] `, (a) => {
      rl.close();
      res(a.trim().toLowerCase() === 'y');
    })
  );
}

function pipHint() {
  return 'py -3 -m pip install --upgrade edge-tts';
}

async function main() {
  console.log(`\n${C.cyan}=== 节点0：环境检测 ===${C.reset}\n`);

  // 1. Node
  const nodeV = process.versions.node;
  const nodeOk = parseInt(nodeV.split('.')[0], 10) >= 18;
  line(nodeOk, 'Node.js', `v${nodeV}${nodeOk ? '' : '（需要 18+）'}`);
  results.node = nodeOk;

  // 2. ffmpeg / ffprobe
  const ffV = tryExec('ffmpeg -version');
  results.ffmpeg = !!ffV;
  line(!!ffV, 'ffmpeg', ffV ? ffV.split('\n')[0].slice(0, 46) : '未安装（见下方指引）');

  const fpV = tryExec('ffprobe -version');
  results.ffprobe = !!fpV;
  line(!!fpV, 'ffprobe', fpV ? '' : '未安装（随 ffmpeg 一起分发）');

  // 3. DeepSeek
  const key = process.env.DEEPSEEK_API_KEY;
  results.deepseek = !!key;
  line(!!key, 'DEEPSEEK_API_KEY', key ? `已设置（${key.length} 字符）` : '未设置（节点1、节点2 必需）');

  // 4. edge-tts —— Windows 上最容易踩坑的一项
  const tts = resolveTts();
  results.tts = !!tts;
  line(!!tts, 'edge-tts', tts ? `${tts.label}（来源：${tts.source}）` : `未找到，需 ${pipHint()}`);

  // 5. js-yaml
  const yamlV = moduleVersion('js-yaml');
  results.yaml = !!yamlV;
  line(!!yamlV, 'js-yaml（npm）', yamlV || '未安装');

  // 6. playwright
  const pwV = moduleVersion('playwright');
  results.playwright = !!pwV;
  line(!!pwV, 'playwright（npm）', pwV || '未安装');

  // 7. chromium
  let chromiumOk = false;
  let chromiumPath = '';
  if (pwV) {
    try {
      const { chromium } = require('playwright');
      chromiumPath = chromium.executablePath();
      chromiumOk = fs.existsSync(chromiumPath);
    } catch {
      chromiumOk = false;
    }
  }
  results.chromium = chromiumOk;
  line(chromiumOk, 'chromium（playwright）', chromiumOk ? path.basename(chromiumPath) : '未下载');

  console.log('');

  if (checkOnly) {
    const missing = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length === 0) {
      ok('环境完备，可以开始生产。');
      return;
    }
    warn(`缺失项：${missing.join('、')}`);
    dim('  修复：node setup.js --auto');
    process.exitCode = 1;
    return;
  }

  console.log(`${C.cyan}=== 环境搭建 ===${C.reset}\n`);
  let didAnything = false;

  // npm 依赖
  if (!results.yaml || !results.playwright) {
    if (await ask('安装 npm 依赖（js-yaml、playwright）？')) {
      try {
        execSync('npm install', { stdio: 'inherit' });
        didAnything = true;
      } catch {
        fail('npm install 失败，请手动执行：npm install');
      }
    }
  }

  // chromium
  if (!results.chromium) {
    if (await ask('下载 Chromium（约 150MB，逐帧渲染必需）？')) {
      try {
        execSync('npx playwright install chromium', { stdio: 'inherit' });
        didAnything = true;
      } catch {
        fail('Chromium 下载失败，请手动执行：npx playwright install chromium');
      }
    }
  }

  // edge-tts
  if (!results.tts) {
    console.log(`  ${C.dim}提示：Windows 上 edge-tts.exe 常装在 Python\\Scripts 下且不在 PATH，`);
    console.log(`  本脚本会自动改用 "py -3 -m edge_tts" 调用，无需改 PATH。${C.reset}`);
    if (await ask(`安装 edge-tts（${pipHint()}）？`)) {
      try {
        execSync('py -3 -m pip install --upgrade edge-tts', { stdio: 'inherit' });
        didAnything = true;
      } catch {
        try {
          execSync('python -m pip install --upgrade edge-tts', { stdio: 'inherit' });
          didAnything = true;
        } catch {
          fail(`安装失败，请手动执行：${pipHint()}`);
        }
      }
    }
  }

  // ffmpeg 指引
  if (!results.ffmpeg) {
    console.log(`\n${C.yellow}ffmpeg 未安装，请任选一种方式：${C.reset}`);
    console.log('  Windows: winget install Gyan.FFmpeg   或   choco install ffmpeg');
    console.log('  macOS:   brew install ffmpeg');
    console.log('  Ubuntu:  sudo apt install ffmpeg');
  }

  if (!results.deepseek) {
    console.log(`\n${C.yellow}DEEPSEEK_API_KEY 未设置，节点1、节点2 无法运行。${C.reset}`);
    console.log('  PowerShell（永久写入用户环境变量，重开终端生效）：');
    console.log(`    ${C.dim}[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY","sk-xxxx","User")${C.reset}`);
    console.log('  PowerShell（仅当前会话）：');
    console.log(`    ${C.dim}$env:DEEPSEEK_API_KEY = "sk-xxxx"${C.reset}`);
    console.log('  Git Bash:');
    console.log(`    ${C.dim}export DEEPSEEK_API_KEY=sk-xxxx${C.reset}`);
  }

  console.log('');
  if (didAnything) {
    ok('安装步骤已执行，建议重新运行 node setup.js --check 复核。');
  } else {
    ok('环境检查完成。');
  }

  const stillMissing = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
  if (stillMissing.length) {
    warn(`仍需处理：${stillMissing.join('、')}`);
  }
  console.log('');
}

main().catch((err) => {
  fail('环境检测失败：' + (err && err.message ? err.message : err));
  process.exit(1);
});
