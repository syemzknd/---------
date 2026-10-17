#!/usr/bin/env node
'use strict';
/**
 * 节点5：成片质检。
 *
 * 用法：
 *   node qa.js --script script.yaml [--video output/<标题>.mp4]
 *              [--silent output/<标题>_silent.mp4] [--blackdetect]
 *
 * 退出码：0 = 全部通过；1 = 存在硬性问题（需要修复后重跑）。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  info, ok, warn, fail, dim, parseArgs, probeJson, probeDuration,
  readYamlScript, ffprobeBin, ffmpegBin, humanSize
} = require('./lib/util');
const { analyzeVideo, analyzePacing, analyzeComposition } = require('./lib/layout');
const { referenceText } = require('./lib/jamendo');

const DURATION_TOLERANCE = 0.5; // 秒

/**
 * 选质检用的画面源：优先无声视频（没有烧录字幕干扰），
 * 否则退回成片并裁掉底部字幕区。
 */
function pickAnalysisVideo(fallbackVideo, duration, explicit, explicitSilent) {
  if (explicit) {
    return { video: path.resolve(explicit), cropBottom: 0, label: '命令行指定' };
  }

  const candidates = [];
  if (explicitSilent) {
    candidates.push({ file: path.resolve(explicitSilent), label: '命令行指定无声视频' });
  }
  // 与成片同名的无声视频：<标题>_silent.mp4
  candidates.push({
    file: fallbackVideo.replace(/\.mp4$/i, '_silent.mp4'),
    label: '同名无声视频'
  });
  // 兼容旧产物
  candidates.push({ file: path.resolve('output/video_silent.mp4'), label: '无声视频' });

  for (const c of candidates) {
    if (!fs.existsSync(c.file)) continue;
    const silentDur = probeDuration(c.file);
    if (silentDur && Math.abs(silentDur - duration) <= DURATION_TOLERANCE) {
      return { video: c.file, cropBottom: 0, label: c.label };
    }
  }
  return { video: fallbackVideo, cropBottom: 0.18, label: '成片（裁掉底部字幕区）' };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptPath = path.resolve(args.script || 'script.yaml');
  const videoPath = path.resolve(args.video || 'output/final.mp4');

  const problems = [];
  let hardFail = false;
  const W = (m) => { warn(m); problems.push(m); };
  const P = (m) => ok(m);
  const F = (m) => { fail(m); problems.push(m); hardFail = true; };

  info(`[节点5] 质检对象：${path.relative(process.cwd(), videoPath)}`);
  console.log('');

  if (!fs.existsSync(videoPath)) {
    F(`成片不存在：${videoPath}`);
    process.exit(1);
  }

  const meta = probeJson(videoPath);
  if (!meta) {
    F('ffprobe 无法解析该文件，可能未生成完整。');
    process.exit(1);
  }

  const videoStream = (meta.streams || []).find((s) => s.codec_type === 'video');
  const audioStream = (meta.streams || []).find((s) => s.codec_type === 'audio');
  const duration = parseFloat(meta.format && meta.format.duration);

  // 1. 容器与编码
  if (videoStream) {
    P(`视频流：${videoStream.codec_name} ${videoStream.width}x${videoStream.height}`);
    if (videoStream.codec_name !== 'h264') W(`视频编码为 ${videoStream.codec_name}，脚本约定为 H.264。`);
  } else {
    F('没有视频流。');
  }

  if (audioStream) {
    P(`音频流：${audioStream.codec_name} ${audioStream.sample_rate}Hz ${audioStream.channels}声道`);
    if (audioStream.codec_name !== 'aac') W(`音频编码为 ${audioStream.codec_name}，脚本约定为 AAC。`);
  } else {
    F('没有音频流——配音/BGM 未成功写入。');
  }

  // 2. 帧率
  if (videoStream && videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    const fps = den ? num / den : num;
    if (Math.abs(fps - 30) < 0.1) P(`帧率：${fps}fps`);
    else W(`帧率：${fps}fps，与约定的 30fps 不一致。`);
  }

  // 3. 时长 vs 脚本声明
  const script = fs.existsSync(scriptPath) ? readYamlScript(scriptPath) : null;
  let audioManifest = null;
  const declared = script && script.meta && script.meta.duration;
  if (declared) {
    const diff = Math.abs(duration - declared);
    if (diff <= DURATION_TOLERANCE) {
      P(`时长：${duration.toFixed(2)}s（脚本声明 ${declared}s，误差 ${diff.toFixed(2)}s）`);
    } else {
      F(`时长：${duration.toFixed(2)}s，与脚本声明的 ${declared}s 相差 ${diff.toFixed(2)}s（容差 ${DURATION_TOLERANCE}s）。`);
    }
  } else {
    P(`时长：${duration.toFixed(2)}s（脚本未声明 meta.duration，跳过比对）`);
    dim('  提示：在脚本里补上 meta.duration 可自动校验时长。');
  }

  // 4. 文件体积
  const size = fs.statSync(videoPath).size;
  P(`体积：${humanSize(size)}`);
  if (size < 100 * 1024) F('文件过小，疑似产出失败。');

  // 5. 音频是否全静音（BGM/配音都没进去的典型症状）
  if (audioStream) {
    try {
      const out = execSync(
        `${ffmpegBin()} -hide_banner -i "${videoPath}" -af volumedetect -f null - 2>&1`,
        { encoding: 'utf8' }
      );
      const m = out.match(/max_volume:\s*(-?[\d.]+) dB/);
      if (m) {
        const maxVol = parseFloat(m[1]);
        if (maxVol < -60) F(`音轨几乎全静音（max_volume ${maxVol}dB）。`);
        else if (maxVol < -20) W(`音轨偏小（max_volume ${maxVol}dB），请确认配音音量。`);
        else P(`音轨电平正常（max_volume ${maxVol}dB）`);
      }
    } catch {
      dim('  跳过音量检测（volumedetect 不可用）。');
    }
  }

  // 6. 混音清单：节点4 生成的 .audio.json 是判断 BGM 是否真的挂上的最可靠信号
  console.log('');
  info('[节点5] 混音清单检查：');
  const audioManifestPath = videoPath.replace(/\.[^.\\/]+$/, '') + '.audio.json';
  if (fs.existsSync(audioManifestPath)) {
    try {
      audioManifest = JSON.parse(fs.readFileSync(audioManifestPath, 'utf8'));
      P(`  ${path.relative(process.cwd(), audioManifestPath)}`);
    } catch {
      W(`  混音清单无法解析：${path.relative(process.cwd(), audioManifestPath)}`);
      audioManifest = null;
    }
  }
  if (!audioManifest) {
    dim('  未找到混音清单（旧版节点4 产物或手动混音），跳过 BGM / 覆盖率细查。');
  } else {
    const mBgm = audioManifest.bgm;
    if (mBgm && mBgm.file) {
      const source = mBgm.source === 'jamendo' ? 'Jamendo 授权曲库' : (mBgm.source || '本地');
      P(`  BGM：${mBgm.file}（${mBgm.label || mBgm.style} / ${source}，侧链闪避${mBgm.ducking ? '开启' : '关闭'}，音量 ${mBgm.volume}）`);
      if (!mBgm.ducking) {
        W('  BGM 未开启侧链闪避，人声较密时可能被音乐盖住。');
      }
      if (mBgm.track) {
        dim(`    曲目：${mBgm.track.name} — ${mBgm.track.artist}（${mBgm.license ? mBgm.license.label : '授权未知'}）`);
        if (mBgm.license && mBgm.license.commercial === false) {
          W('  该 BGM 为非商业（NC）授权，投稿/变现前需更换或另行取得授权。');
        }
        if (mBgm.license && mBgm.license.attributionRequired) {
          dim('    发布时请按混音清单里的 attribution 字段署名。');
        }
      }
      if (mBgm.reference) {
        dim(`    参考推荐：${mBgm.reference.text || referenceText(mBgm.reference)}`);
      }
    } else {
      W('  未使用 BGM：成片只有人声。配置 JAMENDO_CLIENT_ID 或放置 audio/bgm/<style>.mp3。');
    }
    if (audioManifest.tts) {
      P(`  配音：${audioManifest.tts.voice}，语速 ${audioManifest.tts.rate}，文本规范化${audioManifest.tts.textNormalized ? '开启' : '关闭'}`);
    }
    if (audioManifest.overflow) {
      W('  节点4 记录到旁白溢出场景窗口，请结合下方旁白时间轴确认。');
    }
  }

  // 7. 黑帧/空白帧检测（可选，会完整解码一遍视频）
  if (args.blackdetect) {
    console.log('');
    info('[节点5] 黑帧检测中（完整解码一遍，稍慢）…');
    try {
      const out = execSync(
        `${ffmpegBin()} -hide_banner -i "${videoPath}" -vf blackdetect=d=0.5:pix_th=0.10 -an -f null - 2>&1`,
        { encoding: 'utf8' }
      );
      const hits = [...out.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)];
      if (hits.length === 0) {
        P('未检测到持续 0.5s 以上的黑帧。');
      } else {
        for (const h of hits) {
          W(`黑帧：${parseFloat(h[1]).toFixed(2)}s ~ ${parseFloat(h[2]).toFixed(2)}s`);
        }
      }
    } catch {
      dim('  跳过黑帧检测。');
    }
  }

  // 8. 旁白时间轴与覆盖率
  if (script && Array.isArray(script.scenes)) {
    console.log('');
    info('[节点5] 旁白时间轴与覆盖率检查：');
    let anyVoice = false;

    const manifestScenes = audioManifest && Array.isArray(audioManifest.scenes)
      ? audioManifest.scenes
      : null;

    const entries = manifestScenes
      ? manifestScenes.map((v) => ({
        id: v.id || String(v.index),
        start: Number(v.start) || 0,
        end: Number.isFinite(Number(v.end)) ? Number(v.end) : null,
        voiceDuration: Number(v.voiceDuration)
      }))
      : script.scenes.map((scene, i) => {
        if (!scene.narration || !String(scene.narration).trim()) return null;
        const tag = String(i).padStart(2, '0');
        const f = path.resolve('audio', `voice_${tag}.mp3`);
        if (!fs.existsSync(f)) return null;
        return {
          id: scene.id || String(i),
          start: Number.isFinite(scene.start) ? Number(scene.start) : 0,
          end: Number.isFinite(scene.end) ? Number(scene.end) : null,
          voiceDuration: probeDuration(f)
        };
      }).filter(Boolean);

    if (manifestScenes) dim('  数据来源：节点4 混音清单（.audio.json）');

    for (const v of entries) {
      const d = v.voiceDuration;
      if (!Number.isFinite(d)) continue;
      anyVoice = true;
      const voiceEnd = v.start + d;
      const label = `${v.id}：旁白 ${v.start.toFixed(1)}s→${voiceEnd.toFixed(1)}s`;
      if (v.end !== null && voiceEnd > v.end + 0.3) {
        W(`  ${label}，超出场景结束 ${v.end}s（溢出 ${(voiceEnd - v.end).toFixed(1)}s）`);
      } else {
        P(`  ${label}（场景 ${v.start}s→${v.end ?? '?'}s）`);
      }
      // 旁白覆盖率：低于 75% 时，场景后半段只能靠画面硬撑
      if (v.end !== null && v.end > v.start) {
        const coverage = d / (v.end - v.start);
        if (coverage < 0.75) {
          W(`    ${v.id}：旁白覆盖率 ${(coverage * 100).toFixed(0)}%，低于 75%，场景后半段容易空。`);
        }
      }
    }

    if (!anyVoice) dim('  未找到分段配音或混音清单，跳过该项。');
  }

  // 8. 画面版式：内容有没有被边缘裁切
  //    canvas 里的东西 DOM 查不到，只能读渲染出来的像素。
  console.log('');
  info('[节点5] 画面版式检查（内容是否被边缘裁切）：');
  try {
    const layout = analyzeVideo(videoPath);
    if (layout.clipped.length === 0) {
      P(`  ${layout.sampled} 个采样帧均未发现内容被裁切`);
    } else {
      const pct = ((layout.clipped.length / layout.sampled) * 100).toFixed(0);
      const first = layout.clipped.slice(0, 5)
        .map((c) => `${c.time}s(${c.edges.join('/')})`)
        .join('，');
      const msg = `  ${layout.clipped.length}/${layout.sampled} 个采样帧（${pct}%）有内容被边缘裁切`;
      // 大范围裁切是系统性版式事故，不是某个瞬间的装饰性出血，直接判失败
      if (Number(pct) >= 30) F(msg); else W(msg);
      dim(`    例：${first}`);
      dim('    常见原因：绘制坐标重复加了一次 W/2 或 H/2，内容整体被推到右下角。');
      dim('    检查 HTML 的绘制函数——世界坐标原点应当在画面中心。');
    }
  } catch (err) {
    dim('  跳过版式检查（' + (err && err.message ? err.message.split('\n')[0] : err) + '）');
  }

  // 9. 节奏密度：抽帧比较相邻帧，抓“长时间静止”的区段
  //    优先分析无声视频：烧录字幕后底部区域一直在变，会掩盖画面的静止。
  if (!args['no-pacing']) {
    console.log('');
    info('[节点5] 画面节奏检查（静止超过 4 秒 / 前 3 秒视觉事件）：');
    try {
      const picked = pickAnalysisVideo(videoPath, duration, args['pacing-video'], args.silent);
      const pacing = analyzePacing(picked.video, { cropBottom: picked.cropBottom });
      dim(`  分析对象：${path.relative(process.cwd(), picked.video)}（${picked.label}），4fps 抽帧`);

      if (pacing.sampled < 4) {
        dim('  采样帧太少，跳过节奏判断。');
      } else {
        P(`  画面变化率 ${(pacing.activeRatio * 100).toFixed(0)}%（${pacing.sampled} 个采样帧）`);
        if (pacing.hookChanges < 2) {
          W(`  前 3 秒只有 ${pacing.hookChanges} 次可感知变化，至少需要 2 次。`);
        } else {
          P(`  前 3 秒有 ${pacing.hookChanges} 次可感知变化`);
        }
        if (pacing.firstFrameLuma !== null && pacing.firstFrameLuma < 4) {
          W(`  首帧平均亮度 ${pacing.firstFrameLuma.toFixed(1)}，开场接近纯黑。`);
        }

        if (pacing.overLimit.length === 0) {
          P('  没有超过 4 秒的静止区段');
        } else {
          for (const gap of pacing.overLimit.slice(0, 5)) {
            W(`  静止 ${gap.duration.toFixed(1)}s：${gap.start.toFixed(1)}s → ${gap.end.toFixed(1)}s`);
          }
          if (pacing.overLimit.length > 5) {
            dim(`  另有 ${pacing.overLimit.length - 5} 段静止未列出。`);
          }
          dim('  修法：给长驻留元素加自主运动（呼吸/漂移/脉冲），或在节点3 之前给脚本补视觉事件。');
        }
        if (pacing.longestStatic && pacing.longestStatic.duration > 8) {
          W(`  最长静止 ${pacing.longestStatic.duration.toFixed(1)}s，远超 4 秒上限，完播率会被拉低。`);
        }
        if (pacing.activeRatio < 0.2) {
          W('  全片变化率低于 20%，成片接近“带配音的静态 PPT”。');
        }
      }
    } catch (err) {
      dim('  跳过节奏检查（' + (err && err.message ? err.message.split('\n')[0] : err) + '）');
    }
  }

  // 10. 构图占屏：主焦点外接框 ≥30%，抓“画面太小 / 主体缩在角落”
  //     与节奏检查共用同一个画面源选择逻辑：优先无声视频，避开烧录字幕。
  if (!args['no-composition']) {
    console.log('');
    info('[节点5] 构图占屏检查（主焦点外接框 ≥ 30% 视口）：');
    try {
      const picked = pickAnalysisVideo(
        videoPath,
        duration,
        args['composition-video'] || args['pacing-video'],
        args.silent
      );
      const comp = analyzeComposition(picked.video, { fps: 1, cropBottom: picked.cropBottom });
      dim(`  分析对象：${path.relative(process.cwd(), picked.video)}（${picked.label}），1fps 抽帧`);

      if (comp.valid < 4) {
        dim('  有效采样帧太少（可能接近黑场），跳过构图判断。');
      } else {
        const med = Math.round(comp.medianFocusSpan * 100);
        if (comp.medianFocusSpan < comp.focusMinSpan) {
          W(`  主体占屏中位 ${med}%，低于 30%：主焦点太小，画面容易空。`);
          dim('    修法：放大主图形/数字，或让母题占据画面中心 40–65%。');
        } else {
          P(`  主体占屏中位 ${med}%（阈值 30%）`);
        }

        if (comp.lowFocusRatio > 0.4) {
          W(`  ${Math.round(comp.lowFocusRatio * 100)}% 的采样帧主体占屏 <30%，存在系统性“小画面”问题。`);
        } else {
          P(`  主体占屏低于 30% 的帧：${Math.round(comp.lowFocusRatio * 100)}%`);
        }

        if (comp.medianActiveRatio < 0.02) {
          W(`  前景像素中位占比 ${(comp.medianActiveRatio * 100).toFixed(1)}%，画面可能大面积死黑。`);
        }
        dim(`  有效帧 ${comp.valid}/${comp.sampled}；前景 = 亮度 ≥32 或色度 ≥40 的像素。`);
      }
    } catch (err) {
      dim('  跳过构图检查（' + (err && err.message ? err.message.split('\n')[0] : err) + '）');
    }
  }

  // 11. 特效字幕：节点4 默认把 ASS 烧进画面，同名 .ass 是否存在是关键信号
  console.log('');
  info('[节点5] 特效字幕检查：');
  const assPath = videoPath.replace(/\.[^.\\/]+$/, '') + '.ass';
  if (fs.existsSync(assPath)) {
    const ass = fs.readFileSync(assPath, 'utf8');
    const dialogues = (ass.match(/^Dialogue:/gm) || []).length;
    const highlights = (ass.match(/\\c&H(?!FFFFFF)[0-9A-F]{6}&/g) || []).length;
    if (dialogues > 0) {
      P(`  ${path.relative(process.cwd(), assPath)}：${dialogues} 条字幕，${highlights} 处关键词高亮`);
    } else {
      W('  ASS 文件存在，但没有任何 Dialogue 事件。');
    }
  } else {
    dim('  未找到同名 .ass（可能用了 --subs sidecar / --no-subs，或 ffmpeg 不支持 libass）。');
  }

  // 结论
  console.log('');
  if (hardFail) {
    fail(`[节点5] 质检未通过：存在 ${problems.length} 项问题，需修复后重跑。`);
    process.exit(1);
  } else if (problems.length > 0) {
    warn(`[节点5] 通过，但有 ${problems.length} 项提醒，建议人工确认。`);
  } else {
    ok('[节点5] 质检全部通过 ✓');
  }
}

try {
  main();
} catch (err) {
  fail('[节点5] 失败：' + (err && err.message ? err.message : err));
  process.exit(1);
}
