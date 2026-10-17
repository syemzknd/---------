#!/usr/bin/env node
'use strict';
/**
 * 节点4：逐场景生成 AI 配音，按脚本时间轴对齐，叠加 BGM（带自动闪避），
 *        与无声视频合成最终成片。
 *
 * 用法：
 *   node audio.js --script script.yaml [--video output/<标题>_silent.mp4]
 *                 [--out output/<标题>.mp4] [--bgm audio/bgm.mp3]
 *                 [--no-jamendo] [--jamendo-client-id <id>]
 *
 * 不传 --out / --video 时按脚本 meta.title 推导同名产物：
 *   output/<标题>.mp4、output/<标题>_silent.mp4、output/<标题>.audio.json。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  info, ok, warn, fail, dim, parseArgs, ensureDir, run, probeDuration,
  readYamlScript, resolveTts, buildCmd, ffmpegBin, humanSize, fmtTime
} = require('./lib/util');
const { parseSrt, offsetAndMerge, toSrt, toVtt, toAss } = require('./lib/subtitle');
const { resolveBgm, isKnownStyle, styleNames, styleLabel, DEFAULT_BGM_STYLE } = require('./lib/bgm');
const { baseNameFromScript, outputPaths } = require('./lib/naming');
const {
  getClientId, resolveJamendoBgm, referenceText, formatClock
} = require('./lib/jamendo');

/** ffmpeg 是否带 libass（ass 滤镜）。没有就退回 sidecar 字幕，不影响出片。 */
function hasAssFilter() {
  try {
    const out = execSync(`${ffmpegBin()} -hide_banner -filters`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return /\bass\b\s+V->V/.test(out);
  } catch {
    return false;
  }
}

/**
 * ffmpeg 滤镜里的路径转义。
 *
 * `ass=` 的选项串用 `:` 分隔参数，Windows 盘符 `D:` 会被当成参数分隔；
 * 反斜杠、单引号、逗号、方括号也是过滤器语法字符。业界做法是：
 * 用正斜杠 + 转义盘符冒号，外层再套单引号。这里优先用相对路径，直接绕开盘符。
 */
function escapeFilterPath(p) {
  let rel = path.relative(process.cwd(), p);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) rel = p;
  let s = rel.split(path.sep).join('/').replace(/\\/g, '/');
  s = s.replace(/([':,[\]])/g, '\\$1');
  return s;
}

/** 去掉空白与标点，用于判断字幕是否和画面大标题完全同文 */
function normalizeSubText(s) {
  return String(s || '').replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()《》【】—…-]/g, '');
}

// ---------------- 旁白文本预处理 ----------------
// TTS 对“一逗到底”的长句会读出机械的长音，也会吃掉换行带来的停顿。
// 这里只做标点与断句层面的规范化，不改写、不删字，保证 highlight 词仍然原样存在。

const NO_PUNCT = /[^一-龥a-zA-Z0-9]/g;
const CLAUSE_SPLIT = /([，。！？；：、])/;

/** 可发音字数（不含标点），用于判断一个分句是否过长 */
function spokenCharCount(s) {
  return String(s || '').replace(NO_PUNCT, '').length;
}

// 在安全字之后断句，避免把“截止日期”“二进制”这类词劈开
const SAFE_BREAK_AFTER = new Set(
  [...'的了是在有就也都还才把被让给对从到和与或这那里后前时下上中'].map((c) => c)
);

// 转折 / 因果 / 条件词之前补逗号，制造自然的呼吸点
// 只保留能自然开启一个分句的转折/因果/条件词；
// “那一刻 / 真正的 / 不是”这类词前面补逗号会把句子切得很怪，不放进来。
const BREAK_MARKERS = [
  '也就是说', '换句话说', '更重要的是', '你会发现', '你以为', '实际上',
  '反过来', '问题是', '但是', '可是', '不过', '因为', '所以', '因此',
  '如果', '假如', '其实', '结果', '然后', '而且', '于是',
  '这时候', '直到', '就算', '哪怕', '与其', '不如'
].sort((a, b) => b.length - a.length);

/**
 * 给一个不含终止标点的长分句补呼吸逗号。
 * 只在分句超过 maxClause 的 1.5 倍时才动手，尽量不破坏原有语气。
 */
function insertBreathingPauses(text, maxClause = 20) {
  let out = String(text || '');
  for (const marker of BREAK_MARKERS) {
    const re = new RegExp(`([^，。！？；：、\\s])(${marker})`, 'g');
    out = out.replace(re, (m, before, word) => `${before}，${word}`);
  }

  return out.split(CLAUSE_SPLIT).map((part) => {
    if (!part || CLAUSE_SPLIT.test(part)) return part;
    let s = part;
    let guard = 0;
    while (spokenCharCount(s) > maxClause * 1.5 && guard++ < 4) {
      const chars = [...s];
      const mid = Math.floor(chars.length / 2);
      let cut = -1;
      for (let d = 0; d < chars.length && cut < 0; d++) {
        for (const i of [mid + d, mid - d]) {
          if (i > 6 && i < chars.length - 4 && SAFE_BREAK_AFTER.has(chars[i - 1])) {
            cut = i;
            break;
          }
        }
      }
      if (cut < 0) cut = mid;
      if (cut <= 0 || cut >= chars.length) break;
      s = chars.slice(0, cut).join('') + '，' + chars.slice(cut).join('');
    }
    return s;
  }).join('');
}

/**
 * 旁白规范化：统一全/半角标点、合并重复标点、把换行变成停顿、
 * 给超长分句补呼吸逗号，并保证以终止标点结束。
 * 只改标点，不改文字；返回的文本会同时用于 TTS 和字幕。
 */
function normalizeNarration(raw) {
  let s = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/ |　/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!s) return '';

  // 换行在 TTS 里常常只是一个短停顿，统一成逗号更可控
  s = s.replace(/\n+/g, '，');

  // 半角转全角；保护 3.14 这种小数
  s = s.replace(/\?/g, '？').replace(/!/g, '！').replace(/;/g, '；').replace(/,/g, '，');
  s = s.replace(/(?<!\d)\.(?!\d)/g, '。');

  // 中文之间的空格没有意义，标点两侧也不要空格
  s = s.replace(/([一-龥])\s+(?=[一-龥])/g, '$1');
  s = s.replace(/\s+([，。！？；：、])/g, '$1');
  s = s.replace(/([，。！？；：、])\s+/g, '$1');

  // 合并重复标点，清掉终止标点前的多余逗号
  s = s.replace(/，{2,}/g, '，')
    .replace(/。{2,}/g, '。')
    .replace(/！{2,}/g, '！')
    .replace(/？{2,}/g, '？')
    .replace(/；{2,}/g, '；')
    .replace(/[，、；：]+(?=[。！？])/g, '')
    .replace(/([。！？])[，、；：]+/g, '$1')
    .replace(/([。！？])[。！？]+/g, '$1')
    .replace(/^[，、；：]+/, '');

  // 分号结尾改成句号，按句读切分
  s = s.replace(/；\s*$/, '。');

  // 保证终止标点；句末引号/括号里的标点要保持原位
  const quoted = s.replace(/[”’"'」』）)]+$/, '');
  const tail = s.slice(quoted.length);
  if (!/[。！？…]$/.test(quoted)) s = quoted + '。' + tail;

  // 按句切分，给每句里的超长分句补呼吸逗号
  s = s.split(/(?<=[。！？])/).map((seg) => {
    const m = seg.match(/^([\s\S]*?)([。！？]?)$/);
    return insertBreathingPauses(m[1]) + m[2];
  }).join('');

  return s.replace(/[，、；：]+(?=[。！？])/g, '').trim();
}

/** 逐场景生成配音文件，返回 [{ file, start, duration, index, narration }] */
function synthesizeVoice({ segments, tts, voice, rate, tmpDir, audioDir, normalizeText = true }) {
  ensureDir(tmpDir);
  const results = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const tag = String(seg.index).padStart(2, '0');
    const txtFile = path.join(tmpDir, `voice_${tag}.txt`);
    const mp3File = path.join(audioDir, `voice_${tag}.mp3`);
    const srtFile = path.join(tmpDir, `voice_${tag}.srt`);

    // 文本预处理只改标点与断句，不改字；highlight 词仍原样保留。
    const original = String(seg.narration || '').trim();
    const spoken = normalizeText ? normalizeNarration(original) || original : original;

    // 走文件而不是命令行参数：Windows 下命令行会经过系统代码页，
    // 中文旁白可能被转码损坏；edge-tts 的 -f 按要求读 UTF-8 文件。
    fs.writeFileSync(txtFile, spoken, 'utf8');

    const preview = spoken.length > 24 ? spoken.slice(0, 24) + '…' : spoken;
    process.stdout.write(
      `\r  [节点4] 配音 ${i + 1}/${segments.length}（场景 ${seg.index}）${preview}          `
    );

    // 不经过 run()：避免每段都回显命令行，打断上面的进度行
    // --write-subtitles 顺带产出逐句时间轴（edge-tts 的 SentenceBoundary），
    // 供后面合成 srt/vtt 字幕使用，不额外增加依赖或请求。
    execSync(buildCmd(tts.parts, [
      '-f', txtFile,
      '--voice', voice,
      '--rate', rate,
      '--write-media', mp3File,
      '--write-subtitles', srtFile,
      '--no-progress'
    ]), { stdio: ['ignore', 'ignore', 'inherit'] });

    if (!fs.existsSync(mp3File)) {
      throw new Error(`配音生成失败（未产出文件）：场景 ${seg.index}`);
    }
    const duration = probeDuration(mp3File);

    let cues = [];
    if (fs.existsSync(srtFile)) {
      try {
        cues = parseSrt(fs.readFileSync(srtFile, 'utf8'));
      } catch {
        cues = [];
      }
    }
    // 把场景级的高亮词/情绪带到每句 cue，供 ASS 生成使用
    cues = cues.map((c) => ({
      ...c,
      highlights: seg.highlights || [],
      role: seg.role || '',
      emotion: seg.emotion || '',
      titleTexts: seg.titleTexts || []
    }));
    results.push({
      ...seg,
      file: mp3File,
      duration,
      cues,
      narration: spoken,
      narrationOriginal: original,
      textNormalized: spoken !== original
    });
  }
  process.stdout.write('\n');
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const scriptPath = path.resolve(args.script || 'script.yaml');
  const voice = args.voice || 'zh-CN-XiaoxiaoNeural';
  // +5% 能明显减少 edge-tts 中段的机械拖音；仍可用 --rate 覆盖
  const rate = args.rate || '+5%';
  const bgmVolume = String(args['bgm-volume'] || '0.25');
  const noDuck = !!args['no-duck'];
  const normalizeText = !args['no-text-normalize'];
  // burn：烧录带关键词高亮的 ASS 特效字幕（默认）
  // sidecar：只导出 srt/vtt，画面保持干净（旧行为）
  // none：--no-subs，两者都不做
  const subsMode = args['no-subs'] ? 'none' : String(args.subs || 'burn').toLowerCase();
  if (!['burn', 'sidecar', 'none'].includes(subsMode)) {
    fail(`未知的 --subs 模式：${subsMode}（可选 burn / sidecar / none）`);
    process.exit(1);
  }

  if (!fs.existsSync(scriptPath)) {
    fail(`找不到脚本：${scriptPath}`);
    process.exit(1);
  }

  const script = readYamlScript(scriptPath);
  if (!script || !Array.isArray(script.scenes)) {
    fail('脚本缺少 scenes 数组。');
    process.exit(1);
  }

  // 默认产物用 meta.title 命名，避免每条片子都写成 final.mp4 互相覆盖
  const base = baseNameFromScript(
    script,
    scriptPath,
    typeof args.name === 'string' ? args.name : ''
  );
  const outDir = path.resolve(args['out-dir'] || 'output');
  const defaultPaths = outputPaths(outDir, base);
  const outPath = args.out ? path.resolve(args.out) : defaultPaths.video;

  let videoPath;
  if (args.video) {
    videoPath = path.resolve(args.video);
  } else {
    videoPath = fs.existsSync(defaultPaths.silent)
      ? defaultPaths.silent
      : path.resolve('output/video_silent.mp4');
  }

  if (!fs.existsSync(videoPath)) {
    fail(`找不到无声视频：${videoPath}`);
    console.error('  提示：先运行 node render.js --html index.html，或显式传 --video。');
    process.exit(1);
  }

  const videoDuration = probeDuration(videoPath);
  if (!videoDuration) {
    fail('无法读取无声视频时长，ffprobe 可能不可用。');
    process.exit(1);
  }

  // 计算每段旁白的起始时间；脚本没写 start 时按顺序递推
  const segments = [];
  let cursor = 0;
  script.scenes.forEach((scene, index) => {
    if (!scene.narration || !String(scene.narration).trim()) return;
    const hasStart = Number.isFinite(scene.start);
    const start = hasStart ? Number(scene.start) : cursor;
    if (!hasStart) {
      warn(`场景 "${scene.id || index}" 未声明 start，按顺序推定为 ${start}s。`);
    }
    segments.push({
      index,
      sceneId: scene.id || String(index),
      narration: String(scene.narration).trim(),
      start,
      sceneEnd: Number.isFinite(scene.end) ? Number(scene.end) : null,
      highlights: Array.isArray(scene.highlight)
        ? scene.highlight.map(String)
        : (scene.highlight ? [String(scene.highlight)] : []),
      role: String(scene.role || ''),
      emotion: String(scene.emotion || ''),
      // 画面里已经有大标题的文字：字幕若与它同文就跳过烧录，避免一份内容出现两次
      titleTexts: (Array.isArray(scene.elements) ? scene.elements : [])
        .filter((el) => el && String(el.type || '') === 'title' && el.text)
        .map((el) => String(el.text))
    });
    cursor = Number.isFinite(scene.end) ? Number(scene.end) : start;
  });

  if (segments.length === 0) {
    fail('脚本中没有任何 narration，无法生成配音。');
    process.exit(1);
  }

  const tts = resolveTts();
  if (!tts) {
    fail('未找到可用的 edge-tts。');
    console.error(`
  安装方式（任选其一，推荐用模块方式以避免 PATH 问题）：

    1) 本机已装 Python，则执行：
         py -3 -m pip install --upgrade edge-tts
       然后本脚本会自动用 "py -3 -m edge_tts" 调用。

    2) 或把 edge-tts 所在目录加入 PATH（Windows 上通常在
       %LOCALAPPDATA%\\Programs\\Python\\Python3xx\\Scripts）。

    3) 或直接指定命令：
         --tts "C:\\path\\to\\edge-tts.exe"
`);
    process.exit(1);
  }

  // 允许用 --tts 显式覆盖
  if (args.tts) tts.parts = String(args.tts).split(' ').filter(Boolean);

  info(`[节点4] TTS：${tts.label}`);
  info(`[节点4] 音色：${voice}，语速：${rate}，共 ${segments.length} 段旁白`);
  dim(`  旁白文本规范化：${normalizeText ? '开启（统一标点 / 补呼吸停顿）' : '关闭'}`);

  const audioDir = ensureDir(path.resolve(args['audio-dir'] || 'audio'));
  const tmpDir = path.join(audioDir, '.txt');
  const voiceFiles = synthesizeVoice({
    segments, tts, voice, rate, tmpDir, audioDir, normalizeText
  });
  const normalizedCount = voiceFiles.filter((v) => v.textNormalized).length;
  if (normalizedCount) dim(`  ${normalizedCount}/${voiceFiles.length} 段旁白因标点/断句被规范化。`);

  // 旁白溢出检查：配音比场景窗口还长会导致串场
  let overflow = false;
  for (const v of voiceFiles) {
    if (v.duration === null) continue;
    const end = v.start + v.duration;
    const label = `场景 ${v.sceneId}：旁白 ${v.duration.toFixed(1)}s，${fmtTime(v.start)} 起`;
    if (v.sceneEnd !== null && end > v.sceneEnd + 0.3) {
      warn(`${label}，超出场景结束 ${v.sceneEnd}s（溢出 ${(end - v.sceneEnd).toFixed(1)}s）`);
      overflow = true;
    }
    if (end > videoDuration + 0.3) {
      warn(`${label}，超出视频总长 ${videoDuration.toFixed(1)}s，结尾会被截断`);
      overflow = true;
    }
  }
  if (overflow) {
    dim('  建议：精简旁白文案，或把该场景的 start 提前 / 加长场景时长。');
  }

  ensureDir(path.dirname(outPath));

  // ---- 字幕（srt / vtt / ass）----
  // 时间轴直接来自 edge-tts 的逐句边界，和各段配音的 start 偏移相加即可，
  // 不需要 Whisper 二次对齐；代价是只能精确到句，做不到逐字卡拉OK。
  // ASS 在此基础上按字符位置估算关键词出现时刻，做「词级弹跳」。
  let subCues = [];
  let assCues = [];
  let subBase = null;
  let assPath = null;
  let burnSubs = false;

  if (subsMode !== 'none') {
    subCues = offsetAndMerge(
      voiceFiles.map((v) => ({ cues: v.cues || [], start: v.start }))
    );
    if (subCues.length) {
      // 字幕与成片同名，避免多条视频共用 final.srt 互相覆盖
      subBase = path.basename(outPath, path.extname(outPath));
      const srtPath = path.join(path.dirname(outPath), subBase + '.srt');
      const vttPath = path.join(path.dirname(outPath), subBase + '.vtt');
      fs.writeFileSync(srtPath, toSrt(subCues), 'utf8');
      fs.writeFileSync(vttPath, toVtt(subCues), 'utf8');
      info(`[节点4] 字幕：${subCues.length} 条 → ${path.relative(process.cwd(), srtPath)} / .vtt`);

      // 结尾金句常同时作为画面大标题和旁白。大标题已经呈现同文内容时，
      // 再烧一条同样的底部字幕就是重复；srt/vtt 台词稿保留，只过滤烧录。
      assCues = subCues.filter((c) => {
        const titles = Array.isArray(c.titleTexts) ? c.titleTexts : [];
        const text = normalizeSubText(c.text);
        return !titles.some((t) => text && normalizeSubText(t) === text);
      });
      if (assCues.length < subCues.length) {
        dim(`  ${subCues.length - assCues.length} 条字幕与画面大标题同文，跳过烧录（台词稿仍保留）。`);
      }

      if (subsMode === 'burn') {
        if (!hasAssFilter()) {
          warn('当前 ffmpeg 不带 libass（ass 滤镜），无法烧录特效字幕，退回 sidecar 字幕。');
          dim('  处理：换用带 libass 的 ffmpeg，或显式加 --subs sidecar 跳过烧录。');
        } else if (assCues.length === 0) {
          dim('  所有字幕都与画面大标题同文，本次不烧录字幕。');
        } else {
          assPath = path.join(path.dirname(outPath), subBase + '.ass');
          fs.writeFileSync(assPath, toAss(assCues), 'utf8');
          burnSubs = true;
          info(`[节点4] 特效字幕：关键词高亮 / 弹跳缩放 → ${path.relative(process.cwd(), assPath)}`);
          dim('  已烧录进画面；上传平台时不要再挂载同名 .srt，否则会重叠成双份字幕。');
        }
      } else {
        dim('  --subs sidecar：画面保持干净，字幕只以 srt/vtt 外挂。');
      }
    } else {
      dim('  未取到逐句时间轴（edge-tts 未输出字幕），跳过 srt/vtt。');
    }
  }

  // ---- 拼接配音轨 ----
  // 注意两处与常见写法的差异：
  //   1) adelay 用 all=1，兼容 edge-tts 输出的单声道（写成 N|N 在单声道上会出错）
  //   2) amix 必须 normalize=0，否则 N 段旁白会被各自除以 N，人声整体变小
  const voiceMp3 = path.join(audioDir, 'voice.mp3');
  const inputs = voiceFiles.map((v) => `-i "${v.file}"`).join(' ');
  const parts = [];
  const labels = [];
  voiceFiles.forEach((v, i) => {
    const ms = Math.max(0, Math.round(v.start * 1000));
    parts.push(`[${i}:a]adelay=${ms}:all=1[a${i}]`);
    labels.push(`[a${i}]`);
  });
  parts.push(
    `${labels.join('')}amix=inputs=${voiceFiles.length}:duration=longest:normalize=0[voicemix]`
  );
  // apad 把人声轨补到无限长，后面用 -t 精确截到视频长度
  parts.push(`[voicemix]apad[voice]`);

  info('[节点4] 按时间轴拼接配音…');
  run(`${ffmpegBin()} -y ${inputs} -filter_complex "${parts.join(';')}" -map "[voice]" -t ${videoDuration} "${voiceMp3}"`);

  // ---- BGM 自动选曲 ----
  // 优先级：--bgm（用户显式指定）> Jamendo（模型推荐 + 授权曲库）> 本地 audio/bgm/
  let bgm = null;
  if (args['no-bgm']) {
    dim('  --no-bgm：本片不混 BGM。');
  } else {
    const bgmArg = typeof args.bgm === 'string' ? args.bgm : '';
    const styleArg = typeof args['bgm-style'] === 'string' ? args['bgm-style'] : '';
    const meta = script.meta || {};
    const jamendoId = getClientId(
      typeof args['jamendo-client-id'] === 'string' ? args['jamendo-client-id'] : ''
    );
    const wantJamendo = meta.bgm && typeof meta.bgm === 'object' && !bgmArg && !args['no-jamendo'];

    if (wantJamendo) {
      if (!jamendoId) {
        warn('脚本有 meta.bgm 推荐，但未设置 JAMENDO_CLIENT_ID，回退本地 BGM。');
        dim('  免费申请：https://devportal.jamendo.com/（环境变量 JAMENDO_CLIENT_ID）');
      } else {
        info(`[节点4] Jamendo 自动选曲，参考：${referenceText(meta.bgm)}`);
        try {
          bgm = await resolveJamendoBgm({
            script,
            clientId: jamendoId,
            videoDuration,
            limit: Number(args['jamendo-limit'] || 12),
            onLog: (m) => dim(`  ${m}`)
          });
        } catch (err) {
          warn(`Jamendo 选曲失败，回退本地 BGM：${err && err.message ? err.message : err}`);
          bgm = null;
        }
        if (bgm) {
          info(`[节点4] BGM：${bgm.track.name} — ${bgm.track.artist}（Jamendo / ${bgm.license.label}）`);
          dim(`  参考片段：${bgm.reference.text}`);
          dim(`  实际音轨：${path.relative(process.cwd(), bgm.path)}，从 ${formatClock(bgm.startOffset)} 切入`);
          dim(`  署名：${bgm.attribution}`);
          if (bgm.license.nd) {
            warn('该曲为 ND（禁止演绎）授权；把音乐与画面同步可能被认定为演绎，发布前请自行确认。');
          }
          if (!bgm.track.instrumental) {
            warn('该曲未标注为器乐，可能含人声，建议试听后决定是否保留。');
          }
        }
      }
    }

    if (!bgm) {
      bgm = resolveBgm({ script, bgmArg, styleArg });

      if (bgm.source === 'cli' && !bgm.exists) {
        warn(`指定的 BGM 不存在：${path.relative(process.cwd(), bgm.path)}，本次仅使用配音。`);
        bgm = null;
      } else if (!bgm.exists || !bgm.path) {
        warn(`未找到 BGM（风格 ${bgm.style} / ${styleLabel(bgm.style)}），本次仅使用配音。`);
        dim(`  放置方式：audio/bgm/<style>.mp3 或 audio/bgm.mp3；可用风格：${styleNames().join(' / ')}`);
        bgm = null;
      } else {
        if (!isKnownStyle(bgm.style)) {
          warn(`BGM 风格「${bgm.style}」不在推荐列表里，已按文件名关键词匹配。`);
        }
        const srcLabel = {
          'style-exact': '按风格精确匹配',
          'style-keyword': '按风格关键词匹配',
          generic: '通用 bgm.mp3',
          cli: '命令行指定',
          'only-file': '目录内唯一音频'
        }[bgm.source] || bgm.source;
        info(`[节点4] BGM：${path.relative(process.cwd(), bgm.path)}（${styleLabel(bgm.style)} / ${srcLabel}）`);
      }
    }
  }
  const hasBgm = !!(bgm && bgm.exists && bgm.path);

  const filter = [];
  let videoMap = '0:v';
  let videoEncodeArgs = '-c:v copy';
  if (burnSubs && assPath) {
    // 烧字幕必须重新编码视频；ass 滤镜吃的是文件路径，不是内联字节
    filter.push(`[0:v]ass='${escapeFilterPath(assPath)}'[v]`);
    videoMap = '[v]';
    videoEncodeArgs = '-c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium';
  }
  // 统一采样率/声道后再分流：TTS 常见 24kHz 单声道，BGM 常见 44.1/48kHz 立体声，
  // 不先对齐格式，sidechaincompress / amix 在部分 ffmpeg 版本上会协商失败。
  const VOICE_FMT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  const useDuck = hasBgm && !noDuck;
  if (useDuck) {
    // sidechaincompress 会消耗掉第二路输入（人声），最终混音还要再用一次人声，
    // 所以必须先 asplit=2：一路当侧链触发，一路保留给人声主轨。
    filter.push(`[1:a]${VOICE_FMT},volume=1.0,asplit=2[voice][sc]`);
  } else {
    filter.push(`[1:a]${VOICE_FMT},volume=1.0[voice]`);
  }
  let bgmInputArgs = '';
  if (hasBgm) {
    // 循环 BGM 直到视频结束，避免音乐比视频短时后半段静音；
    // 再用 atrim + afade 做首尾淡入淡出，循环接缝不会“啪”地断掉。
    const seek = Number(bgm.startOffset) > 0
      ? `-ss ${Number(bgm.startOffset).toFixed(3)} `
      : '';
    bgmInputArgs = `${seek}-stream_loop -1 -i "${bgm.path}"`;
    const fadeIn = Math.min(0.8, videoDuration / 3);
    const fadeOut = Math.min(1.2, videoDuration / 3);
    const fadeOutAt = Math.max(0, videoDuration - fadeOut);
    filter.push(
      `[2:a]atrim=0:${videoDuration.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `afade=t=in:st=0:d=${fadeIn.toFixed(3)},` +
      `afade=t=out:st=${fadeOutAt.toFixed(3)}:d=${fadeOut.toFixed(3)},` +
      `volume=${bgmVolume},${VOICE_FMT}[bgm]`
    );
    if (noDuck) {
      filter.push(`[voice][bgm]amix=inputs=2:duration=longest:normalize=0[a]`);
    } else {
      // sidechaincompress：第一个输入是被压的 BGM，第二个输入是人声触发信号
      filter.push(`[bgm][sc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[bgmduck]`);
      filter.push(`[voice][bgmduck]amix=inputs=2:duration=longest:normalize=0[a]`);
    }
  } else {
    filter.push(`[voice]anull[a]`);
  }

  info(`[节点4] 与视频合成${hasBgm ? '（含 BGM 自动闪避）' : ''}…`);
  // 关键：这里用 -t 明确指定输出时长，而不是 -shortest。
  // -shortest 会在音轨比视频短时把视频一起截断（实测 10s 视频 + 3s 音频只出 3s）。
  run(
    `${ffmpegBin()} -y -i "${videoPath}" -i "${voiceMp3}" ${bgmInputArgs} ` +
    `-filter_complex "${filter.join(';')}" -map "${videoMap}" -map "[a]" ` +
    `${videoEncodeArgs} -c:a aac -b:a 192k -t ${videoDuration} -movflags +faststart "${outPath}"`
  );

  const finalDur = probeDuration(outPath);
  const rel = (p) => path.relative(process.cwd(), p) || p;

  // 混音清单：节点5 用它核对 BGM 是否真的挂上、闪避是否开启、旁白覆盖率是否足够
  const audioManifest = {
    version: 2,
    generatedBy: 'audio.js',
    title: (script.meta && script.meta.title) || base,
    script: rel(scriptPath),
    video: rel(videoPath),
    out: rel(outPath),
    duration: videoDuration,
    overflow,
    tts: { voice, rate, textNormalized: normalizeText },
    bgm: hasBgm ? {
      file: rel(bgm.path),
      style: bgm.style,
      label: styleLabel(bgm.style),
      source: bgm.source,
      ducking: !noDuck,
      volume: Number(bgmVolume),
      startOffset: Number(bgm.startOffset) || 0,
      reference: bgm.reference || (script.meta && script.meta.bgm) || null,
      track: bgm.track || null,
      license: bgm.license || null,
      attribution: bgm.attribution || null
    } : null,
    scenes: voiceFiles.map((v) => ({
      index: v.index,
      id: v.sceneId,
      start: v.start,
      end: v.sceneEnd,
      voiceDuration: v.duration,
      textNormalized: v.textNormalized,
      narration: v.narration,
      originalNarration: v.narrationOriginal
    }))
  };
  const manifestPath = outPath.replace(/\.[^.\\/]+$/, '') + '.audio.json';
  fs.writeFileSync(manifestPath, JSON.stringify(audioManifest, null, 2) + '\n', 'utf8');

  console.log('');
  ok(`[节点4] 完成 → ${outPath}（${finalDur ? finalDur.toFixed(2) + 's' : '?'}，${humanSize(fs.statSync(outPath).size)}）`);
  dim(`  标题：${(script.meta && script.meta.title) || base}`);
  dim(`  配音轨：${path.relative(process.cwd(), voiceMp3)}`);
  dim(`  混音清单：${path.relative(process.cwd(), manifestPath)}`);
  if (subCues.length && subBase) {
    const srtRel = path.relative(process.cwd(), path.join(path.dirname(outPath), subBase + '.srt'));
    if (burnSubs) {
      dim(`  字幕：已烧录 ${assCues.length} 条特效字幕到画面；同名 srt/vtt 仅作台词稿（${srtRel}）`);
    } else {
      dim(`  字幕：${srtRel}（${subCues.length} 条，未烧录）`);
    }
  }
  if (finalDur && Math.abs(finalDur - videoDuration) > 0.5) {
    warn(`成片时长 ${finalDur.toFixed(2)}s 与无声视频 ${videoDuration.toFixed(2)}s 不一致，请检查。`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    fail('[节点4] 失败：' + (err && err.message ? err.message : err));
    process.exit(1);
  });
}

module.exports = {
  normalizeNarration,
  insertBreathingPauses,
  synthesizeVoice,
  main
};
