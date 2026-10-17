# 项目工作流总结

- 文档日期：2026-10-17
- 对应代码：当前工作区
- 样片：本轮新样片见 5.5（标题命名 + Jamendo/BGM 链路验证）；上一轮样片 `output/attention_v1.mp4`（45 秒，注意力切换）；新规则回归样片 `output/parkinson_v2.mp4`；基础样片 `output/parkinson.mp4`；历史样片 `output/2038.mp4`
- 本文只记录现状：工作流、关键提示词、技术实现，以及每个提示词对应的 AI 实际产出示例，不包含迭代建议。
- 本版重点：第 0 节汇总 2026-10-17 两轮迭代（提示词/质检强化 + 标题命名/Jamendo 自动 BGM）、当前脚本生成技术与视频生成技术；第 5 节记录样片数据；第 4.9 节说明为什么没有接入剪映自动化。

---

## 0. 本版变更总览（2026-10-17）

主流程没有变，仍是 `node1 → node2 → render → audio → qa` 五个节点。本日做了两轮迭代：

- **第一轮：约束强度**。把“爆款结构”写成提示词里的硬性段落，再尽量把提示词里的硬性要求落成可执行的静态检查与画面检查；样片 `output/attention_v1.mp4`（主题：应用切换偷走注意力）按新规则从零生成并跑完整条流水线。
- **第二轮：产物命名与自动 BGM**。成片、无声视频、字幕和混音清单全部改为按脚本标题命名；脚本新增 `meta.bgm`（具体参考歌 + 版本 + 片段 + Jamendo 检索词），节点4 在配置 `JAMENDO_CLIENT_ID` 后自动搜索并下载 CC 授权音轨、按参考片段起点切入、侧链闪避混音。第二轮新样片见 5.5。

详细变化如下。

### 0.1 变化清单

| 层面 | 本轮变化 | 落点 | 当前结果 |
|---|---|---|---|
| 选题 | 个人相关性配额（10 个里 ≥7 个）、Golden 3s 钩子（≤18 字，≥3 个极端假设）、截屏级画面 | `prompts/node1-topics.md`、`validateTopicsContent()` | 10 行固定格式，痛点数量与钩子类型可程序检查 |
| 剧本结构 | 五幕情绪曲线固定到秒；每幕 `role` / `emotion`；`golden_line` ≤20 字；`visual_motif` 贯穿 ≥3 幕；`spectacle` 元素；每幕 1–3 个 `highlight` | `prompts/node1-script.md`、`validateScriptContent()` | 脚本阶段就能拦住“没钩子 / 没金句 / 高亮词不在旁白” |
| 旁白节奏 | 目标 3.2–3.5 字/秒；`场景时长 ≥ 字数/3.2 + 0.8`；校验旁白密度与场景窗口 | 提示词 + `validateScriptContent()` | 密度偏离只告警；最终以节点4 TTS 实测时长和节点5 时间窗为准 |
| 渲染器生成 | 新增「节奏密度」「金句卡片」硬性段：2–3 秒一次可感知变化、静止 ≤4 秒、三层结构、第 0 帧有主体、长驻留元素分段推进 | `prompts/node2-prompt.md` | 直接针对 `parkinson_v2` 暴露的 7.5s / 6.3s 静止 |
| 渲染器生成 | 缓动强制（禁 linear）、视觉母题函数化并 ≥3 幕、抽象概念几何化、限制整屏渐变、固定种子 PRNG | 提示词 + `auditVisualLanguage()` | 静态可查“有没有真的用缓动 / 母题 / 随机种子” |
| 视觉聚焦 | 主焦点外接框宽或高 ≥30% 视口（推荐 40–65%）、每幕仅一个 `focus: true`、核心标题 ≥88px、禁止主体缩角落；脚本写 `occupancy` 并由节点1 校验 | `prompts/node1-script.md`、`prompts/node2-prompt.md`、`validateScriptContent()` | 脚本阶段拦“没标主焦点 / 占屏 <0.30”；节点2 静态查 focus/occupancy 是否落地 |
| 转场连续性 | 除片尾压黑外禁止整屏淡入淡出/黑场/硬切；`motifAt(t)` 提供全局连续母题状态，`drawBackground` + `drawMotif` 强制三层结构，边界提前 0.3–0.5s 重叠 | `prompts/node2-prompt.md`、`auditVisualLanguage()` | 静态查 `motifAt` / `drawBackground` / `drawMotif` 是否齐全 |
| 画面自检 | `auditNarrationLeak` 改为逐句探针（按 `。！？；` 拆句，每句去标点取前 10 字），并保留 `elements[].text` 白名单 | `node2.js` | 金句页把第二句 CTA 画成小字也能抓出，避免成片双份字幕 |
| 字幕 | 关键词在“被念到的时刻”变黄/变红并轻微弹跳；与大标题完全同文时自动去重，不重复烧录 | `audio.js`、`lib/subtitle.js` | 本片 18 条 srt 台词，烧录 16 条，12 处关键词高亮 |
| BGM 本地兜底 | 按 `meta.bgm_style` 自动选曲（六种风格，先精确名再关键词再通用兜底）；侧链闪避 + 首尾淡入淡出；输出 `.audio.json` 混音清单 | `lib/bgm.js`、`audio.js` | 找不到时明确告警而不是静默出干声片 |
| **产物命名** | 成片、无声视频、srt/vtt/ass、`.audio.json` 统一使用 `meta.title` 作为基名；Windows 非法字符清洗；`--name` 覆盖、`--unique` 重名加 `_2` | 新增 `lib/naming.js`；`main.js`、`render.js`、`audio.js`、`qa.js` | 不再所有片子都写 `final.mp4` / `video_silent.mp4`；标题一变，产物自动跟着变 |
| **BGM 推荐** | 模型必须给出 `meta.bgm`：歌名 / 艺术家 / 版本 / 起止 `mm:ss` / 歌词或器乐提示 / 是否器乐 / BPM / 英文检索词 / 备用检索词 | `prompts/node1-script.md`、`validateScriptContent()` | 缺字段、片段 <20 秒、时间格式错误、检索词写中文都会在节点1 告警 |
| **BGM 获取** | 配置 `JAMENDO_CLIENT_ID` 后按 `meta.bgm` 调 Jamendo `/tracks/`，排除 NC、优先器乐/可下载，下载到 `audio/bgm/jamendo-<id>.mp3`，按参考片段起点切入并混音 | 新增 `lib/jamendo.js`；`audio.js` | 无 Key / 无结果时回退 `lib/bgm.js` 本地选曲；不会静默失败 |
| **剪映** | 调研了剪映专业版的 UI 自动化、进程参数、草稿目录、加密与官方 API；结论是不做自动接入 | 本文 4.9 | 无官方 API、CEF 界面不稳定、草稿加密、ToS 限制；改用 Jamendo 合法音源 |
| 配音 | 旁白标点规范化（全半角统一、重复标点合并、长句补呼吸逗号，不改字）；默认语速 `+5%` | `audio.js` | 字幕与 TTS 用同一份规范化文本；`--no-text-normalize` 可关闭 |
| 质检 | 新增画面节奏检查（4fps 抽帧、亮度差、静止 >4s、前 3 秒事件数）；旁白时间窗、边缘裁切、ASS 检查保留；新增构图占屏（主体 ≥30%）、旁白覆盖率 ≥75%、BGM/闪避/授权清单检查 | `qa.js`、`lib/layout.js` | 节奏检查抓出 >4s 静止；构图检查抓“主体太小 / 大片死黑”；BGM 检查显示曲目、授权和参考推荐 |
| 回归样片 | `parkinson_v2` 验证新检查能抓问题；`attention_v1` 验证从零出片可通过全部硬性检查；本轮新样片验证标题命名与 Jamendo 选曲 | `output/` | 见 5.2、5.3、5.5 |

### 0.2 当前脚本生成技术

一句话：**DeepSeek 按五幕模板写 YAML，程序只做校验和兜底，不替模型改稿。**

1. **入口**：`node main.js --topic "..." --duration 45`，或 `node node1.js --topic ...` 单独出脚本；也可以先用 `--topics` 出 10 个候选，再从资料 `--extract` / `--book` 生成。
2. **模型与提示词**：`deepseek-v4-pro`。系统提示词是 `prompts/node1-script.md`（资料模式再叠加 `node1-point-script.md`），用户提示词只放选题、时长、分辨率/帧率。
3. **输出格式**：YAML，`meta`（title / duration / fps / golden_line / visual_motif / spectacle / hook_type / bgm_style / **bgm** / audience）+ `scenes[]`（start / end / role / emotion / narration / highlight / elements）。`elements[]` 里每个场景标一个 `focus: true` 并写 `occupancy`（≥0.30）。`meta.bgm` 记录参考歌曲、版本、片段与 Jamendo 检索词，见 0.6。
4. **五幕曲线**：钩子 0–5s、共情 5–15s、拆解 15–30s、顿悟 30–40s、金句 40–45s；其他时长按比例缩放。每幕的 `role` 必须存在，且第一幕不超过全片 12%。
5. **钩子**：只允许极端假设 / 扎心拷问 / 预期反转；前 3 秒禁止“大家好、今天、本期、入门、简介”等开场。
6. **金句**：`meta.golden_line` ≤20 字，最后一幕用 `title` 完整停留 ≥2 秒，全片最多 2 句金句。
7. **母题与奇观**：`visual_motif` 是同一套几何隐喻在 ≥3 幕里“出现 → 变形 → 爆发/收束”；`spectacle` 指定一个截屏级画面，对应元素标 `spectacle: true`。
8. **旁白**：单句 ≤20 字（提示词）/ ≤24 字（程序兜底）；标点不计入语速字数；每幕 1–3 个 `highlight`，必须原样出现在该幕旁白里。
9. **节奏公式**：`场景时长 ≥ 字数 / 3.2 + 0.8 秒`，全片目标 3.2–3.5 字/秒；45 秒目标 144–157 字，60 秒 192–210 字。
10. **校验**：`validateScriptContent()` 检查幕结构、金句长度、钩子、密度、`highlight`、场景首尾相接、元素空窗、`easing`、`spectacle`、`bgm_style`、`meta.bgm`（字段齐全 / 片段时间格式 / ≥20 秒 / BPM / 英文检索词）、每幕 `focus: true` 与 `occupancy ≥0.30`、旁白禁用词；只告警不阻断，YAML 解析失败或缺 `scenes` 才中止。
11. **产物命名**：脚本 `meta.title` 同时是成片、无声视频和字幕的基名，由 `lib/naming.js` 清洗并解决冲突，见 0.6。
12. **上一轮样片**：`attention_v1` 共 5 幕、135 个可发音字（14 / 29 / 50 / 29 / 13），金句“你专注的每一秒，都算数。”；实际 TTS 每幕 3.70 / 9.82 / 14.52 / 8.38 / 4.30 秒，全部落在幕内。按 45 秒计约 3.0 字/秒，按实际发声总时长 40.72 秒计约 3.3 字/秒——提示词里的 3.2–3.5 指有效语速，最终以 TTS 实测为准。本轮新样片见 5.5。

### 0.3 当前视频生成技术

一句话：**DeepSeek 写一个自包含的 Canvas 渲染器；Playwright 按帧号逐帧截图；ffmpeg 合成；edge-tts 配音；同一时间轴生成 ASS 特效字幕并烧录；最后用像素级检查和节奏检查兜底。**

完整技术栈（Node.js、DeepSeek、Canvas 2D、Playwright/Chromium、ffmpeg/libx264、ASS/libass、edge-tts）见 4.0.1。

**1）脚本 → 渲染器（节点2）**

- 输入 `script.yaml` + `prompts/node2-prompt.md` + 主题令牌，输出单个 `index.html`；不联网、不依赖外部字体/脚本。本次渲染器 `output/attention_v1.html` 为 44,351 字节。
- 硬契约：1920×1080、30fps、`window.FPS / DURATION / TOTAL_FRAMES`、纯函数 `window.renderFrame(frameIndex)`；`?frame=N` 只渲染该帧并置 `window.__RENDER_DONE__`。
- 确定性：同帧号必须同画面；禁止 `Date.now()` / `performance.now()` 影响画面；随机粒子、尾迹、星点必须用 `mulberry32` 这类固定种子 PRNG。
- 运动：位移、缩放、透明度、数字滚动全部走缓动（`easeInOutCubic` / `easeOutCubic` / `easeOutBack` / `smootherstep`），禁止 linear；虚拟摄影机用 smootherstep 推进/拉远，并夹紧安全区。
- 视觉：视觉母题 `drawMotif()` 至少贯穿 3 幕并递进；每幕至少背景层 / 母题层 / 数据文字层三层；抽象概念变成几何运动（注意力 → 光点与重启环，累计损耗 → 环堆成的“时间之山”）。
- 节奏：每 2–3 秒一次可感知变化，任何静止不超过 4 秒；长驻留元素必须分段推进，或加确定性自主运动（呼吸、漂移、扫描、脉冲）；第 0 帧就有可见主体。
- 金句：最后一幕金句独立成可截屏卡片，居中无遮挡、停留 ≥2 秒，背景母题收束；压黑只放最后 0.5–1 秒，且在金句完全亮起后开始。
- 静态自检：完整 HTML、渲染契约、无外链、缓动实际调用、`drawMotif` ≥3 次调用、`drawBackground` / `motifAt(t)` 存在、focus/occupancy 落地、固定种子 PRNG、Canvas 路径绘制、无 linear、无 `Math.random`、无真实时钟、旁白不泄漏。

**2）渲染器 → 无声视频（节点3）**

- Playwright（Chromium）以 `file:///...?frame=N` 打开，等 `renderFrame(N)` 和两次 `requestAnimationFrame` 后 `screenshot()`。
- 逐帧 PNG → ffmpeg `-framerate 30` → H.264（crf 18、preset medium、`yuv420p`、`+faststart`）。
- 本片 1350 帧、1920×1080、30fps，无声视频约 7.3MB；复用 HTML 的节点3→5 复跑（含渲染、配音、字幕烧录、质检）约 6 分钟。

**3）配音与字幕（节点4）**

- edge-tts 按场景逐段合成 `audio/voice_XX.mp3`，再按 `scene.start` 放到同一条时间轴；本片实际时长 3.70 / 9.82 / 14.52 / 8.38 / 4.30 秒，均在幕内结束。
- 字幕：edge-tts 的 `SentenceBoundary` 给句子起止；`highlight` 词按“句子内标点加权字位”估算出现时刻，到点变黄 `#fcd34d`（峰值红色 `#ef4444`）并 1.14 倍弹跳回 1.0。
- 去重：如果 `highlight` 所在句或金句与画面大标题完全同文，srt/vtt 保留台词稿，但 ASS 不重复烧录。本片 18 条 srt、16 条 ASS，去重的两句是拆解幕“值吗？”与金句幕大标题。
- 混音：本片无 BGM（`audio/bgm.mp3` 不存在），只有配音；有 BGM 时会先闪避到 0.25 左右，再与人声混合。
- 输出：H.264 + AAC 24kHz 单声道，字幕烧录在底部 160px 安全区内。
- 注：这是上一轮 `attention_v1` 的实测数据。本轮起，脚本带 `meta.bgm` 且配置
  `JAMENDO_CLIENT_ID` 时，节点4 会自动从 Jamendo 取得授权音轨并混入；产物也改为
  按标题命名，不再写 `final.mp4` / `video_silent.mp4`。

**4）成片质检（节点5）**

| 检查 | 本片结果 |
|---|---|
| 视频 / 音频流、帧率、时长、体积 | h264 1920×1080 / aac 24kHz 单声道 / 30fps / 45.00s / 8.5MB，全部通过 |
| 音量 | max_volume -3.4dB，通过 |
| 旁白时间窗 | 5 段全部在幕内结束（最晚金句 44.3s），通过 |
| 边缘裁切 | 45 个采样帧均未发现内容被裁切，通过 |
| 画面节奏 | 变化率 65%（180 个采样帧），前 3 秒 8 次变化，无 >4 秒静止，通过 |
| 特效字幕 | 16 条字幕、12 处关键词高亮，通过 |

### 0.4 本轮实测问题与修复

| 问题 | 现象 | 根因 | 修复 | 回归结果 |
|---|---|---|---|---|
| 金句旁白超时 | 原句 TTS 6.4 秒，从 40s 播到 46.4s，45s 处被截断 | 最后一幕台词过长 | 缩为“你专注的每一秒，都算数。删掉它。” | 4.30 秒，44.3 秒结束 |
| 共情旁白压到下一幕 | 10.44 秒，从 5s 播到 15.44s，与拆解幕配音重叠 | 台词过长 | 缩为 9.82 秒 | 14.8 秒结束 |
| 旁白被画进画面 | 金句幕第二句被画成灰色小字，成片出现双份字幕 | 模型把 `narration` 当画面文案；旧审计只探旁白开头 10 字 + 标题白名单，漏掉后一句 | 删掉该小字；`auditNarrationLeak` 改为逐句探针 | 用旧版 HTML + 旧旁白构造回归，能命中“删掉那个多余的应用今”；新片返回空 |
| 长静止 | 质检发现 8.3 秒和 5.5 秒两段画面静止 | 稀疏场景只有标题/静态图形 | 加环境重启环（固定种子）、上下扫描光束、波形扫描头 | 变化率 65%，无 >4 秒静止 |
| 金句压黑过早 | 压黑起点提前，金句可截屏窗口被压缩 | 收尾转场起点太早 | 改为 44.2s 开始、0.8 秒完成 | 金句 40–44.2s 完整停留 |
| 高亮词不在旁白 | hook 的 `highlight` 原写“切换”，旁白是“切一次” | 高亮词与旁白不一致，节点4 无法定位 | 改为“切一次” | 节点1 校验不再告警 |
| 新片首次渲染失败 | `addColorStop` 报 `rgbaa(34,211,238` 不是合法颜色 | 模型写的 `radialGlow()` 假定调用方传完整 `rgba(...)`，实际调用传的是缺右括号的前缀，`replace('rgb','rgba')` 二次加 a | 改成解析颜色前缀后统一拼 `rgba(r,g,b,a)`；渲染预检通过 | 新片正常渲染 |
| `--help` 误触发出片 | 运行 `node main.js --help` 直接进入既有 `script.yaml` 的渲染 | `main.js` 没有帮助分支，未知参数被忽略 | 增加 `--help/-h` 分支，只打印用法后退出 | 不再启动渲染 |

### 0.5 重跑与改稿策略

- **只改旁白/高亮**：直接改 `script.yaml`，再执行 `node main.js --script ... --html ...`。旁白本就不该画进画面，HTML 可以复用；节点3 重渲染，节点4/5 重跑。成片默认按标题命名；想保留上一版加 `--unique`，或先用 `--name "标题_v2"`。
- **只改画面**：可以直接改 HTML，或加 `--force-node2` 让模型重写；之后同样重跑节点3→5。
- **改场景边界（start/end）**：必须同时重生成渲染器和配音。画面、配音、字幕共用一个时间基准，不能只改一处。
- **脚本超长/超时**：优先缩短旁白，不要先动场景边界。本次两个超时问题都是靠删字解决，幕结构保持不变。
- **验收**：以节点5 的输出为准——旁白时间窗、画面节奏、ASS 事件数三项必须看；只看成片“感觉还行”不可靠。

```bash
# 复用已有脚本和渲染器，重跑最新样片
node main.js --script output/attention_v1.yaml --html output/attention_v1.html --video output/attention_v1.mp4

# 默认按 meta.title 命名并覆盖同名产物；--unique 重名时追加 _2、保留旧版
node main.js --script output/attention_v1.yaml --html output/attention_v1.html --unique
```

### 0.6 本轮新增：标题命名与 Jamendo 自动 BGM

#### 1）为什么不是“调用剪映搜歌”

需求最初是：模型推荐具体歌曲和片段 → 调用剪映专业版 → 搜同名单曲 → 与视频合成。
调研后没有采用，原因写在 4.9：剪映专业版（11.3.0.14362）没有官方公开 API；
界面是 CEF + Qt，现代版本的编辑区不向 Windows UIAutomation 暴露控件；
搜索框不接受合成键盘/剪贴板输入；草稿 JSON 从 6.x 起加密且有 `crypto_key_store.dat`；
自动化还受软件 ToS 限制。即使硬做出来，换版本就会失效，无法作为流水线依赖。

因此改为**“模型给创作意图，Jamendo 提供合法音源”**：

- 模型必须说清参考歌曲、版本、具体片段（`mm:ss`）和歌词/器乐提示；
- 实际使用的音轨来自 Jamendo 的 Creative Commons 曲库；
- 不做“下载商业原曲”，也不把 Jamendo 返回的曲目冒充成参考歌曲。

#### 2）产物命名（`lib/naming.js`）

`meta.title` 现在是整条链路的产物基名：

```text
output/<标题>.mp4              成片
output/<标题>_silent.mp4       无声视频（节点3）
output/<标题>.srt / .vtt       台词稿
output/<标题>.ass              烧录用的特效字幕
output/<标题>.audio.json       混音清单
```

- Windows 非法字符 `< > : " / \ | ? *` 和控制字符替换为空格；结尾的点和空格去掉；
  标题过长按 Unicode 字符截到 80 个；`CON`、`NUL` 等保留设备名加前导下划线。
- 默认**覆盖同名**产物，便于同一标题重跑更新；`--unique` 时若 `<标题>.mp4`、
  `<标题>_silent.mp4` 或 `<标题>.audio.json` 任一存在，自动追加 `_2`、`_3`，保留旧版。
- `--name "自定义基名"` 可覆盖标题；`--out-dir` 可把这一条的产物集中到子目录。
- `main.js` 在脚本落盘后先读 `meta.title`，再算出成片/无声路径，显式传给
  `render.js --silent`、`audio.js --video/--out`、`qa.js --silent`，避免各节点各自猜路径。
- `render.js`、`audio.js` 单独运行时也会按脚本标题推导默认路径；仍兼容旧参数和旧
  `output/video_silent.mp4`。

实测（临时测试目录）：`命名测试 临时.yaml` 产出了
`命名测试 临时.mp4`、`命名测试 临时_silent.mp4`、`.srt`、`.vtt`、`.ass`、
`.audio.json`，文件名中的空格与中文都保留，`ffprobe` 时长 4.00s。

#### 3）模型侧的 `meta.bgm`

`prompts/node1-script.md` 新增必填段：

```yaml
meta:
  bgm_style: ambient_tech_tension       # 本地兜底风格，六选一
  bgm:
    song: Time
    artist: Hans Zimmer
    version: Inception 原声（纯器乐版）
    segment_start: "01:23"
    segment_end: "02:05"
    lyric_cue: 00:45 低音提琴进入，01:23 起逐步叠加弦乐
    instrumental: true
    mood: 紧张、克制、逐步上扬
    bpm: 112
    jamendo_query: dark ambient tension pulse
    jamendo_tags: [dark, ambient, instrumental]
    fallback_queries: [cinematic suspense drone, minimal tech pulse]
```

`node1.js` 的 `validateScriptContent()` 会检查：六个文本字段齐全；起止时间能解析成
`mm:ss`；结束晚于开始且片段 ≥20 秒；`instrumental` 是布尔值；BPM 在 40–220；
`jamendo_query` 不能是中文或歌名；`jamendo_tags` / `fallback_queries` 是数组。
仍然只告警、不阻断，但缺 `meta.bgm` 时会明确提示“只能按风格兜底”。

#### 4）Jamendo 自动选曲（`lib/jamendo.js`）

前置：免费申请 Client ID（https://devportal.jamendo.com/），设置环境变量
`JAMENDO_CLIENT_ID`，或单次传 `--jamendo-client-id`。没有 Key 不做任何网络请求。

节点4 的选曲优先级：

```text
--bgm 显式文件
  > Jamendo（有 Key 且脚本有 meta.bgm 且未加 --no-jamendo）
  > 本地 audio/bgm/（lib/bgm.js）
```

Jamendo 链路：

1. 从 `meta.bgm` 组装最多 4 条检索词：`jamendo_query` → `fallback_queries` →
   `mood` / `jamendo_tags` → `bgm_style` 关键词；标签走 `fuzzytags`。
2. 请求 `https://api.jamendo.com/v3.0/tracks/`：
   `format=json`、`audioformat=mp32`、`audiodlformat=mp32`、
   `include=musicinfo licenses`、`order=relevance`、`limit=12`；
   尝试 `vocalinstrumental=instrumental`，API 不接受该参数时自动去掉重试。
3. 结果过滤：必须有下载地址且 `audiodownload_allowed !== false`；
   解析 `license_ccurl`，**排除 NC（非商业）授权**；`ND`（禁止演绎）保留但降权并告警。
4. 打分：器乐 +8、可商用 +5、非 ND +2、时长达标 +2、标签重合最多 +4；
   按分数取前 5 首依次尝试下载。
5. 下载到 `audio/bgm/jamendo-<track-id>.mp3`（按 id 缓存，超过 10KB 才复用；
   先写 `.part` 再 rename，避免半截文件）。
6. 按参考片段起点 `segment_start` 挑选切入秒数，并夹紧到“音轨长度 − 视频长度”，
   通过 ffmpeg 输入参数 `-ss` 切入；再沿用已有的循环、淡入淡出、侧链闪避链路。
7. 全部候选都失败时抛错，`audio.js` 回退本地 `resolveBgm()`，成片不会因此中断。

混音清单 `.audio.json`（version 2）新增：

```json
{
  "title": "视频标题",
  "bgm": {
    "source": "jamendo",
    "startOffset": 10,
    "reference": { "song": "Time", "artist": "Hans Zimmer", "...": "..." },
    "track": { "id": "...", "name": "...", "artist": "...", "duration": 40 },
    "license": { "code": "by-sa", "nc": false, "nd": false, "commercial": true },
    "attribution": "曲名 — 作者（CC BY-SA，许可 URL，来源 Jamendo：曲目页）"
  }
}
```

节点5 会显示实际曲目、授权与参考推荐；NC 授权会告警，要求发布前更换或取得授权。

**授权边界（必须知道）**：

- Jamendo API 返回的是 CC/Jamendo 授权曲目，不是参考歌本身；`meta.bgm.song` 只是
  创作与检索依据，不会下载或合成商业原曲。
- 发布时按 CC 条款署名；混音清单里的 `attribution` 可直接复制。
- Jamendo 免费 API 适合非商业应用；如果成片用于商业投放，需逐首确认 CC 条款，
  或与权利方/ Jamendo 另行取得商业授权。
- 商用最稳妥的做法仍是：`--no-jamendo` + 自有授权音源 `--bgm <文件>`。

#### 5）离线测试怎么做

`lib/jamendo.js` 支持 `JAMENDO_API_BASE` 环境变量，可指向本地 mock 服务。
本轮用本地 HTTP mock 验证了：NC 曲目被过滤、CC BY-SA 曲目被下载、
`startOffset` 按参考片段取 10 秒、`.audio.json` 写入曲目/授权/署名，
以及节点4 完整混音成功。真实 Jamendo Key 尚未配置，真实曲库检索待 Key 到位后回归。

---

## 1. 项目定位与入口

给一句话选题，或导入一份资料，由 DeepSeek 写出视频脚本；再由 DeepSeek 根据脚本生成一个自包含的 HTML Canvas 渲染器；Playwright 逐帧截图，ffmpeg 合成视频；edge-tts 配音并导出字幕；最后做质检。

两种入口：

- **提示词 → 视频**：给一个主题，或先让 DeepSeek 列 10 个候选选题，挑一个出片。
- **资料 → 视频**：导入 txt/md 资料，DeepSeek 拆出知识点，取其中一条写成脚本并出片。

所有 LLM 调用走 DeepSeek，密钥来自环境变量 `DEEPSEEK_API_KEY`。

### 1.1 入口命令与产出

| 入口 | 命令 | 产出 |
|---|---|---|
| 只生成候选选题 | `node main.js --topics "计算机与二进制"` | `output/topics.md`（10 行选题） |
| 选题 → 成片 | `node main.js --topic "..." --duration 45` | `script.yaml` → `index.html` → `output/<meta.title>.mp4`（字幕/无声视频同名） |
| 资料 → 成片 | `node main.js --material 资料.txt --index 1 --duration 45` | `output/points.md` → `script.yaml` → 成片 |
| 现成知识点 → 成片 | `node main.js --points output/points.md --index 1` | `script.yaml` → 成片 |
| 已有脚本 → 成片 | `node main.js --script script.yaml` | `index.html`（缺失时生成）→ `output/<meta.title>.mp4` |

> 中间产物 `script.yaml` / `index.html` 仍是固定名（项目状态文件）；最终产物全部按
> `meta.title` 命名。需要每条片子独立目录时加 `--out-dir output/<slug>`。

### 1.2 分步运行

```bash
node node1.js --topics "二进制"                         # → output/topics.md
node node1.js --topic "计算机差点不用二进制"             # → script.yaml
node node1.js --extract 资料.txt                        # → output/points.md
node node1.js --book output/points.md --index 1          # → script.yaml
node node2.js --script script.yaml --theme midnight --out index.html
node render.js --html index.html --script script.yaml [--silent "output/<标题>_silent.mp4"] [--clean]
node audio.js  --script script.yaml [--video "output/<标题>_silent.mp4"] [--out "output/<标题>.mp4"] \
               [--bgm audio/bgm.mp3] [--bgm-style ambient_tech_tension] \
               [--jamendo-client-id <id> | --no-jamendo] [--voice zh-CN-XiaoxiaoNeural] [--rate +5%]
node qa.js     --script script.yaml --video "output/<标题>.mp4" [--silent "output/<标题>_silent.mp4"] [--blackdetect]
```

---

## 2. 工作流总览

```
提示词 / 资料
   │
   ▼
节点1  node1.js
   ├─ --topics  → output/topics.md
   ├─ --topic   → script.yaml
   ├─ --extract → output/points.md
   └─ --book    → script.yaml
   │
   ▼
节点2  node2.js
   └─ DeepSeek + 提示词 + 主题令牌 → index.html（Canvas 渲染器）
   │
   ▼
节点3  render.js
   ├─ Chromium 逐帧调用 renderFrame()
   ├─ frames/frame-00000.png ... frame-01349.png
   └─ ffmpeg → output/<标题>_silent.mp4
   │
   ▼
节点4  audio.js
   ├─ edge-tts 逐场景配音 → audio/voice_XX.mp3
   ├─ 合并音轨 → audio/voice.mp3
   ├─ BGM：--bgm 文件 > Jamendo 授权选曲 > 本地 audio/bgm/
   ├─ ASS 特效字幕（关键词高亮 / 弹跳 / 与大标题同文时自动去重）+ srt / vtt
   └─ BGM 闪避混音 + 字幕烧录 → output/<标题>.mp4 / .ass / .srt / .vtt / .audio.json
   │
   ▼
节点5  qa.js
   └─ ffprobe + volumedetect + 黑帧 + 旁白时间窗 + 边缘裁切 + 画面节奏 + ASS 字幕 + BGM 授权清单
```

### 2.1 节点职责

| 节点 | 文件 | 输入 | 核心处理 | 输出 |
|---|---|---|---|---|
| 0 | `setup.js` | 环境 | 检查 Node、ffmpeg、DeepSeek Key、edge-tts、js-yaml、Playwright、Chromium | 安装指引 / 检查报告 |
| 1 | `node1.js` | 选题 / 资料 / 知识点 | 调用 DeepSeek，解析 YAML，校验五幕/BGM 推荐 | `topics.md` / `script.yaml` / `points.md` |
| 2 | `node2.js` | `script.yaml` + 主题 | 调用 DeepSeek 生成 HTML，静态自检 | `index.html` |
| 3 | `render.js` | `index.html` + `script.yaml` | Playwright 逐帧截图，ffmpeg 编码；按标题命名无声视频 | `frames/*.png`、`output/<标题>_silent.mp4` |
| 4 | `audio.js` | `script.yaml` + 无声视频 | edge-tts、时间轴拼接、Jamendo/本地 BGM、闪避、ASS 烧录 | `output/<标题>.mp4`、`.ass`、`.srt`、`.vtt`、`.audio.json` |
| 5 | `qa.js` | 成片 + 脚本 + 同名无声视频 | 编码/时长/音量/黑帧/旁白窗口/边缘裁切/画面节奏/构图/ASS/BGM 授权 | 控制台报告，硬性问题退出码 1 |

`main.js` 的编排规则：

1. 带 `--topic` / `--material` / `--points` 时先跑节点1 生成脚本；脚本落盘后才进入节点2。
2. 节点2 只在「脚本是新生成的 / HTML 不存在 / 加了 `--force-node2`」时执行，否则复用现成 HTML。
3. 节点3 固定执行；节点4 可用 `--skip-node4` 跳过，只出无声视频。
4. 节点5 质检失败只告警，不删除成片；硬性问题由 `qa.js` 以退出码 1 标记。

---

## 3. 关键提示词与实际 AI 产出

提示词全部放在 `prompts/`。下面每个小节给出：提示词的核心约束、实际调用命令、AI 实际产出的文本示例。

### 3.1 选题提示词：`prompts/node1-topics.md`

**角色与任务**

> 你是一个短视频选题策划。你为 30–90 秒的可编程动画科普视频找选题，标准只有一个：**观众为什么非看不可。**
>
> 根据用户给出的领域/方向，输出 10 个候选选题。**不要写脚本。**

**核心约束**

- **个人相关性配额**：10 个候选选题里至少 7 个必须关乎大众生活、拖延症、认知偏差、
  效率陷阱或时间管理；纯技术冷知识直接淘汰。技术领域要先映射到“普通人的哪件日常小事”。
- 选题必须同时满足“反直觉认知差”和下面任意一条：
  1. 有代价：背后有一个差点失败、差点晚诞生、差点出事的时刻。
  2. 有痛点：和观众每天用的东西直接相关。
  3. 有反转：结果和开头的预期相反。
- **Golden 3s 钩子**：每个选题必须自带一个“极端假设 / 扎心拷问 / 预期反转”的开头旁白，
  禁止“XX 定律指出……”这种平铺直叙；钩子 ≤18 字、能直接念；
  10 个候选里**至少 3 个必须用「极端假设」开局**，三种类型都要出现。
- 禁止：`XX 是什么`、`XX 入门`、`XX 简介`、纯知识清单、没有冲突/代价/反转的平铺直叙。
- 每个选题必须能想出一个「截屏级画面」，满足任意两条：尺度反差、数量冲击、意外运动、视觉比喻、颜色突变；且必须能用 Canvas 2D 几何图形画出来。数量冲击要写具体数量（20 张、480 个粒子）。
- 输出格式固定为 10 行：

```
选题名 | 选题类型 | 生活痛点映射 | 一句话核心 | 钩子类型 | 开头钩子（≤18字） | 截屏级画面
```

**实际调用**

```bash
node node1.js --topics "计算机与二进制：计算机历史、硬件、数字世界" --out output/topics-binary.md
```

模型：`deepseek-v4-pro`。

**AI 实际产出**（`output/topics-binary.md`，逐字）

```
真空管计算机天天在烧真空管 | 有代价/反常识 | ENIAC 用 17000 根真空管，平均每两天烧毁一根，工程师拎着篮子找坏管 | 密密麻麻的真空管灯丝组成城市街区，一根接一根爆成暗红色，像街区连续停电
你删除的文件其实从没消失 | 反常识/有反转 | 删除只是标记可覆盖，底层比特块还在，直到被新数据碾过 | 文件图标掉进垃圾桶，但底层彩色方块只是半透明变灰，新数据像推土机一排排碾过去才真正消失
0.1+0.2 不等于 0.3 差点让导弹漏人 | 反常识/有代价 | 二进制无法精确表示十进制小数，爱国者导弹因时间截断误差错过拦截 | 小数点后数字在二进制中无限循环，像多米诺骨牌不断倒下，最后导弹轨迹偏出一个身位
你的内存每秒都在失忆，靠刷新脉冲续命 | 有痛点/反常识 | DRAM 电容几十毫秒就漏电，必须每秒刷新上百次，否则数据会消失 | 一排小水桶（电容）不断漏水，蓝色电荷滴下，一道刷新脉冲像海浪扫过，把水桶重新灌满
一粒灰尘就能让整片晶圆报废 | 有代价/反常识 | 芯片线宽只有几纳米，落一粒灰尘相当于整座城市被陨石击中 | 晶圆上的晶体管街道横平竖直，一粒圆形灰尘落在中间，裂纹像陨石坑向四周扩散
计算机的“bug”真的是一只飞蛾 | 有反转/有代价 | 1947年哈佛 Mark II 故障，格蕾丝·霍珀从继电器里夹出一只飞蛾，bug 一词从此传开 | 金属继电器触点之间夹着一只几何飞蛾，火花从两侧跳过，电流路径绕成红色断点
二维码被撕掉一角还能扫，因为它自带备份 | 反常识/有痛点 | 二维码里藏了纠错码，污损一部分也能恢复原始数据 | 黑白方块拼成的二维码被撕掉一角，缺失区域像拼图一样自动长出新的方块补全，整块码颤动后恢复完整
2038年，32位时间戳将把日历炸回1901年 | 有代价/反常识 | Unix 时间用 32 位有符号整数，到 2038 年溢出，像千年虫但更隐蔽 | 一个由二进制齿轮组成的计数器从 011111... 翻成 100000...，下方日历年份从 2038 倒转成 1901
硬盘磁头贴着盘面飞行，高度比烟粒还小 | 有代价/反常识 | 磁头在盘片上方 3 纳米飞行，一粒烟尘就像一座山，相撞即数据报废 | 三角形磁头像飞机贴着圆盘表面掠过，盘片上一粒尘埃变成巨大障碍物，撞击瞬间火花散射
宇宙射线正在随机翻转你电脑里的比特 | 反常识/有代价 | 高能粒子击中内存，把 0 变成 1，可能导致蓝屏、航班俯冲或选票错误 | 整齐的黑白方块比特阵中，一道黄色射线斜穿而过，所经之处方块像多米诺一样变色翻转
```

第 8 行就是 `output/script-2038.yaml` 的选题来源。

> 注：以上是**迭代前**的实际产出（4 列，偏技术冷知识）。当前提示词已改为 7 列
> （增加「生活痛点映射」「钩子类型」「开头钩子」），要求 10 个里至少 7 个关乎日常痛点，
> 且至少 3 个用「极端假设」开局；节点1 的 `validateTopicsContent()` 会逐条校验。

---

### 3.2 剧本提示词：`prompts/node1-script.md`

**角色与任务（节选）**

> 你是一个「短视频科普编剧」，为 30–90 秒的可编程动画视频写脚本。
> 根据用户给出的选题和时长，写一条完整的视频脚本，输出为 YAML。

**核心约束**

- **五幕情绪曲线**（45 秒版，其他时长按比例缩放）：
  1. 焦虑/痛点（0–5s）：极端假设、扎心拷问或预期反转。
  2. 痛苦共情（5–15s）：说出观众每天经历但说不出口的瞬间。
  3. 理论拆解（15–30s）：一层层揭开原理，每揭一层给一个视觉反馈。
  4. 醍醐灌顶/解法（30–40s）：反直觉结论或可执行解法。
  5. 金句升华（40–45s）：用一句适合截屏的话收束，落回具体的人。
- **Golden 3s**：前 3 秒只能是「极端假设 / 扎心拷问 / 预期反转」；
  禁止「大家好、今天、本期、入门、简介、让我们、有没有想过」和平铺直叙的定义句。
- **金句**：`meta.golden_line` ≤20 字，适合截屏发朋友圈，最后一幕用 title 显示至少 2 秒，全片最多 2 句。
- **视觉母题**：`meta.visual_motif` 指定全片复用的核心隐喻，至少贯穿 3 个场景并递进
  （出现 → 变形 → 爆发/收束）；抽象概念必须写成具体几何运动。
- **视觉奇观**：写进 `meta.spectacle`，并在对应元素标 `spectacle: true`；判断标准满足任意两条：尺度反差、数量冲击、意外运动、视觉比喻、颜色突变。
- **旁白**：每句不超过 20 字；禁用「首先/其次/然后/最后/因此/综上所述」「我们可以看到/不难发现/众所周知」；旁白只写在 `narration`，绝对不要写进 `elements`。
- **语速**（已放慢）：

  ```
  场景时长 ≥ 字数 / 3.2 + 0.8 秒
  ```

  目标 3.2–3.5 字/秒；45 秒应写 **144–157 字**；60 秒应写 **192–210 字**。
  每个场景的预计配音时长不得低于场景时长的 75%，否则就是靠留白凑时长。
- **字幕高亮**：每个场景写 `highlight: [核心词]`（1–3 个），词必须原样出现在旁白里，供节点4 做 ASS 关键词高亮。
- **BGM 推荐**：`meta.bgm` 必须具体到歌曲、艺术家、版本、起止时间（`mm:ss`，片段 ≥20 秒）、
  歌词或器乐提示、是否器乐、BPM，并给英文 `jamendo_query` 与 1–2 条 `fallback_queries`；
  `meta.bgm_style` 仍作为本地兜底。参考曲只用于创作意图，项目实际从 Jamendo 获取可授权替代曲。
- **缓动**：元素写 `easing: easeOutBack / easeInOutCubic / easeOutCubic`，禁止 linear。
- **节奏**：每 2–3 秒画面必须有一次可感知变化；不允许画面静止超过 4 秒；前 3 秒至少 2 次视觉事件并出现第一个非文字画面元素；禁止超过 3 秒的纯文字停留；每个场景至少有一个持续运动的主角，元素时间窗不得出现 >3 秒空窗。
- **Canvas 2D 边界**：
  - 白名单：文字、数字、公式、代码；圆、矩形、线条、箭头、虚线、多边形、网格、坐标轴；图表、进度条；几何图形拼出的简笔图标；淡入淡出、滑动、缩放、旋转、打字机、描边、粒子、代码雨、光晕、脉冲、高亮框、数字滚动；用缩放和位移模拟镜头。
  - 黑名单：实拍、真人、人脸、照片；3D、复杂运镜、景深、光照渲染；流体、爆炸、火焰、烟雾、毛发、布料；骨骼/表情动画；无法用几何描述的指令。

**提示词规定的输出结构**（节选）

```yaml
meta:
  title: 视频标题
  duration: 45
  fps: 30
  resolution: 1920x1080
  primary: "#22d3ee"
  background: "#06080f"
  hook_type: [极端假设]   # 极端假设 / 扎心拷问 / 预期反转
  core_message: 观众看完会记住的那一句话
  golden_line: ≤20 字、适合截屏的金句
  visual_motif: 全片复用的核心视觉隐喻，以及它如何从出现到爆发/收束
  spectacle: 截屏级画面的一句话描述
  audience: 目标受众
  bgm_style: ambient_tech_tension
  bgm:
    song: Time
    artist: Hans Zimmer
    version: Inception 原声（纯器乐版）
    segment_start: "01:23"
    segment_end: "02:05"
    lyric_cue: 00:45 低音提琴进入
    instrumental: true
    mood: 紧张、克制、逐步上扬
    bpm: 112
    jamendo_query: dark ambient tension pulse
    jamendo_tags: [dark, ambient, instrumental]
    fallback_queries: [cinematic suspense drone]

scenes:
  - id: hook            # 英文短 id，全片唯一
    start: 0
    end: 3
    role: 钩子           # 钩子 / 共情 / 拆解 / 顿悟 / 金句
    emotion: 焦虑         # 焦虑 / 共情 / 拆解 / 顿悟 / 金句
    narration: 你计划了三小时，真正开始工作的时间有几分钟？
    highlight: [计划, 开始工作]
    elements:
      - type: title
        text: 你的三小时，去哪了？
        at: [0, 3]        # 绝对秒数，必须落在本场景内
        color: "#ffffff"
        size: 72
        motion: 从右侧快速滑入，轻微抖动
        easing: easeOutBack
      - type: progress
        at: [1, 3]
        position: 画面下方
        motion: 进度条收缩到 12%，末尾闪一次警示红
        color: "#22d3ee"
        accent_color: "#ef4444"
        easing: easeInOutCubic
        spectacle: true
```

**实际调用**

```bash
node node1.js --topic "2038年，32位时间戳将把日历炸回1901年" --duration 45 --out output/script-2038.yaml
```

模型：`deepseek-v4-pro`。

**AI 实际产出**（`output/script-2038.yaml`，节选）

> 注：该文件在生成后做过两处事实修正：`1901.1.1` → `1901.12.13`；冲突场景计数器起点 `964000000` → `0`。以下是修正后的内容。

```yaml
meta:
  title: 2038年，你的手机会以为回到了1901年
  duration: 45
  fps: 30
  resolution: 1920x1080
  primary: "#22d3ee"
  background: "#06080f"
  hook_type: [反常识, 有代价]
  core_message: 一个32位的计数器，决定了你手机里的时间会不会倒着走
  spectacle: 计数器溢出瞬间，年份数字从2038疯狂翻回1901年，颜色由白变红
  audience: 对科技原理感兴趣的普通观众

scenes:
  - id: hook
    start: 0
    end: 4
    role: 钩子
    narration: 2038年，你的时间会倒着走。
    elements:
      - type: icon
        name: 数字时钟
        at: [0, 4]
        position: 屏幕中央偏上
        color: "#ffffff"
        size: 400x160
        motion: 从0秒开始剧烈抖动，边缘出现毛刺
        detail: 圆角矩形边框，内部数字"2038.1.19"以等宽字体显示，2秒后数字开始先向下跳动一格再恢复
      - type: icon
        name: 警告三角
        at: [0.5, 4]
        position: 屏幕右上角
        color: "#ef4444"
        size: 80x70
        motion: 脉冲闪烁，间隔0.5秒，透明度在1.0到0.3之间跳动
        detail: 等边三角形边框，内部加一个叹号竖线和一个点，填充半透明红色
      - type: title
        text: 你的时间，会倒着走
        at: [1, 4]
        position: 屏幕下方1/3处
        color: "#22d3ee"
        size: 68
        motion: 从右侧快速滑入，到位后轻微回弹一下
```

奇观场景（节选）：

```yaml
  - id: spectacle
    start: 22
    end: 34
    role: 奇观
    narration: 时间开始倒着走。日历从2038年，一路翻回1901年。
    elements:
      - type: icon
        name: 日历
        at: [22, 25]
        position: 屏幕左上角
        color: "#94a3b8"
        size: 140x120
        motion: 日历页码快速向下翻转，像翻书一样连续翻页
        detail: 矩形日历图标，上方两条斜杠表示翻页，页码数字模糊不清
      - type: counter
        at: [22, 32]
        position: 屏幕中央
        color: "#ffffff"
        size: 120
        motion: 从22秒开始快速递减滚动，数字从2038开始，经过1999、1987、1970等关键年份，到32秒到达1901
        detail: 巨大等宽数字，滚动速度先快后慢，1901处有重停和弹跳效果
        spectacle: true
      - type: subtitle
        text: 年份
        at: [22, 32]
        position: 屏幕中央数字下方
        color: "#64748b"
        size: 28
        motion: 跟随数字出现
      - type: particles
        at: [27, 34]
        position: 年份数字周围
        color: "#ef4444"
        size: 200x200
        motion: 从27秒开始，红色粒子从数字边缘向外喷溅、飘散
        detail: 粒子为小圆点，数量约40个，向四周飞出并逐渐消失
      - type: transition
        at: [30, 32]
        motion: 数字颜色从白色渐变为红色，背景边缘出现红色脉冲光晕
        detail: 整体色调向红色偏移，模拟溢出危机感
        spectacle: true
```

完整文件：`output/script-2038.yaml`（45 秒，5 个场景）。

---

### 3.3 拆书提示词：`prompts/node1-points.md`

**角色与任务（节选）**

> 你是一个「拆书编辑」，把一本书、一篇文章或一份资料，拆成可以独立做成短视频的知识点。
>
> 阅读用户提供的文本，输出 5–10 个知识点。

**核心约束**

- 优先保留满足任意一条的知识点：反常识 / 有代价 / 有痛点 / 有反转。
- 舍弃：纯定义、纯清单、必须依赖大量前置知识才能讲清楚的内容。
- 每个知识点严格使用以下格式：

```
## 序号. 知识点标题
- 核心洞察：一句话说清这个知识点真正反直觉的地方
- 选题类型：反常识 / 有代价 / 有痛点 / 有反转（可多选）
- 一句话核心：观众看完会记住的那句话
- 奇观画面：一个能用几何图形画出来的、截图级的画面
- 原文依据：从材料中摘录的关键事实、数字或原句（不要改写事实）
```

- 只使用材料里的事实，禁止编造数字、人物、年代和引文。
- 材料不足以支撑某个知识点时，不列。
- 每个知识点必须能脱离全书独立成立。
- 知识点之间不重复。
- 只输出知识点列表，不要前言、总结、推荐语。

**实际调用**

```bash
node node1.js --extract 测试1.txt --out output/points-example.md
```

输入：`测试1.txt`（二进制科普视频脚本，4858 字节）。
模型：`deepseek-v4-pro`。
实测：耗时 56.5s，prompt 1852 tokens，completion 5328 tokens，共 8 个知识点。

**AI 实际产出**（`output/points-example.md`，节选）

```
## 1. 计算机为什么只用 0 和 1？
- 核心洞察：计算机底层不是“选择”了 0 和 1，而是物理上只有开和关两种状态，第三种状态不存在。
- 选题类型：反常识 / 有痛点
- 一句话核心：计算机只认识开和关，不认识 3。
- 奇观画面：画面中央一排三个圆形开关，只有两个可用：一个亮青色、一个暗黑色，第三个位置直接消失。
- 原文依据：“计算机只有两个状态：开和关，也就是 0 和 1。”

## 2. 十进制来自十根手指
- 核心洞察：十进制不是数学的必然，而是人类身体结构决定的使用习惯。
- 选题类型：反常识
- 一句话核心：你用十进制，是因为你有十根手指。
- 奇观画面：左侧一双手的线条轮廓，旁边标“10 个手指”；右侧一个圆形开关图标，旁边标“2 个状态：开 / 关”。
- 原文依据：“我们习惯用十进制，因为有十个手指。”

## 3. 二进制里没有 2
- 核心洞察：逢二进一意味着单个二进制位上永远不会出现数字 2，到 2 就进位。
- 选题类型：反常识 / 有反转
- 一句话核心：二进制里没有 2，到 2 就变成 10。
- 奇观画面：两个圆点并排亮起，第三个圆点从灰色变亮，下方出现“10”。
- 原文依据：“二进制：逢二进一”。

## 5. 8 个灯泡只能数到 255
- 核心洞察：8 位二进制能表示 256 种状态，但最大值是 255，因为从 0 开始数。
- 选题类型：反常识
- 一句话核心：8 个开关有 256 种状态，最大却只到 255。
- 奇观画面：一排 8 个圆形灯泡全部亮黄，下方计数器停在“255”，旁边灰色小字“0–255”。
- 原文依据：“八个灯泡可以表示 0 到 255。”
```

完整文件共 8 个知识点：`output/points-example.md`。

---

### 3.4 知识点 → 脚本提示词：`prompts/node1-point-script.md`

这个文件不是独立系统提示词，而是追加在 `node1-script.md` 之后的补充约束。

**实现方式**

```js
// node1.js --book
systemPrompt = readPrompt('node1-script.md') + '\n\n' + readPrompt('node1-point-script.md');
userPrompt =
  `知识点：\n\n<point>\n## ${point.body}\n</point>\n\n` +
  `时长：${duration} 秒\n分辨率：1920x1080，帧率：30fps\n\n` +
  `把这个知识点写成一条完整的视频脚本，只输出 YAML。`;
```

**核心约束**

1. 视频只讲这一个知识点，不要扩展成整本书的综述。
2. 以「核心洞察」作为反转点，以「奇观画面」作为截屏级画面。
3. 「原文依据」里的事实、数字、年代可以写进画面和旁白；除此之外不许编造事实。
4. 依然走完「钩子 → 共情 → 拆解 → 顿悟 → 金句」五步情绪曲线。
5. 依然要写 `meta.golden_line`、`meta.visual_motif`，每个场景要有 `emotion` / `highlight`，
   元素要写缓动。
6. 依然只输出 YAML，结构与前面定义的完全一致。

**实际调用**

```bash
node node1.js --book output/points-example.md --index 1 --duration 30 --out output/script-point-example.yaml
```

使用第 1 个知识点「计算机为什么只用 0 和 1？」。
模型：`deepseek-v4-pro`。
实测：耗时 79.8s，prompt 2045 tokens，completion 8677 tokens。

**AI 实际产出**（`output/script-point-example.yaml`，节选）

```yaml
meta:
  title: 计算机为什么只用0和1？
  duration: 30
  fps: 30
  resolution: 1920x1080
  primary: "#22d3ee"
  background: "#06080f"
  hook_type: [反常识, 有痛点]
  core_message: 计算机只认识开和关，不认识3。
  spectacle: 画面中央一排三个圆形开关，只有两个可用：一个亮青色、一个暗黑色，第三个位置直接消失。
  audience: 对计算机原理好奇的普通人

scenes:
  - id: hook
    start: 0
    end: 4
    role: 钩子
    narration: 你电脑里没有3。
    elements:
      - type: switch
        name: 圆形开关
        at: [0, 4]
        position: 画面中央偏左
        color: "#22d3ee"
        size: 160
        motion: 从暗变亮，持续脉冲发光
      - type: title
        text: 为什么电脑只认0和1？
        at: [0.5, 4]
        position: 画面右侧，垂直居中
        color: "#ffffff"
        size: 60
        motion: 从下方滑入并轻微回弹

  - id: conflict
    start: 4
    end: 9
    role: 冲突
    narration: 你以为有3，其实没有。
    elements:
      - type: switch
        name: 圆形开关
        at: [4, 9]
        position: 画面左侧
        color: "#22d3ee"
        size: 120
        motion: 保持亮起
      - type: switch
        name: 圆形开关
        at: [4, 9]
        position: 画面中间
        color: "#06080f"
        size: 120
        motion: 保持暗色，轮廓微光
      - type: switch
        name: 圆形开关
        at: [4, 9]
        position: 画面右侧
        color: "#888888"
        size: 120
        motion: 闪烁，透明度在0.1到0.9之间快速变化
```

奇观与结尾（节选）：

```yaml
  - id: spectacle
    start: 21
    end: 26
    role: 反转
    narration: 计算机只认识0和1，不认识3。
    elements:
      - type: switch
        name: 圆形开关
        at: [21, 26]
        position: 画面左侧
        color: "#22d3ee"
        size: 120
        motion: 保持亮起
      - type: switch
        name: 圆形开关
        at: [21, 26]
        position: 画面中间
        color: "#06080f"
        size: 120
        motion: 保持暗色
      - type: line
        shape: circle
        dash: [12, 12]
        at: [21, 26]
        position: 画面右侧（第三个开关原位置）
        color: "#ffffff"
        size: 120
        motion: 逐渐缩小并淡出消失
        spectacle: true

  - id: home
    start: 26
    end: 30
    role: 落回人
    narration: 你按下的开关，就是源头。
    elements:
      - type: switch
        name: 圆形开关
        at: [26, 30]
        position: 画面中央
        color: "#22d3ee"
        size: 200
        motion: 从暗到亮，模拟手指按下，然后淡出到黑
      - type: title
        text: 你按开关
        at: [28, 30]
        position: 画面下方
        color: "#ffffff"
        size: 48
        motion: 淡出到黑
```

完整文件：`output/script-point-example.yaml`（30 秒，6 个场景）。

---

### 3.5 渲染器提示词：`prompts/node2-prompt.md`

**角色与任务（节选）**

> 你是一个「编程视频渲染引擎」。你精通 HTML5 Canvas、CSS、JavaScript、时间轴动画和逐帧渲染。你的唯一任务：根据用户提供的视频脚本，生成一个完整的、自包含的 HTML 文件。

**核心约束**

- 视频 = 连续帧 + 帧率 + 时长；按帧号计算画面。
- 必须实现纯函数 `renderFrame(frameIndex)`：相同帧号必须得到完全相同的画面。
- 禁止用 `Date.now()`、`performance.now()` 影响画面；随机数必须固定种子（如 `mulberry32`）。
- 输出单个 HTML，内联 CSS/JS；固定 1920×1080、30fps。
- 必须暴露：

```js
window.FPS = 30;
window.DURATION = 总时长;
window.TOTAL_FRAMES = FPS * DURATION;
window.renderFrame = function (frameIndex) { ... };
```

- 两种模式：
  - 预览：URL 不带参数时自动循环播放。
  - 截图：URL 带 `?frame=N` 时只渲染第 N 帧，渲染完成后设置 `window.__RENDER_DONE__ = true`，不再循环。
- **旁白与字幕**：`narration` 是配音台词，绝对禁止画进画面；画面上只允许出现 `elements` 里明确写出的文字。判断标准：
  > 你画的字应该在脚本的 `elements` 里找得到，而不是在 `narration` 里找得到。
- **世界坐标**：原点 `(0,0)` 是画面正中央；绘制函数里再写 `W/2` 或 `H/2` 会导致整体偏移。背景应写 `fillRect(-W/2, -H/2, W, H)`。
- **镜头语言（必须有）**：虚拟摄影机；给出 FILL、PICTURE_FILL、MAX_ZOOM、LEAD、MIN_HOLD、BEAT_GAP、SETTLE、DRIFT、PUSH、PUSH_HOLD、PUSH_GAP 等常量；镜头缓动用 smootherstep；镜头必须夹紧；结尾先亮完主标题再压黑；入场路径不能撞版式。
- **视觉叙事**：抽象概念必须变成具体几何运动（时间→收缩进度条/翻页日历，行动→红点轨迹，
  拆解→树状分支逐层绽放，压力→收紧弧线/向内坍缩粒子）；数字不能直接跳终值；
  视觉母题必须实现成可复用函数 `drawMotif`，并用全局纯函数 `motifAt(t)` 提供
  跨场景连续的状态，至少贯穿 3 个场景并递进。
- **视觉聚焦（硬性）**：每个场景只有一个主焦点（脚本标 `focus: true` / `occupancy`），
  主焦点外接框的宽或高 ≥ 视口 **30%**（推荐 40–65%，奇观 ≥60%）；核心标题 ≥88px、
  核心数字 ≥120px；禁止主体缩在角落、大片死黑；主焦点外接框聚焦在画面中心 70% 区域。
- **缓动**：必须实现并使用 `easeInOutCubic` / `easeOutBack` / `easeOutCubic`；
  入场用 easeOutBack，位移转场用 easeInOutCubic，数据增长用 easeOutCubic；禁止 linear。
- **节奏密度（硬性）**：每 2–3 秒至少一次可感知变化（元素出现、位移、形变、变色、数字跳动、镜头推进）；
  任何画面静止不超过 4 秒；前 3 秒至少 2 次视觉事件；每幕至少叠背景层、母题层、数据/文字层三层，
  并实现 `drawBackground(ctx,t)` / `drawMotif(ctx,t)` 分别负责背景与母题；
  第 0 帧必须有可见主体（入场不从全透明 / 0 缩放起步）；长驻留元素必须分段推进或加确定性自主运动。
  尾迹、粒子、星点等每帧随机量必须用固定种子 PRNG，禁止 `Math.random()`。
- **金句卡片**：最后一幕金句独立成可截屏卡片，居中无遮挡、停留 ≥2 秒；次要文字退场或降透明度；
  母题收束成视觉句号；压黑只放最后 0.5–1 秒，且在金句完全亮起之后开始。
- **色彩情绪**：主色科技青 `#22d3ee`；警示红 `#ef4444` 只用于冲突/高潮峰值（红色面积 ≤20%），
  进入情绪峰值时必须有颜色过渡或确定性脉冲光晕。
- **转场**：除片尾压黑外，**禁止整屏淡入淡出、黑场、白闪和硬切**；场景边界必须由上一幕
  的终点几何（线端点、收缩圆点、进度条末端）放大/平移/形变成下一幕的起点；
  下一幕主角提前 0.3–0.5 秒出现，母题状态由 `motifAt(t)` 连续提供。
- **安全区**：1920×1080；左右 120px、上下 80px 安全边距；底部 160px 留给节点4 的字幕；
  文字不得被裁切或互相重叠；换行用 `measureText` 实测。
- 不依赖任何外部网络资源；不处理音频；只输出完整 HTML，不要 Markdown 围栏和解释。

**实际调用**

```bash
node node2.js --script output/script-2038.yaml --theme midnight --out index-2038.html
```

模型：`deepseek-v4-pro`，temperature 0.2，默认 max_tokens 65536。

**AI 实际产出**（`index-2038.html`，节选）

> 注：该文件生成后做过两处版式修正：字幕 y 从 80 改到 250；64 位计数器增加 `position: '三个图标下方'` 分支。以下是修正后的实际代码。

契约与主循环：

```js
  const W = 1920;
  const H = 1080;
  const FPS = 30;
  const DURATION = 45;
  const TOTAL_FRAMES = FPS * DURATION;

  window.FPS = FPS;
  window.DURATION = DURATION;
  window.TOTAL_FRAMES = TOTAL_FRAMES;

  // ...

  function renderFrame(frameIndex) {
    frameIndex = Math.max(0, Math.min(TOTAL_FRAMES - 1, Math.floor(frameIndex)));
    ctx.clearRect(0, 0, W, H);
    computeCamera(frameIndex);
    applyCamera(ctx);
    drawScene(ctx, frameIndex);
    removeCamera(ctx);
  }

  window.renderFrame = renderFrame;
```

摄影机：

```js
  function computeCamera(frameIndex) {
    const time = frameIndex / FPS;
    camera.x = 0;
    camera.y = 0;
    camera.z = 1;
    // 简单的镜头语言：整体跟随场景微调
    if (time >= 0 && time < 4) {
      camera.z = 1;
    } else if (time >= 4 && time < 10) {
      camera.z = 1;
      camera.x = 0;
    } else if (time >= 10 && time < 22) {
      camera.z = 1;
    } else if (time >= 22 && time < 34) {
      camera.z = 1;
    } else if (time >= 34 && time < 45) {
      camera.z = 1;
    }
    // 结尾拉远
    if (time > 42) {
      const zoomOut = remap(time, 42, 45, 1, 0.95);
      camera.z = zoomOut;
    }
  }
```

场景 3（揭示）的实际场景函数：

```js
  function drawScene3(ctx, time, frameIndex) {
    if (time < 10 || time > 22) return;
    const grid = {
      type: 'grid', at: [10, 18], color: '#64748b', size: '960x90'
    };
    const digitsUp = {
      type: 'digits', at: [10, 18], color: '#ffffff', size: 64,
      detail: '2147483647'
    };
    const textBelow1 = {
      type: 'text', at: [10, 12], color: '#94a3b8', size: 32,
      detail: '32位有符号整数，最高位是符号位'
    };
    const highlight = {
      type: 'highlight', at: [14, 18], color: '#f59e0b', size: '100x70'
    };
    const transitionFlip = {
      type: 'transition', at: [17, 18], detail: '全部32个方格同时翻转'
    };
    const digitsNeg = {
      type: 'digits', at: [18, 22], color: '#ef4444', size: 64,
      detail: '-2147483648'
    };
    const textBelow2 = {
      type: 'text', at: [18, 22], color: '#ef4444', size: 32,
      detail: '正数变负数，时间开始倒着走'
    };
    drawElement(ctx, grid, time, frameIndex);
    drawElement(ctx, digitsUp, time, frameIndex);
    drawElement(ctx, textBelow1, time, frameIndex);
    drawElement(ctx, highlight, time, frameIndex);
    drawElement(ctx, transitionFlip, time, frameIndex);
    drawElement(ctx, digitsNeg, time, frameIndex);
    drawElement(ctx, textBelow2, time, frameIndex);
  }
```

完整文件：`index-2038.html`（32,948 字节），对应样片 `output/2038.mp4`。

> 注：该样片渲染器生成于本次迭代前，未包含「视觉母题 / 缓动函数 / 警示红脉冲」的新约束。

---

## 4. 技术实现

### 4.0 从脚本到成片：端到端数据流

整条流水线只有一个时间基准：`script.yaml` 里每个场景的 `start` / `end`（秒）。
画面、配音、字幕都从它推导，彼此不重新计时。

```text
script.yaml
   │  节点2：DeepSeek + node2-prompt.md + 主题令牌
   ▼
renderer.html（默认 index.html）
   │  节点3：Playwright 打开 file:///…/renderer.html?frame=N
   │          renderFrame(N) → 等两次 requestAnimationFrame → screenshot
   ▼
frames/frame-00000.png … frame-01349.png
   │  ffmpeg -framerate 30 -i frame-%05d.png
   ▼
output/video_silent.mp4（H.264，无音轨）
   │  节点4：edge-tts 逐场景配音 + ASS 字幕 + ffmpeg 滤镜图
   ▼
output/final.mp4（H.264 + AAC，字幕已烧录）
   │  节点5：ffprobe / volumedetect / 像素级版式检测
   ▼
质检报告
```

| 阶段 | 输入 | 技术 | 输出 |
|---|---|---|---|
| 脚本 | 选题 / 资料 | DeepSeek 流式生成 + js-yaml | `script.yaml` |
| 渲染器 | 脚本 | DeepSeek + Canvas 2D 提示词 | 自包含 `renderer.html` |
| 画面 | HTML | Playwright + headless Chromium + ffmpeg/libx264 | `video_silent.mp4` |
| 声音 | 脚本 + 无声视频 | edge-tts + ffmpeg `filter_complex` | `voice.mp3` |
| 字幕 | edge-tts 句边界 + `highlight` | SRT/VTT/ASS + libass | 烧录字幕 + 台词稿 |
| 成片 | 无声视频 + 混音轨 + ASS | ffmpeg | `final.mp4` |
| 质检 | 成片 + 脚本 | ffprobe / volumedetect / raw RGB 分析 | 控制台报告 |

#### 4.0.1 技术栈

| 层 | 技术 | 在本项目中的用途 |
|---|---|---|
| 运行时 | Node.js ≥18（CommonJS，无构建步骤；本次实测 v24.13.1） | 串联节点、解析参数、解析 YAML、调用外部命令 |
| 大模型 | DeepSeek `deepseek-v4-pro`，SSE 流式 | 选题、脚本、知识点、HTML 渲染器 |
| 脚本格式 | YAML（`js-yaml ^4.1.0`） | 场景、旁白、元素、时间轴、高亮词的唯一数据源 |
| 画面 | HTML5 Canvas 2D + 虚拟摄影机 | 所有图形、文字、粒子、图表由代码绘制 |
| 浏览器自动化 | Playwright `^1.40.0` + Chromium headless | 逐帧调用 `renderFrame()` 并截图 |
| 视频编码 | ffmpeg / libx264 / yuv420p（本机为 gyan.dev build） | PNG 序列 → H.264，最终封装 MP4 |
| 字幕渲染 | ASS + ffmpeg `ass` 滤镜（需 libass） | 关键词高亮、缩放弹跳、烧录进画面 |
| 语音合成 | edge-tts（微软神经网络音色，Python 包） | 逐场景旁白 + `SentenceBoundary` 句级时间戳 |
| 音频处理 | ffmpeg `adelay` / `amix` / `apad` / `sidechaincompress` | 时间轴对齐、BGM 循环与人声闪避 |
| 质检 | ffprobe + ffmpeg rawvideo + Node Buffer | 流信息、时长、音量、黑帧、像素级边缘裁切 |
| 确定性 | 固定 fps + 纯函数渲染 + 种子随机 | 同一帧号永远得到同一画面，可重渲染任意帧 |

#### 4.0.2 时间模型：脚本秒 → 帧号 → 音频秒

- 帧率固定 30fps。`frameIndex = round(秒 × 30)`，`t = frameIndex / 30`。
- `TOTAL_FRAMES = DURATION × FPS`。45 秒 = 1350 帧（0…1349）。
- 渲染器里所有动画只用 `t` / `frameIndex` 计算，不读系统时钟。
- 节点3 按顺序渲染 0…1349 帧；ffmpeg 以 30fps 读 PNG 序列，所以视频时长 = 帧数 / 30 = 45.00s。
- 节点4 不改画面节奏，只把每段配音延迟到 `scene.start`；字幕时间 = edge-tts 句边界 + `scene.start`。

以 `output/parkinson.yaml` 为例：

| 场景 | 脚本窗口 | 配音实际 | 对应帧 |
|---|---|---|---|
| hook | 0–5s | 0.0→3.0s | 0–149 |
| empathy | 5–15s | 5.0→12.1s | 150–449 |
| breakdown | 15–30s | 15.0→25.8s | 450–899 |
| epiphany | 30–40s | 30.0→37.8s | 900–1199 |
| golden | 40–45s | 40.0→42.9s | 1200–1349 |

#### 4.0.3 确定性：为什么可以逐帧渲染

- `renderFrame(frameIndex)` 是纯函数：同一帧号 → 同一画面。禁止 `Date.now()`、`performance.now()`；
  随机必须用固定种子的 `mulberry32`。
- 所有缓动是确定性函数：入场 `easeOutBack`、位移/转场 `easeInOutCubic`、
  数据增长 `easeOutCubic`、镜头 `smootherstep`；禁止 linear。
- 节点3 不录屏，而是「渲染一帧 → 等两次 rAF → 截一张 PNG」。没有实时播放的丢帧问题，
  某一帧异常可以单独重渲染定位。
- 因为是纯函数，视频可以按 30fps 精确重建；音频和字幕只要对齐到场景起点就能严丝合缝。

#### 4.0.4 一个场景的完整落地示例

以 `output/parkinson.yaml` 的 hook 场景为例：

```yaml
- id: hook
  start: 0
  end: 5
  role: 钩子
  emotion: 焦虑
  narration: 你有一整天，干活的有几分钟？
  highlight: [一整天, 几分钟]
  elements:
    - type: title
      text: 你的一整天，去哪了？
      at: [0, 4]
      easing: easeOutBack
      pulse: true
    - type: progress
      at: [1, 5]
      value: [1.0, 0.12]
      easing: easeInOutCubic
```

它会在流水线里变成：

| 环节 | 实际发生的事 |
|---|---|
| 节点2 | 把 `title` 画成居中大标题，`easeOutBack` 入场并做确定性脉冲；`progress` 画成一条从 100% 收缩到 12% 的进度条，收缩用 `easeInOutCubic` |
| 节点3 | 第 0–149 帧逐帧截图；`renderFrame(30)` 对应 1.0s，进度条刚开始收缩 |
| 节点4 配音 | edge-tts 从 0.0s 开始播“你有一整天，干活的有几分钟？”，实际 3.0s 结束 |
| 节点4 字幕 | 第 1 条 cue 0.10–3.05s；`一整天`、`几分钟` 按字符位置先后变黄并弹跳 |
| 节点5 | 检查这 5 秒的旁白没有越过 5s 场景边界，画面没有非预期裁切 |

同一份 `start/end` 同时驱动了画面窗口、配音延迟和字幕时间，所以三者不会漂移。

### 4.1 DeepSeek 客户端：`lib/deepseek.js`

节点1、节点2 共用同一个流式客户端，请求形态是标准的 chat completions（下例为节点2）：

```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    { "role": "system", "content": "…" },
    { "role": "user", "content": "…" }
  ],
  "max_tokens": 65536,
  "temperature": 0.2,
  "stream": true,
  "stream_options": { "include_usage": true }
}
```

- 默认地址：`https://api.deepseek.com`；默认模型：`deepseek-v4-pro`；可选 `deepseek-flash`。
- 用 Node 内置 `fetch` 读取 `ReadableStream`，按行解析 SSE 的 `data:` 帧，收到 `[DONE]` 结束。
- 先收 `delta.reasoning_content`（推理），再收 `delta.content`（正文）；
  每 500ms 刷新一次进度（推理字符数、正文字符数）。
- `AbortController` + 停滞计时器：超过 `DEEPSEEK_STALL_TIMEOUT`（默认 240s）没有新 chunk 就中断，
  用来区分「模型还在想」和「连接已经死了」。
- 统一错误提示：401（Key 无效）、402（余额）、404（模型名）、400（参数/上下文）。
- `resolveOptions()` 读取 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`DEEPSEEK_MAX_TOKENS`、`DEEPSEEK_STALL_TIMEOUT`。
- 节点1 默认 `max_tokens=16384`；节点2 默认 `max_tokens=65536`（HTML 较长，截断会直接导致渲染失败）。

### 4.2 节点1：`node1.js`

四种模式：

| 参数 | 系统提示词 | 用户提示词 | 默认输出 |
|---|---|---|---|
| `--topics` | `node1-topics.md` | `领域 / 方向：...` + 输出 10 个选题 | `output/topics.md` |
| `--topic` | `node1-script.md` | 选题 + 时长 + 分辨率/帧率 | `script.yaml` |
| `--extract` | `node1-points.md` | `<material>...</material>` | `output/points.md` |
| `--book` | `node1-script.md` + `node1-point-script.md` | `<point>...</point>` + 时长 + 分辨率/帧率 | `script.yaml` |

实现细节：

- 资料长度上限 `MAX_MATERIAL_CHARS = 100000`，超出只取前 10 万字并告警。
- 知识点文件按行首 `## ` 切分；`--index` 从 1 开始，越界会被夹到有效范围。
- 脚本模式下先 `yaml.load()` 校验；解析失败或缺 `scenes` 时，把原始输出另存为 `*.bad.yaml`，不进入节点2。
- 模型声明的 `meta.duration` 与请求时长不一致时只告警，不中止。
- 内容自检 `validateScriptContent()`（只告警，不阻断生成）：
  - `meta.golden_line` 存在且 ≤20 字；
  - `meta.visual_motif` 存在；
  - `meta.hook_type` 命中「极端假设 / 扎心拷问 / 预期反转」；
  - 开场旁白不以「大家好 / 今天 / 本期 / 入门 / 简介 / 让我们 / 有没有想过」开头；
  - 开场第一句 ≤18 字（标点不计）；第一个场景 `role: 钩子` 且不超过全片 12%（45 秒约 5.4 秒）；
  - 至少有一个场景 `role: 金句`；`钩子/共情/拆解/顿悟/金句` 五幕齐全；
  - 全片旁白密度在 **3.2–3.5 字/秒**（±0.05 估算容差；低于 3.2 会变成中段大段空白，高于 3.5 观众来不及消化）；
  - 每个场景的预计配音时长 ≥ 场景时长 60%（否则告警“画面后半段会空”）；
  - 场景 `start` / `end` 首尾相接，总时长与 `meta.duration` 误差 ≤0.5s；
  - 每个场景都有 `highlight`（1–3 个），且高亮词必须原样出现在该场景 `narration` 里；
  - 每个场景至少有一个元素，元素时间窗覆盖无 >3 秒空窗；
  - 带 `motion` 的元素必须写 `easing`，且不得是 `linear`；
  - `meta.spectacle` 存在，并至少有一个元素标 `spectacle: true`；
  - 旁白单句 ≤24 字、不以连接词开头、不含「我们可以看到 / 不难发现 / 众所周知」；
    结尾不落在大词（世界 / 一切 / 力量 / 未来 / 全人类 / 宇宙）上。
- 选题模式下另有 `validateTopicsContent()`：
  - 正好 10 行、每行 7 个字段；
  - 至少 7 个选题关乎日常生活/拖延/认知/效率/时间；
  - 钩子类型合法，且至少 3 个「极端假设」；
  - 钩子 ≤18 字（标点不计，按可发音字符数）。
- 这些检查对应提示词里的硬性要求。提示词是建议，代码是最后一道约束。
- 节点1 现在导出 `validateScriptContent` / `validateTopicsContent` / `findVisualGaps`，
  节点2 导出 `auditHtml` / `auditVisualLanguage` / `auditNarrationLeak`，
  可直接 `require()` 做回归测试，不触发 API 调用。

### 4.3 节点2：`node2.js`

- 系统提示词：`prompts/node2-prompt.md` + 主题令牌（`lib/theme.js` 的 `themeBlock(name)`）。
- 用户提示词：

````
下面是一份视频脚本，请严格按系统提示词的要求，输出完整的 HTML 渲染器。

```yaml
（完整的 script.yaml）
```
````

- 参数：temperature 0.2，默认 max_tokens 65536；主题默认 `midnight`。
- 去掉模型可能添加的 Markdown 代码围栏后写入 HTML。
- 静态自检 `auditHtml()`：
  - HTML 以 `</html>` 结束；
  - 暴露 `window.renderFrame`；
  - 支持 `__RENDER_DONE__`；
  - 暴露 `window.TOTAL_FRAMES`；
  - 无外部网络依赖（`<script src="http...">`、`<link href="http...">`、`@import url(http...)`、CSS `url(http...)`）。
- 旁白泄漏检查 `auditNarrationLeak()`：
  - 每段 `narration` 先按 `。！？；` 拆句，再逐句去掉标点取前 10 个字作为探针
    （只探开头会漏掉“后一句被画进画面”，例如金句页的 CTA 小字）；
  - 在去掉标点的 HTML 中查找；
  - 命中后还要排除脚本 `elements[].text` 里本来就存在的文案——
    最后一幕的金句卡片常常同时是旁白和画面标题，这不算泄漏；
  - 仍命中则告警并列出场景 id。
- 视觉语言自检 `auditVisualLanguage()`：
  - 至少定义两种平滑缓动函数（`easeInOutCubic` / `easeOutCubic` / `easeOutBack` / `smootherstep`）；
  - 缓动函数**被实际引用**（去掉注释后函数名至少出现两次：定义 + 至少一次引用），至少两种；
    作为参数传入 `easeProgress(t, a, b, easeOutBack)` 也算引用，不只匹配 `name(`；
  - `drawMotif` 至少 3 处场景调用（扣掉函数声明本身），确保母题真的贯穿；
  - `drawBackground` 与 `drawMotif` 均已实现，保证背景层/母题层/数据文字层三层结构；
  - 存在全局纯函数 `motifAt(t)`，母题状态由全片绝对时间决定，跨场景连续；
  - 绘制代码消费了 `focus` / `occupancy` / `FOCUS_MIN` 之类的占屏约束；
  - 出现粒子/尾迹/代码雨时，存在 `mulberry32` 等固定种子 PRNG；
  - 使用 Canvas 路径/数据绘制 API（`arc` / `lineTo` / `bezierCurveTo` / `quadraticCurveTo`）；
  - 不出现线性缓动（排除 `createLinearGradient` 的误报）；
  - 不出现未播种的 `Math.random()`；`Date.now()` / `performance.now()` 只允许出现在预览循环，
    用于逐帧画面的会告警。
- 提示词新增「节奏密度」硬性段：每 2–3 秒一次可感知变化、静止不超过 4 秒、
  前 3 秒至少 2 次视觉事件；长驻留元素必须分段推进或加确定性自主运动。
  另新增「金句卡片」段：最后一幕金句独立成可截屏卡片，停留 ≥2 秒，母题收束。
- 回归生成后补上的三条约束：
  - 每个场景至少叠背景层 / 母题层 / 数据文字层三层，禁止整段只有一根进度条加一个红点；
  - 第 0 帧必须有可见主体，入场动画从 ≥40% 透明度、0.85 倍缩放起步；
  - 尾迹抖动、粒子散点等每帧随机量必须走固定种子 PRNG，禁止 `Math.random()`。
- HTML 不完整（未以 `</html>` 结束）时硬失败，另存 `*.partial.html`；
  其余自检项只告警，由人工决定是否重生成。
- `attention_v1` 的回归说明：提示词约束 + 静态审计能提前拦住字幕泄漏和未播种随机，
  但“长静止”仍可能执行不到位；该片的两处长静止是在 HTML 里手工补环境重启环、
  扫描光束和波形扫描头解决的（见 5.3）。这类修正应回写到渲染器提示词，而不是只改样片。

### 4.4 渲染器契约

节点2 生成、节点3 消费的接口：

```js
window.FPS = 30;
window.DURATION = 45;
window.TOTAL_FRAMES = 1350;
window.renderFrame = function (frameIndex) { /* 纯函数，同帧号同画面 */ };
```

脚本字段到渲染器的映射：

| 脚本字段 | 渲染器里的实现 |
|---|---|
| `meta.duration` / `meta.fps` | `window.DURATION` / `window.FPS` / `window.TOTAL_FRAMES` |
| `scene.start` / `scene.end` | 该场景元素的显示窗口，由 `t = frameIndex / FPS` 判断 |
| `meta.visual_motif` | 复用 `drawMotif(ctx, t, state)`，状态由 `motifAt(t)` 提供，至少贯穿 3 个场景并形态递进 |
| `meta.bgm_style` | 节点4 据此在 `audio/bgm/` 自动选曲，渲染器不读取 |
| `element.focus` / `element.occupancy` | 主焦点外接框宽或高 ≥30% 视口，推荐 40–65% |
| `scene.emotion` / `scene.role` | 决定配色、节奏，以及是否进入红色高潮/脉冲 |
| `element.easing` | 元素入场、位移、数据增长的缓动函数 |
| `element.pulse` | 确定性光晕脉冲，如 `Math.sin(t * 6)` |
| `element.accent_color` | 情绪峰值强调色，通常是警示红 `#ef4444` |
| `meta.golden_line` | 最后一幕的 `title` 元素，至少停留 2 秒 |
| `scene.narration` | 只用于理解语义与节奏，**不绘制** |
| `scene.highlight` | 仅供节点4 做字幕高亮，**不绘制** |

截图模式：

```js
const params = new URLSearchParams(window.location.search);
if (params.has('frame')) {
  renderFrame(parseInt(params.get('frame'), 10));
  window.__RENDER_DONE__ = true;
}
```

世界坐标与摄影机：

```js
ctx.save();
ctx.translate(W / 2, H / 2);
ctx.scale(camera.z, camera.z);
ctx.translate(-camera.x, -camera.y);
// 之后所有绘制都用世界坐标，原点在画面中心
```

`prompts/node2-prompt.md` 中给出的等价写法是：

```js
ctx.translate(W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z);
ctx.scale(cam.z, cam.z);
```

### 4.5 节点3：`render.js`

1. 启动 Chromium（headless、`--no-sandbox`），viewport 1920×1080，`deviceScaleFactor=1`。
2. 加载 HTML 的 `?frame=0`，等待 `window.__RENDER_DONE__ === true`。
3. **预检**：以每秒 4 帧的密度遍历整条时间轴，只调用 `renderFrame(frame)`，不截图；发现运行时错误就记录，最多记录 5 处后停止扫描并以失败退出。用于提前发现只在某段时间触发的 `ReferenceError`。
4. **逐帧截图**：
   - 对每一帧调用 `window.renderFrame(i)`；
   - 等待两次 `requestAnimationFrame`，避免截到上一帧；
   - `page.screenshot({ path: frames/frame-00000.png, type: 'png' })`。
5. ffmpeg 合成无声视频：

```bash
ffmpeg -y -framerate 30 -i "frames/frame-%05d.png" \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium \
  "output/video_silent.mp4"
```

6. `--clean` 在合成后删除 `frames/`。

几个关键取舍：

- **串行截图，不并发**：每帧都等 `renderFrame` + 两次 `requestAnimationFrame` 后再截图，
  避免多个页面状态互相覆盖。45 秒共 1350 帧，耗时取决于机器性能与画面复杂度。
- **不是屏幕录制**：不依赖实时播放和丢帧补偿。每帧都是独立 PNG，某一帧出错可以单独重渲染定位。
- **预检密度**：每秒采样 4 帧（45 秒约 180 个点），只调用 `renderFrame` 不截图；
  发现运行时错误立即停止，避免渲染半小时后才在结尾崩。
- **磁盘占用**：1920×1080 PNG 约 1–3MB/帧，45 秒可能产生数 GB，
  所以渲染前会估算体积并提示 `--clean`。

### 4.6 节点4：`audio.js`

节点4 做四件事：逐场景配音、对齐时间轴、生成并烧录字幕、混音封装。

#### 1）逐场景配音

- 遍历有 `narration` 的场景，每段旁白先做**标点规范化**：统一全/半角标点、
  合并重复标点、换行转停顿、给超长分句补呼吸逗号；只改标点不改字，
  `highlight` 词仍原样保留。想保留原文可加 `--no-text-normalize`。
- 规范化后的文本写入 `audio/.txt/voice_XX.txt`（UTF-8），再用 edge-tts 读文件，
  绕开 Windows 命令行代码页损坏中文的问题。
- 默认语速 `+5%`（`--rate` 可覆盖）：减少 edge-tts 中段的机械拖音，语流更接近口播。
- 一次调用同时产出音频和句级时间轴：

```bash
edge-tts -f audio/.txt/voice_00.txt \
  --voice zh-CN-XiaoxiaoNeural --rate +5% \
  --write-media audio/voice_00.mp3 \
  --write-subtitles audio/.txt/voice_00.srt
```

- 字幕时间戳来自 edge-tts 的 `SentenceBoundary`：**逐句，不是逐字**。
  中文能拿到每句的起点与时长；逐字对齐需要 Whisper 等额外模型，本项目不引入。
- 字幕文本就是规范化后的文本，因此标点停顿与字幕断句一致。
- 每段配音的起点 = 该场景的 `start`；节点4 不改视频，只把音频延迟到对应时刻。

时间对齐公式：

```text
配音起点 = scene.start
配音终点 = scene.start + ffprobe(voice_XX.mp3).duration
字幕绝对时间 = edge-tts 句边界 + scene.start
```

- 溢出检查：配音终点 > 场景结束 + 0.3s 告警；> 视频总长 + 0.3s 也告警。
  这通常意味着旁白太长或场景太短，会串场到下一幕。

#### 2）字幕：SRT / VTT / ASS

- 解析每段 edge-tts 的 SRT，把 `start` / `end` 平移到绝对时间轴后合并、排序；
  相邻字幕若重叠，把前一条的结束时间收紧到下一条开始前 0.02s，避免播放器闪烁。
- 先写完整台词稿：与成片同名的 `.srt` / `.vtt`（`parkinson.mp4` → `parkinson.srt` / `.vtt`）。
- 再生成 `.ass` 用于烧录：
  - 画布 1920×1080，微软雅黑 62px，底部居中 `MarginV=96`；
  - 每行最多 18 字，按标点优先断行，用 `\N` 显式换行；
  - 整句入场：120ms 淡入 + 92% → 102% → 100% 的轻微回弹；
  - 关键词：普通场景荧光黄 `#fcd34d`，顿悟/反转/奇观/金句场景改用警示红 `#ef4444`；
  - 「字随音动」：关键词出现时刻按**标点加权后的字符位置**估算
    （逗号≈1.8 字、句号/问号≈2.6 字、空格≈0.6 字），到时 140ms 放大到 114%，再 140ms 回落；
    比纯字数比例更贴近真实语流，仍是逐句时间轴上的确定性近似；
  - ASS 颜色是 BGR 顺序，`#fcd34d` 会写成 `&H4DD3FC&`；
  - 关键词结束后显式恢复白色与 100% 缩放，避免状态泄漏到后文。
- **同文去重**：若某场景画面里已有与字幕完全相同的大标题（常见于结尾金句），
  该条字幕跳过烧录，避免一句话在中心和底部各出现一次；`.srt` / `.vtt` 台词稿仍完整保留。
- 烧录用 ffmpeg 的 `ass` 滤镜（libass）。没有 libass 时自动退回 sidecar；
  `--subs sidecar` 只外挂 srt/vtt，`--no-subs` 两者都不做。
- Windows 下 `ass=` 的路径要转义：优先用相对路径绕开盘符，
  正斜杠、单引号包裹，转义 `' : , [ ]`。

#### 3）音轨拼接与 BGM

先把各段配音按起点延迟，再混成一条人声轨：

```text
[0:a]adelay=0:all=1[a0]
[1:a]adelay=5000:all=1[a1]
...
[a0][a1]...amix=inputs=N:duration=longest:normalize=0[voicemix]
[voicemix]apad[voice]
```

- `adelay` 用 `all=1`，兼容 edge-tts 输出的单声道；
- `amix` 必须 `normalize=0`，否则 N 段旁白会被各自除以 N，人声整体变小；
- `apad` 把人声补到无限长，最后用 `-t <视频时长>` 精确截断。

BGM 选曲按三级优先级执行：

1. **`--bgm <文件>`**：用户显式指定，最高优先级。
2. **Jamendo**（`lib/jamendo.js`）：配置了 `JAMENDO_CLIENT_ID`、脚本有 `meta.bgm`、
   且未加 `--no-jamendo` 时，按模型给的检索词搜索授权曲库；过滤 NC、优先器乐和可下载，
   下载到 `audio/bgm/jamendo-<id>.mp3`，按参考片段起点 `-ss` 切入。完整流程见 0.6。
3. **本地兜底**（`lib/bgm.js`）：按 `meta.bgm_style`（默认 `ambient_tech_tension`）
   依次查找 `audio/bgm/<style>.<ext>` → `audio/bgm-<style>.<ext>` →
   文件名关键词匹配 → `audio/bgm.mp3` → `audio/bgm/` 里唯一音频。
   找不到时告警并只用配音。

无论走哪一级，混音前都会统一为 48kHz 立体声；Jamendo/本地 BGM 都走同一套
循环、首尾淡入淡出、侧链闪避参数。混音清单会记录 `source`、`track`、`license`、
`attribution`、`startOffset` 和模型的 `reference`，供节点5 检查与发布署名。

有 BGM 时：

```text
[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,
     volume=1.0,asplit=2[voice][sc]
[2:a]atrim=0:<视频时长>,asetpts=PTS-STARTPTS,
     afade=t=in:st=0:d=0.8,afade=t=out:st=<时长-1.2>:d=1.2,
     volume=0.25,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[bgm]
[bgm][sc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[bgmduck]
[voice][bgmduck]amix=inputs=2:duration=longest:normalize=0[a]
```

- BGM 用 `-stream_loop -1` 循环，避免音乐比视频短时后半段静音；
- `atrim` 到视频长度后再做首尾 `afade`，循环接缝和结尾不会硬断；
- 人声先 `asplit=2`：一路留作主轨，一路当侧链触发信号。`sidechaincompress`
  会消耗掉第二路输入，不拆分会报 `Stream specifier 'voice' ... matches no streams`；
- 两路先统一为 48kHz 立体声，避免 TTS（24kHz 单声道）与 BGM（44.1/48kHz 立体声）
  在部分 ffmpeg 版本上格式协商失败；
- `--no-duck` 改为等音量直接 `amix`。

#### 4）视频与音频合成

```text
[0:v]ass='output/parkinson.ass'[v]     # 仅烧字幕时
[1:a]volume=1.0[voice]
... 上面的 BGM 链路 ...
```

- 烧字幕必须重新编码：`-c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium`；
  不烧字幕时 `-c:v copy`，不损失画质；
- 音频 `-c:a aac -b:a 192k`；
- 用 `-t <视频时长>` 显式截断，**不用 `-shortest`**：
  `-shortest` 会在音轨比视频短时把视频一起截断（实测 10s 视频 + 3s 音频只出 3s）；
- `-movflags +faststart` 把 moov atom 移到文件头，便于网页快速起播。
- 同时写与成片同名的 `<name>.audio.json` 混音清单：BGM 文件/风格/来源/闪避开关、
  语速、文本规范化开关、每幕配音时长与规范化后的台词。节点5 直接消费它，
  不再靠“猜 BGM 有没有挂上”。

### 4.7 节点5：`qa.js`

| 检查项 | 实现 | 判定 |
|---|---|---|
| 视频流 | ffprobe | 必须有视频流；编码不是 H.264 时告警 |
| 音频流 | ffprobe | 必须有音频流；编码不是 AAC 时告警 |
| 帧率 | `r_frame_rate` | 与 30fps 相差 < 0.1 通过，否则告警 |
| 时长 | ffprobe + `meta.duration` | 容差 0.5s；超出硬失败 |
| 体积 | 文件大小 | < 100KB 硬失败 |
| 音量 | `volumedetect` | `max_volume < -60dB` 硬失败；< -20dB 告警 |
| 黑帧 | `blackdetect=d=0.5:pix_th=0.10` | 可选，列出黑帧区间 |
| 混音清单 | 同名 `.audio.json`（如 `成片标题.audio.json`） | 有 BGM 时检查风格/闪避开关；无 BGM 告警；节点4 记录溢出时告警 |
| BGM 来源与授权 | `.audio.json` 的 `bgm.source/track/license/attribution/startOffset/reference` | Jamendo 曲目打印曲名、艺术家、许可证与署名串；NC 许可证硬告警；ND 或非器乐告警；同时回显模型推荐的参考歌曲与片段 |
| 旁白时间窗 | 优先读 `.audio.json`，否则读 `audio/voice_XX.mp3` | 超出场景结束 + 0.3s 告警 |
| 旁白覆盖率 | 配音时长 / 场景时长 | 低于 75% 告警（场景后半段容易空） |
| 边缘裁切 | `lib/layout.js` | 每秒采样 1 帧，缩放到 640×360，取 3px 边缘带；亮度阶跃阈值 30；某条边 ≥2 个阶跃记为裁切；≥30% 采样帧裁切则硬失败 |
| 画面节奏 | `lib/layout.js` 的 `analyzePacing()` | 4fps 抽帧，320×180 计算相邻帧平均亮度差；阈值 0.5；连续低差异 >4s 告警；前 3 秒变化 <2 次告警；默认分析同目录的同名 `<标题>_silent.mp4`，旧版回退 `output/video_silent.mp4`，再回退成片并裁掉底部 18% 字幕区 |
| 构图占屏 | `lib/layout.js` 的 `analyzeComposition()` | 1fps 抽帧；亮度 ≥32 或色度 ≥40 的像素视为前景；聚成 16×9 网格取外接框；主体占屏中位 <30%，或占屏 <30% 的帧占比 >40% 时告警；只告警不硬失败 |
| 特效字幕 | 同名 `.ass` | 统计 Dialogue 条数与关键词颜色标签；文件存在但无事件时告警 |

版式检查不是 DOM 检查：Canvas 的内容在 DOM 里看不到，只能读真实像素。
`lib/layout.js` 用 ffmpeg 把视频解成 `rawvideo/rgb24`，缩放到 640×360，
取四条边内侧 3px 窄带，计算亮度沿边的陡变次数；平滑渐变/光晕不会触发，
跨过边缘的文字和硬边图形会。单边 ≥2 次陡变记为裁切，≥30% 采样帧裁切硬失败。

注意：有意的全屏网格/铺满背景也会触发告警，需要结合画面人工确认。
本次样片 `parkinson.mp4` 在 30–34 秒的顿悟场景铺满全屏网格，属于设计意图，不是坐标错位。

节奏检查在同一支样片（`output/video_silent.mp4`）上实测：
画面变化率 37%，前 3 秒 9 次可感知变化；但 19.3–26.0s 有 **6.8 秒静止**，
正好是“工作会膨胀”的拆解段——旧版质检完全看不出来，新版会告警。这是本次迭代的
直接依据：不是提示词缺规则，而是规则没有落到可执行的检查上。

### 4.8 主题令牌：`lib/theme.js`

- `themes/themes.json` 来自 explainroo（MIT）。
- 默认主题 `midnight`。
- `themeBlock(name)` 把调色板、描边、入场、转场、代码、终端、字幕令牌和系统字体栈拼成文本，追加到节点2 系统提示词末尾。
- 字体只用系统栈，不加载外部字体。
- 主题令牌同时约束视觉规则：主色科技青 `#22d3ee`，唯一例外是冲突/高潮的警示红 `#ef4444`
  （红色面积 ≤20%）；入场 `easeOutBack`、位移/转场 `easeInOutCubic`、数据增长 `easeOutCubic`；
  底部 160px 留给节点4 字幕；渲染器不得自行绘制字幕。

### 4.9 为什么没有接入剪映自动化

最初设想是：模型给出歌曲名和片段 → 启动剪映专业版 → 检索同名歌曲 → 与视频合成。
实际调研后放弃，原因是这条链路从“打开软件”到“导出成片”每一环都不可靠：

| 环节 | 实际情况 |
|---|---|
| 官方 API | 剪映专业版没有开放给个人开发者的公共 API；第三方“剪映开放平台”面向企业应用接入，不提供本机桌面版的工程/导出自动化 |
| 窗口结构 | 剪映专业版（v11.x）是 CEF + Qt 混合界面，大量控件自绘；Windows UIAutomation 树里拿不到时间线、素材库、导出面板的可操作元素 |
| 模拟输入 | 用坐标点击/快捷键“盲操”能打开窗口，但素材检索结果依赖登录态、网络与推荐排序，无法稳定命中指定歌曲；一旦版本更新坐标全部失效 |
| 工程数据 | 草稿 `draft_content.json` 与 `crypto_key_store.dat` 加密，外部生成草稿再导入并不可行 |
| 服务条款 | 剪映用户协议限制自动化/批量操作，商业化使用存在合规风险 |
| 音乐版权 | 即便在剪映里搜到原曲，也不能把“软件内可试听”当成“可下载、可商用”；自动下载原曲属于侵权高风险路径 |

因此改为**在流水线内部完成选曲与混音**：模型负责“创作意图”（歌曲、版本、片段、
歌词提示、情绪、BPM、检索词），Jamendo 负责提供可授权的实际音轨，ffmpeg 负责
切段与闪避混音。这样 100% 可脚本化、可复现，也不依赖任何桌面软件。

如果未来剪映开放桌面端 API，`lib/jamendo.js` 的返回结构（`path/label/startOffset/
license/attribution`）可以直接替换成“向剪映工程注入音轨”的实现，节点4 的混音接口
不需要改。

---

## 5. 当前样片与运行数据

### 5.1 样片 `output/parkinson.mp4`

| 项目 | 值 |
|---|---|
| 时长 | 45.00s |
| 分辨率 | 1920×1080 |
| 帧率 | 30fps |
| 总帧数 | 1350 |
| 大小 | 4.9MB |
| 视频编码 | H.264（libx264，crf 18，preset medium） |
| 音频 | AAC 24kHz 单声道，edge-tts 配音 |
| BGM | 无（`audio/bgm.mp3` 不存在，节点4 仅用配音） |
| 字幕 | `output/parkinson.srt` / `.vtt` 10 条；实际烧录 9 条 |
| 脚本 | `output/parkinson.yaml`，5 个场景 |
| 渲染器 | `output/parkinson.html`，约 27KB |
| 质检 | 编码/时长/音量/旁白窗口通过；边缘裁切告警来自有意的全屏网格；节奏检查发现 19.3–26.0s 静止 6.8s；ASS 字幕 9 条、11 处关键词高亮 |

场景与旁白：

| 场景 | 时间 | 角色 | 旁白 |
|---|---|---|---|
| hook | 0–5s | 钩子 | 你有一整天，干活的有几分钟？ |
| empathy | 5–15s | 共情 | 早上你打开文档，想着时间还多。刷会儿手机，回个消息，一天就没了。 |
| breakdown | 15–30s | 拆解 | 帕金森定律说，工作会膨胀，直到占满你给它的所有时间。给你一天，拖一天。给你一小时，就一小时干完。 |
| epiphany | 30–40s | 顿悟 | 不是你懒。是时间太多，工作会铺开。把截止时间砍半，专注才会回来。 |
| golden | 40–45s | 金句 | 截止日期，才是生产力。 |

节点4 实际生成的 10 条字幕（`output/parkinson.srt`）：

```
1
00:00:00,100 --> 00:00:03,050
你有一整天，干活的有几分钟？

2
00:00:05,100 --> 00:00:08,355
早上你打开文档，想着时间还多。

3
00:00:08,375 --> 00:00:12,050
刷会儿手机，回个消息，一天就没了。

4
00:00:15,100 --> 00:00:20,630
帕金森定律说，工作会膨胀，直到占满你给它的所有时间。

5
00:00:20,650 --> 00:00:22,862
给你一天，拖一天。

6
00:00:22,862 --> 00:00:25,750
给你一小时，就一小时干完。

7
00:00:30,100 --> 00:00:31,492
不是你懒。

8
00:00:31,512 --> 00:00:34,475
是时间太多，工作会铺开。

9
00:00:34,475 --> 00:00:37,775
把截止时间砍半，专注才会回来。

10
00:00:40,100 --> 00:00:42,850
截止日期，才是生产力。
```

第 10 条与画面里的金句大标题完全同文，因此只保留在 srt/vtt 台词稿里，
不烧录到底部；成片中该句只出现一次。

历史样片 `output/2038.mp4` 及其脚本/渲染器/字幕仍保留在仓库中，用于对比旧版流程。

### 5.2 新规则回归样片 `output/parkinson_v2.mp4`

2026-10-17 用新版提示词重新生成脚本与渲染器，并跑完整条流水线：

| 项目 | 值 |
|---|---|
| 时长 / 大小 | 45.00s / 2.2MB |
| 脚本 | `output/parkinson_v2.yaml`，5 个场景，143 字（3.18 字/秒，在校验容差内） |
| 渲染器 | `output/parkinson_v2.html`，25.2KB；时间轴预检 193 个采样点、0 运行时错误 |
| 生成耗时 | 节点1 127.8s；节点2 165.2s；全流程（含 1350 帧渲染）5.4 分钟 |
| 旁白 | 5 段全部落在场景窗口内（最长 theory 12.7s / 15s） |
| 字幕 | ASS 14 条、12 处关键词高亮；金句字幕与画面标题同文，按去重规则跳过烧录 |
| 质检结论 | 编码/时长/音量/旁白窗口/ASS 通过；边缘裁切 1/45（装饰性粒子）；节奏检查发现 **22.3–29.8s（7.5s）** 与 **33.5–39.8s（6.3s）** 两段静止 |

这次回归同时验证了新增的检查确实能抓到问题：

- 节点2 静态审计发现 1 处未播种的 `Math.random()`（红点尾迹抖动），已记录为渲染器提示词的新约束；
- 两段长静止来自“只有一根缓慢收缩的进度条”的拆解/顿悟中段，说明“每 2–3 秒一次可感知变化”
  仍需要更强的渲染约束。随后已给节点2 提示词补上“背景层/母题层/数据层三层”、
  “第 0 帧必须有可见主体”和“尾迹抖动必须用固定种子”。
- 这两段长静止已在最新样片 `attention_v1` 中通过背景层自主运动和扫描元素消除（见 5.3）。

### 5.3 最新样片 `output/attention_v1.mp4`

2026-10-17 从选题、脚本到渲染器全部重新生成，用于验证五幕结构、节奏密度、视觉母题和
ASS 关键词高亮这一整套新规则。

| 项目 | 值 |
|---|---|
| 主题 | 每次切换应用，大脑要重启半秒；一天几百次，累计偷走约三小时 |
| 时长 / 大小 | 45.00s / 8.5MB（8,864,008 字节） |
| 分辨率 / 帧率 | 1920×1080 / 30fps / 1350 帧 |
| 脚本 | `output/attention_v1.yaml`，5 幕，135 个可发音字（14 / 29 / 50 / 29 / 13） |
| 渲染器 | `output/attention_v1.html`，44,351 字节；确定性 Canvas，无外部依赖 |
| 配音 | edge-tts 5 段：3.70 / 9.82 / 14.52 / 8.38 / 4.30 秒，全部在幕内结束 |
| 字幕 | srt/vtt 18 条；ASS 16 条、12 处关键词高亮（8 处黄、4 处红）；去重 2 条 |
| 画面节奏 | 变化率 65%（180 个采样帧）；前 3 秒 8 次变化；无 >4 秒静止 |
| 音量 | max_volume -3.4dB |
| BGM | 无（`audio/bgm.mp3` 不存在） |
| 质检 | 编码 / 时长 / 音量 / 旁白窗口 / 边缘裁切 / 画面节奏 / ASS 全部通过 |

场景与旁白：

| 场景 | 时间 | 角色 | 旁白 | TTS 时长 | 结束时刻 |
|---|---|---|---|---|---|
| hook | 0–5s | 钩子 | 你每切一次应用，大脑就重启半秒。 | 3.70s | 3.7s |
| empathy | 5–15s | 共情 | 写报告时切去看消息。回来要重读整段。切走。再重读。一小时，只写了三行。 | 9.82s | 14.8s |
| breakdown | 15–30s | 拆解 | 大脑需要重新加载全部上下文。像电脑冷启动。前额叶找回线索要半秒。每天切几百次，扔掉三小时。你在为切换付房租。值吗？ | 14.52s | 29.5s |
| insight | 30–40s | 顿悟 | 别靠意志力硬扛。把手机扣过去。一次只开一个窗口。让大脑跑完那半秒。 | 8.38s | 38.4s |
| golden | 40–45s | 金句 | 你专注的每一秒，都算数。删掉它。 | 4.30s | 44.3s |

画面设计：

- **视觉母题**：一个发光青点代表注意力焦点；每次切换应用，点被瞬间拉回原点，
  灰色“重启环”从点中扩散；结尾点挣脱并飞离，留下清晰光轨。
- **奇观**：22–28 秒，约 200 个半透明灰色重启环从画面上方落下，堆成一座 3 小时的
  “时间之山”，同时红色警示光晕脉冲扫过。
- **节奏补强**：稀疏的共情/拆解场景加入固定种子的环境重启环、上下扫描光束；
  波形图前方加一个随旁白推进的扫描头，扫过切换点时向下塌陷。

从生成到成片发现并修复的问题：

| 问题 | 现象 | 修复 | 结果 |
|---|---|---|---|
| 金句旁白超时 | 原句 6.4 秒，40s 起播到 46.4s，被片尾截断 | 缩为“你专注的每一秒，都算数。删掉它。” | 4.30 秒，44.3 秒结束 |
| 共情旁白越界 | 10.44 秒，播到 15.44s，与拆解幕配音重叠 | 缩短为三行结尾的 9.82 秒版本 | 14.8 秒结束 |
| 旁白泄漏 | 金句幕第二句被画成灰色小字，成片双份字幕 | 删除该小字；`auditNarrationLeak` 改为逐句探针 | 新片审计返回空；旧版可复现命中 |
| 两处长静止 | 8.3s 与 5.5s 画面几乎不动 | 环境环 + 扫描光束 + 波形扫描头 | 变化率 65%，无 >4 秒静止 |
| 金句压黑过早 | 压黑起点 43.5s，截屏窗口偏短 | 改为 44.2s 开始、0.8 秒完成 | 金句完整停留到 44.2s |
| 高亮词不匹配 | hook 的 `highlight` 写“切换”，旁白是“切一次” | 改为“切一次” | 节点1 校验通过 |

关于节奏：本片 135 字，按 45 秒计约 3.0 字/秒，低于提示词里的 144–157 字目标；
但实际发声总时长 40.72 秒，有效语速约 3.3 字/秒，且每段 TTS 都在幕内结束。
这说明“全片字数配额”是提示词层面的引导，最终仍应以 TTS 实测和节点5 时间窗为准。

### 5.4 实际运行数据

| 任务 | 命令 | 实际耗时 | Token |
|---|---|---|---|
| 拆知识点 | `node1.js --extract 测试1.txt` | 56.5s | prompt 1852 / completion 5328 / 合计 7180 |
| 知识点 → 30s 脚本 | `node1.js --book output/points-example.md --index 1 --duration 30` | 79.8s | prompt 2045 / completion 8677 / 合计 10722 |
| 帕金森定律 45s 脚本 | `node1.js --topic "帕金森定律：…" --duration 45` | 142.7s | —（本次日志未保留） |
| 同片 HTML 渲染器 | `node2.js --script output/parkinson.yaml` | 269.2s | —（本次日志未保留） |
| 精力电量 45s 脚本 | `node1.js --topic "手机电量20%…" --duration 45 --out output/energy-battery.yaml` | 135.5s | prompt 5247 / completion 12703 / 合计 17950 |
| 精力电量 HTML 渲染器 | `node2.js --script output/energy-battery.yaml --out output/energy-battery.html` | 214.5s | prompt 9317 / completion 27044 / 合计 36361 |

2026-10-17 全流程（节点1→5，含 1350 帧渲染、配音与字幕烧录）总耗时 **12.1 分钟**。
最新样片 `attention_v1` 的最终复跑复用了已有 HTML，只跑节点3→5（渲染、配音、字幕烧录、质检），
按产物时间戳约 **6 分钟**；节点1/2 的 token 日志未保留。

### 5.5 本轮新样片 `output/手机20%你会充电，人20%却在硬撑.mp4`

选题：「手机电量20%你会充电，人精力20%却还在硬撑」。这是 title 命名与 Jamendo 链路
落地后的第一条全流程样片。

| 项目 | 值 |
|---|---|
| 时长 | 45.00s |
| 分辨率 / 帧率 | 1920×1080 / 30fps（1350 帧） |
| 体积 | 成片 16.8MB；无声视频约 15.8MB |
| 音频 | AAC 48kHz 立体声；edge-tts `zh-CN-XiaoxiaoNeural`，+5% |
| BGM | 无（`JAMENDO_CLIENT_ID` 未配置，且本地 `audio/bgm/` 无曲目） |
| 字幕 | 10 条特效字幕、14 处关键词高亮；1 条与画面大标题同文，跳过烧录 |
| 脚本 | `output/energy-battery.yaml`，5 个场景 |
| 渲染器 | `output/energy-battery.html`，约 41.5KB |
| 质检 | 编码/时长/音量/节奏/构图/字幕通过；4 条提醒（无 BGM、两幕覆盖率、4% 边缘采样；后者是 37–38s 粒子逸散触底，属特效） |

场景与实测 TTS：

| 场景 | 时间 | 角色 | 旁白 | TTS 时长 |
|---|---|---|---|---|
| hook | 0–5s | 钩子 | 手机电量20%啦，你满屋找充电器。 | 4.03s |
| empathy | 5–15s | 共情 | 手机快没电你会慌。人快没电你却硬撑。头疼眼干手抖，是身体报警。 | 7.49s |
| breakdown | 15–30s | 拆解 | 精力像手机电池，用一点少一点。每个决定都在偷偷掉电。大脑一到20%，就进省电模式。你以为在拼，其实在欠费。 | 11.81s |
| insight | 30–40s | 顿悟 | 手机20%你会充电，人20%你要敢停。闭眼五分钟，比硬撑两小时更省电。 | 8.26s |
| golden | 40–45s | 金句 | 精力不是硬撑的，是拿来活的。 | 3.00s |

模型给出的 BGM 参考：**Experience — Ludovico Einaudi**，《In a Time Lapse》专辑版
（纯器乐），推荐片段 01:14–01:56，检索词 `cinematic piano strings rising tension`。
由于没有 Jamendo Client ID，本次没有下载任何在线音轨，也没有使用旧测试文件——
成片只有人声。配置 Key 后重跑节点4 即可自动换成授权 BGM：

```bash
set JAMENDO_CLIENT_ID=你的client_id
node audio.js --script output/energy-battery.yaml \
  --video "output/手机20%你会充电，人20%却在硬撑_silent.mp4" \
  --out "output/手机20%你会充电，人20%却在硬撑.mp4"
```

本片发现并修复的渲染器问题：

1. **`radialGlow()` 生成非法颜色**：首次渲染报
   `addColorStop('rgbaa(34,211,238')`。模型假定调用方传完整 `rgba()`，实际传的是
   缺右括号的前缀，`replace('rgb','rgba')` 二次加 a。改为解析颜色主体后统一拼
   `rgba(r,g,b,a)`。
2. **左侧电量环出画**：15–40 秒左环中心在 `x=-620/-720`，连同“手机 100%”标签
   被左/上边缘裁掉，质检 38% 采样帧报裁切。调整关键帧到 `x=-540/-560`、
   `y=-40/-120`，标签与圆环完整可见。
3. **金句页充电图标压字**：40–45 秒图标从画面中心移动到右下角，正好穿过金句。
   把移动提前到 34–40 秒，40 秒时图标已在右下角。
4. **“闭眼五分钟 > 硬撑两小时”底边裁切**：文字基线太低，第二行被底边切掉。
   整体上移 60px，行距 100→90。

节奏与构图：画面变化率 99%，前 3 秒 10 次可感知变化，无 >4 秒静止；
主体占屏中位 88%。旁白总发声 34.58s，占 45 秒的 76.8%；empathy 与 golden
两幕覆盖率分别为 75% 和 60%，属于“说完留白”的预期提醒，不是溢出。

---

## 6. 目录与文件

```
main.js                         主控：节点1→5
node1.js                        选题 / 脚本 / 拆书 / 知识点脚本
node2.js                        脚本 → HTML 渲染器 + 静态自检
render.js                       Playwright 逐帧截图 + ffmpeg 合成
audio.js                        edge-tts 配音、ASS 特效字幕、BGM 闪避、混音
qa.js                           成片质检
setup.js                        环境检测与安装
lib/deepseek.js                 DeepSeek 流式客户端
lib/theme.js                    主题令牌注入
lib/layout.js                   边缘裁切 / 节奏 / 构图检测
lib/subtitle.js                 srt / vtt / ass 解析与生成（关键词高亮）
lib/util.js                     参数、探测、ffmpeg 封装
lib/naming.js                   标题 → 安全文件名、重名策略、同名产物路径
lib/jamendo.js                  Jamendo 检索 / 授权过滤 / 下载 / 片段起点 / 署名
lib/bgm.js                      本地 BGM 兜底查找
prompts/node1-topics.md         选题提示词
prompts/node1-script.md         选题 → 脚本提示词
prompts/node1-points.md         资料 → 知识点提示词
prompts/node1-point-script.md   知识点 → 脚本补充提示词
prompts/node2-prompt.md         脚本 → HTML 渲染器提示词
themes/themes.json              视觉风格令牌
output/topics-binary.md         选题实际产出（10 行）
output/script-2038.yaml         历史样片脚本（2038 年问题）
index-2038.html                 历史样片渲染器
output/2038.mp4                 历史样片成片
output/2038.srt / .vtt          历史样片字幕
output/parkinson.yaml           基础样片脚本（帕金森定律，45s）
output/parkinson.html           基础样片渲染器
output/parkinson.mp4            基础样片成片
output/parkinson.ass/.srt/.vtt  基础样片烧录字幕 + 台词稿
output/parkinson_v2.yaml       新规则回归脚本
output/parkinson_v2.html       新规则回归渲染器
output/parkinson_v2.mp4        新规则回归成片
output/parkinson_v2.ass/.srt/.vtt 新规则回归字幕 + 台词稿
output/qa_v2/                  关键帧截图（浏览器预检用）
output/attention_v1.yaml       最新样片脚本（注意力切换，45s）
output/attention_v1.html       最新样片渲染器（44,351 字节）
output/attention_v1.mp4        最新样片成片（8.5MB）
output/attention_v1.ass/.srt/.vtt 最新样片烧录字幕 + 台词稿
output/qa_attention/           最新样片关键帧截图
output/energy-battery.yaml      本轮新样片脚本（精力电量，45s）
output/energy-battery.html      本轮新样片渲染器（约 41.5KB）
output/手机20%你会充电，人20%却在硬撑.mp4        本轮新样片成片（16.8MB）
output/手机20%你会充电，人20%却在硬撑_silent.mp4 本轮无声视频（15.8MB）
output/手机20%你会充电，人20%却在硬撑.ass/.srt/.vtt/.audio.json 同名字幕与混音清单
output/video_silent.mp4        旧版固定名无声视频（仅为兼容保留）
output/points-example.md        拆书实际产出（8 个知识点）
output/script-point-example.yaml 30s 知识点脚本实际产出
output/<meta.title>.mp4        当前默认产出的成片（标题命名）
output/<meta.title>_silent.mp4 同名无声视频（节点5 节奏检查的默认对象）
output/<meta.title>.audio.json 同名混音清单（BGM 来源 / 授权 / 片段起点）
output/<meta.title>.srt/.vtt/.ass 同名字幕与烧录字幕
frames/                         逐帧 PNG（默认保留）
audio/voice_XX.mp3              分段配音
audio/voice.mp3                 按时间轴拼接后的人声轨
audio/bgm/jamendo-<id>.mp3      Jamendo 下载缓存（按曲目 id，重复运行直接复用）
```

## 7. 命令速查

```bash
# 环境
node setup.js --check
node setup.js --auto

# 节点1
node node1.js --topics "领域"
node node1.js --topic "选题" --duration 45
node node1.js --extract 资料.txt
node node1.js --book output/points.md --index 1 --duration 45

# 一条命令出片：成片默认按脚本 meta.title 命名
node main.js --topic "选题" --duration 45
node main.js --material 资料.txt --index 1 --duration 45
node main.js --points output/points.md --index 1 --duration 45
node main.js --script script.yaml

# 自定义产物名 / 保留旧版 / 换输出目录
node main.js --script script.yaml --name "自定义标题"
node main.js --script script.yaml --unique          # 重名时自动追加 _2、_3
node main.js --script script.yaml --out-dir output/2026-10-17

# 指定全部产物路径（脚本名不必等于标题）
node main.js --topic "帕金森定律：…" --duration 45 --script output/parkinson.yaml --html output/parkinson.html --video output/parkinson.mp4

# 复用已有脚本与渲染器，重跑最新样片（不调用 DeepSeek）
node main.js --script output/attention_v1.yaml --html output/attention_v1.html

# 强制重新生成渲染器后再出片
node main.js --script output/attention_v1.yaml --html output/attention_v1.html --force-node2

# BGM：默认优先 Jamendo；关掉则只用本地兜底；也可直接指定文件
set JAMENDO_CLIENT_ID=你的免费client_id
node main.js --script script.yaml
node main.js --script script.yaml --no-jamendo
node main.js --script script.yaml --bgm audio/bgm/my-track.mp3

# 分步（中间产物与成片都按标题命名）
node node2.js --script output/标题.yaml --theme midnight --out output/标题.html
node render.js --html output/标题.html --script output/标题.yaml --clean
node audio.js --script output/标题.yaml --bgm-style ambient_tech_tension --rate +5%
node qa.js --script output/标题.yaml --video "output/标题.mp4" --blackdetect
```

常用参数：

| 参数 | 作用 |
|---|---|
| `--topic` / `--topics` | 一句话选题出片 / 只生成 10 个候选选题 |
| `--material` / `--points` | 资料拆知识点 / 直接使用现成知识点 |
| `--index` | 使用第几个知识点（从 1 开始） |
| `--duration` | 成片时长，默认 45 |
| `--script` / `--html` / `--video` | 指定脚本 / 渲染器 / 成片路径；`--html` 已存在且未加 `--force-node2` 时直接复用；`--video` 缺省时按标题命名 |
| `--name` | 覆盖产物名（默认取 `meta.title`，无标题则取脚本文件名） |
| `--unique` | 重名时追加 `_2`、`_3`，不覆盖旧版（默认覆盖） |
| `--out-dir` | 成片与配套产物目录，默认 `output/` |
| `--silent` | 指定无声视频路径（默认 `<标题>_silent.mp4`） |
| `--theme` | 节点2 视觉风格，默认 `midnight` |
| `--model` | DeepSeek 模型，默认 `deepseek-v4-pro` |
| `--force-node2` | 强制重新生成 HTML |
| `--skip-node2` | 跳过节点2，直接使用现成 HTML |
| `--bgm` | 显式指定 BGM 文件，优先级最高 |
| `--bgm-style` | 本地兜底 BGM 风格；Jamendo 不可用时到 `audio/bgm/` 自动选曲 |
| `--no-jamendo` | 关闭 Jamendo 在线选曲，只用 `--bgm` / 本地兜底 |
| `--jamendo-client-id` | 临时传入 Jamendo client id（也可用环境变量 `JAMENDO_CLIENT_ID`） |
| `--rate` | edge-tts 语速，默认 `+5%` |
| `--no-text-normalize` | 关闭旁白标点规范化 |
| `--no-bgm` / `--no-duck` | 关闭 BGM / 关闭闪避 |
| `--no-pacing` / `--no-composition` | 质检跳过节奏 / 构图占屏检查 |
| `--subs <burn\|sidecar>` | 默认烧录特效字幕；`sidecar` 只导出 srt/vtt |
| `--no-subs` | 不烧录也不导出字幕 |
| `--clean` | 渲染后删除 `frames/` |
| `--help` / `-h` | 只打印用法，不启动任何节点 |
