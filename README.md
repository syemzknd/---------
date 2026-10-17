# 自动化产出简易视频

给一句话选题，或导入一份资料，由 DeepSeek 自动写成视频脚本；AI 再生成 HTML 渲染器，
逐帧截图后交给 ffmpeg 合成配音、BGM 与字幕，产出 MP4。

两种入口：

- **提示词 → 视频**：给一个主题，或先让 DeepSeek 列 10 个候选选题，挑一个直接出片。
- **资料 → 视频**：导入 txt/md 资料，DeepSeek 拆出知识点，再把某个知识点写成脚本并出片。

核心思路：**让 AI 写一个 HTML5 Canvas 渲染器，再用浏览器逐帧截图，最后交给 ffmpeg 合成。**
AI 只负责「写什么、画什么」，画面之外的编码、混音、质检全部由确定性代码完成。
所有 LLM 调用都走 DeepSeek，密钥来自环境变量 `DEEPSEEK_API_KEY`。

## 流程

```
节点1  DeepSeek 生成选题 / 视频脚本 / 拆书知识点   → topics.md / script.yaml / points.md
节点2  DeepSeek 读脚本，生成 HTML 渲染器           → index.html
节点3  Chromium 逐帧截图 → ffmpeg 合成无声视频     → output/<标题>_silent.mp4
节点4  edge-tts 配音 + Jamendo BGM + 特效字幕烧录  → output/<标题>.mp4 / .audio.json / .ass / .srt / .vtt
节点5  成片质检                                    → 控制台报告
```

**最终产物按脚本的 `meta.title` 命名**（无标题时取脚本文件名）；重名默认覆盖，
加 `--unique` 则自动追加 `_2`、`_3`。无声视频、混音清单、字幕都跟成片同名，
不再出现 `final.mp4` / `video_silent.mp4` 这种与内容无关的名字。

节点1 可以跳过——已有手写或外部生成的 YAML 脚本时，直接从节点2 开始跑。

## 环境要求

- Node.js ≥ 18
- ffmpeg / ffprobe 在 PATH 中
- Python 3 + edge-tts（节点4）
- 环境变量 `DEEPSEEK_API_KEY`（节点1、节点2）
- 可选环境变量 `JAMENDO_CLIENT_ID`（节点4 在线 BGM；免费申请，不配则退回本地 BGM）

```bash
npm install
npx playwright install chromium
py -3 -m pip install --upgrade edge-tts

# 检查环境是否齐备
npm run setup
```

设置 API Key（PowerShell，永久写入用户环境变量）：

```powershell
[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY","sk-xxxxxxxx","User")

# 可选：Jamendo 免费 client id（https://devportal.jamendo.com/ 注册应用即可）
[Environment]::SetEnvironmentVariable("JAMENDO_CLIENT_ID","xxxxxxxx","User")
```

### Windows 上的一个坑

很多 Windows 机器上 `python` / `pip` 指向 Microsoft Store 的 0 字节占位程序，
直接调用会静默失败。`lib/util.js` 的 `resolveTts()` 会按
`edge-tts` → `py -3 -m edge_tts` → `python3 -m edge_tts` → `python -m edge_tts`
的顺序探测，命中第一个可用的。也可以用 `EDGE_TTS_CMD` 环境变量或 `--tts` 显式指定。

## 用法

先跑通示例（不需要 API Key）：

```bash
node main.js --script examples/script.yaml --html examples/index.html --skip-node2
```

两种入口，一条命令出片：

```bash
# 提示词 → 视频
node main.js --topic "2038年，32位时间戳将把日历炸回1901年" --duration 45

# 资料 → 视频（自动拆知识点，取第 1 个写成脚本）
node main.js --material 资料.txt --index 1 --duration 45

# 已有脚本 → 视频（成片按 meta.title 命名）
node main.js --script script.yaml

# 自定义产物名 / 保留旧版 / 换输出目录
node main.js --script script.yaml --name "自定义标题"
node main.js --script script.yaml --unique
node main.js --script script.yaml --out-dir output/2026-10-17

# BGM：默认优先 Jamendo（需 client id）；关掉则用本地兜底
node main.js --script script.yaml --no-jamendo
node main.js --script script.yaml --bgm audio/bgm/my-track.mp3
```

只想先看看有哪些选题可以拍（不渲染）：

```bash
node main.js --topics "计算机与二进制"
```

分步运行（每一步都可单独跑、单独替换）：

```bash
node node1.js --topics "二进制"                    # → output/topics.md（10 个选题）
node node1.js --topic "计算机差点不用二进制"        # → script.yaml
node node1.js --extract 某本书.txt                 # → output/points.md（知识点）
node node1.js --book output/points.md --index 1     # → script.yaml（知识点 → 脚本）
node node2.js --script script.yaml --theme midnight --out index.html
node render.js --html index.html --script script.yaml [--clean]
node audio.js  --script script.yaml [--bgm audio/bgm.mp3] [--bgm-style ambient_tech_tension] [--voice zh-CN-XiaoxiaoNeural] [--rate +5%] [--subs burn|sidecar]
node qa.js     --script script.yaml [--video "output/<标题>.mp4"] [--blackdetect] [--no-pacing] [--no-composition]
```

### 常用参数

| 参数 | 作用 |
|---|---|
| `--topic <文字>` | 一句话选题；节点1 据此写脚本后直接出片 |
| `--topics <文字>` | 只生成 10 个候选选题，不渲染 |
| `--material <文件>` | 导入资料；节点1 拆出知识点，取 `--index` 指定的那条写脚本 |
| `--points <文件>` | 跳过拆书，直接用现成的知识点 md |
| `--index <n>` | 资料模式用第几个知识点（从 1 开始），默认 1 |
| `--duration <秒>` | 成片时长，默认 45 |
| `--theme <name>` | 节点2 视觉风格，默认 `midnight`；`--list-themes` 列出全部 |
| `--model <name>` | DeepSeek 模型，默认 `deepseek-v4-pro` |
| `--force-node2` | 已有 `index.html` 时强制重新生成 |
| `--skip-node2` | 跳过节点2，直接用现成 HTML（调试渲染管线时用） |
| `--name <文字>` | 覆盖产物名；默认取 `meta.title`，没有则取脚本文件名 |
| `--unique` | 重名时追加 `_2`、`_3`，保留旧版（默认覆盖） |
| `--out-dir <目录>` | 成片及同名配套产物的输出目录，默认 `output/` |
| `--silent <文件>` | 指定无声视频路径；默认 `<标题>_silent.mp4` |
| `--bgm <文件>` | 显式指定 BGM，优先级最高 |
| `--no-jamendo` | 关闭 Jamendo 在线选曲，只用 `--bgm` / 本地兜底 |
| `--jamendo-client-id <id>` | 临时传入 Jamendo client id（也可用环境变量） |
| `--no-bgm` | 不混 BGM |
| `--bgm-style <name>` | 本地兜底 BGM 风格，覆盖 `meta.bgm_style`；到 `audio/bgm/` 自动选曲 |
| `--no-duck` | 关掉 BGM 自动闪避，改成等音量直接叠加 |
| `--rate <+5%>` | edge-tts 语速，默认 `+5%` |
| `--no-text-normalize` | 关闭旁白标点规范化（不推荐；默认会统一标点并给长句补呼吸停顿） |
| `--subs <burn\|sidecar>` | 字幕模式：默认 `burn` 烧录特效字幕；`sidecar` 只导出 srt/vtt、画面保持干净 |
| `--no-subs` | 既不烧录也不导出字幕 |
| `--clean` | 渲染结束后删掉 `frames/` 中间帧 |
| `--help` / `-h` | 打印用法后退出，不启动渲染 |
| `--no-pacing` | 质检时跳过画面节奏（静止区间）检查 |
| `--no-composition` | 质检时跳过构图占屏（主体是否 ≥30%）检查 |
| `--pacing-video <文件>` | 指定节奏/构图检查用的视频；默认优先用同目录的 `<标题>_silent.mp4` |

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | **必需**，节点1、节点2 用 |
| `DEEPSEEK_MODEL` | `deepseek-v4-pro` | 也可用 `deepseek-flash` |
| `DEEPSEEK_STALL_TIMEOUT` | `240` | 流式响应停滞多少秒判定连接已死 |
| `DEEPSEEK_MAX_TOKENS` | `65536` | 调小容易把 HTML 截断 |
| `EDGE_TTS_CMD` | 自动探测 | 显式指定 edge-tts 命令 |
| `JAMENDO_CLIENT_ID` | — | Jamendo 免费 client id；不配则节点4 跳过在线选曲 |
| `JAMENDO_API_BASE` | 官方 v3.0 地址 | 离线/测试时指向 mock 服务 |

## 脚本格式

```yaml
meta:
  title: 圆周率为什么是无理数   # 成片与配套产物默认用这个标题命名
  duration: 30          # 秒，决定视频总长
  fps: 30
  resolution: 1920x1080
  bgm_style: ambient_tech_tension   # 本地兜底 BGM 风格
  bgm:                  # 模型给出的 BGM 创作参考，供 Jamendo 检索
    song: Time
    artist: Hans Zimmer
    version: Inception 原声（纯器乐版）
    segment_start: "01:23"
    segment_end: "02:05"
    lyric_cue: 01:23 起逐步叠加弦乐
    instrumental: true
    mood: 紧张、克制、逐步上扬
    bpm: 112
    jamendo_query: dark ambient tension pulse
    jamendo_tags: [dark, ambient, instrumental]
    fallback_queries: [cinematic suspense drone]

scenes:
  - id: intro
    start: 0            # 秒
    end: 10
    narration: 圆周率是圆的周长与直径之比。
    elements:
      - type: title
        text: 圆周率 π
```

`start` / `end` 必须和 `duration` 对得上——节点5 会检查成片时长是否和
`meta.duration` 一致（容差 0.5s），节点4 会检查每段配音是否超出所在场景窗口。

## 节点1 的生成原则

提示词在 `prompts/node1-*.md`，核心来自一套短视频剧作规范：

- **生活相关性优先**：10 个候选选题里至少 **7 个**必须关乎大众生活、拖延症、
  认知偏差、效率陷阱或时间管理；纯技术冷知识直接淘汰。
  技术领域要先翻译成“它影响你哪件日常小事”，例如 2038 时间戳 → 手机日历/闹钟/转账时间。
- **反直觉认知差 + 至少一条代价**：反常识 / 有代价 / 有痛点 / 有反转，四类都不沾的直接淘汰。
- **Golden 3s 钩子**：前 3 秒只能从 **极端假设 / 扎心拷问 / 预期反转** 里选一种，
  第一句 ≤18 字（标点不计），禁止“XX 定律指出……”这种平铺直叙。候选选题列表会直接标出钩子类型，
  10 个候选里至少 3 个必须是「极端假设」开局。
- **五幕情绪曲线**（按比例缩放，45 秒版）：
  焦虑/痛点 0–5s → 痛苦共情 5–15s → 理论拆解 15–30s → 醍醐灌顶/解法 30–40s → 金句升华 40–45s。
  结尾必须回到观众自己（手机、闹钟、转账、工作），不能停在冷知识。
- **金句**：`meta.golden_line` 必须有一句 ≤20 字、适合截屏发朋友圈的话，
  并在最后一幕用 title 显示至少 2 秒；全片最多 2 句。
- **视觉母题**：`meta.visual_motif` 指定一个全片复用的核心隐喻
  （红点轨迹 / 收缩进度条 / 逐层绽放的树 / 翻页日历），至少贯穿 3 个场景并递进。
  抽象概念必须写成具体几何运动，禁止“展示焦虑”这种空指令。
- **视觉聚焦**：每个场景有且只有一个 `focus: true` 主焦点，并写 `occupancy`（外接框
  占画面宽或高的比例，**不得低于 0.30**）。节点1 会检查缺失、重复或过小的主焦点。
- **BGM 推荐**：`meta.bgm` 必须具体到歌曲、艺术家、版本、片段起止（`mm:ss`，≥20 秒）、
  歌词或器乐提示、是否器乐、BPM，并给英文 `jamendo_query` 与 1–2 条 `fallback_queries`；
  `meta.bgm_style` 作为本地兜底。节点1 会校验字段与时间格式。详见
  [音频：BGM 选曲、闪避与旁白规范化](#音频bgm-选曲闪避与旁白规范化)。
- **旁白**：每句 ≤ 20 字，禁用「首先/其次/然后/最后/因此/综上所述」；
  旁白只写在 `narration` 里，`elements` 只写画面文案。
- **语速已放慢到 3.2–3.5 字/秒**：场景时长 ≥ 字数 / 3.2 + 0.8s。
  45 秒应写 **144–157 字**，60 秒应写 **192–210 字**；少了会变成中段大段空白，
  多了节点4 会报旁白溢出。节点1 会按这个区间直接告警（±0.05 字/秒的估算容差）。
- **节奏密度**：每 2–3 秒一次可感知的视觉变化，任何画面静止不超过 4 秒；
  前 3 秒至少 2 次视觉事件。节点1 会查场景元素的时间窗空窗，
  节点5 会抽帧查成片里超过 4 秒的静止区段。
- **字幕高亮词**：每个场景写 `highlight: [核心词]`，词必须原样出现在旁白里，
  节点4 会用它们做动态字幕的关键词高亮。
- **截屏级奇观**：`meta.spectacle` 写清那个值得截图的瞬间，
  并在 `elements` 里至少给一个元素标 `spectacle: true`。
  奇观必须是视觉母题的演化，不能空降一个新图形。
- **缓动**：元素写 `easing: easeOutBack / easeInOutCubic / easeOutCubic`，禁止 linear。
- **拆书模式**：只从资料里提炼 5–10 个知识点，事实必须以「原文依据」为限；
  知识点 → 脚本时只讲这一条，不扩写成整本书综述。

## HTML 渲染器契约

节点2 生成、节点3 消费的接口，提示词见 `prompts/node2-prompt.md`：

```js
window.FPS = 30;
window.DURATION = 30;
window.TOTAL_FRAMES = FPS * DURATION;
window.renderFrame = function (frameIndex) { /* 纯函数，同帧号必须同画面 */ };
```

URL 带 `?frame=N` 时只渲染第 N 帧，画完后置 `window.__RENDER_DONE__ = true`。
不带参数时自动循环播放，方便在浏览器里预览。

硬性要求：**不许依赖任何外部网络资源**（图片、字体、CDN）。节点2 的
`auditHtml()` 会扫描 `<script src="http...">`、`<link href="http...">`、
`@import url(http...)`、CSS `url(http...)` 并在命中时告警，确保离线可渲染。

节点2 还会做视觉语言自检（只告警）：缓动函数是否**真的被调用**而不只是定义、
`drawMotif` 是否至少 3 处场景调用、`drawBackground` / `motifAt(t)` 是否实现
（保证三层结构与跨场景母题连续）、`focus` / `occupancy` 是否落到绘制代码、
随机视觉元素是否使用固定种子 PRNG，以及是否出现未播种的 `Math.random()` 或
`Date.now()` / `performance.now()` 驱动画面。这些正是“提示词写了、模型没执行”的高发区。

画面层面的两条硬约束写在 `prompts/node2-prompt.md`：

- **主焦点外接框的宽或高 ≥ 视口 30%**（推荐 40–65%），禁止主体缩在角落、大片死黑；
- **除片尾压黑外禁止整屏淡入淡出/硬切**，场景边界必须由上一幕的终点图形
  放大、平移或形变长出来。

## 画面里不许出现旁白台词

这是最容易犯、后果最直接的错：**AI 会把脚本的 `narration` 当画面文案画进去**。
一旦画了，成片里就有两份字幕——一份烧在画面里、一份播放器叠加的 srt，
互相重叠且无法对齐，直接废片。

所以有两道防线：

1. `prompts/node2-prompt.md` 里明令禁止，并给出判断标准——
   *你画的字应该在脚本的 `elements` 里找得到，而不是在 `narration` 里找得到。*
2. 节点2 的 `auditNarrationLeak()` 做实际拦查：把每段旁白按句号/问号/叹号/分号
   拆句，每句去掉标点后取前 10 个字当探针，在 HTML 里搜。命中就告警并列出是哪个场景；
   但如果该句本来就是 `elements[].text` 里明确要求的画面文案（例如最后一幕的金句卡片），
   则放行。按句拆是因为只探旁白开头会漏掉“后一句被画成小字”的情况——实测金句页
   就是这么漏过的。

> 只靠提示词不够。实测第一版生成的 HTML 里，三条旁白**全部**被画进了画面，
> 而静态自检五项全过——因为「有没有多余字幕」根本不是那五项能看出来的。
> 提示词是建议，检查才是约束。

字幕由节点4 统一产出。**默认不再只给外挂 srt，而是生成 ASS 并把特效字幕烧进画面**
（`<标题>.mp4` → 同名的 `.ass` / `.srt` / `.vtt`）：

- **关键词高亮**：脚本每个场景的 `highlight` 词用荧光黄 `#fcd34d` 高亮；
  在顿悟/反转/金句场景自动换成警示红 `#ef4444`。
- **字随音动**：整句淡入 + 轻微回弹，关键词按**标点加权后的字符位置**估算出现时刻
  （逗号约等于 1.8 个字、句号/问号约 2.6 个字），到时弹跳 14% 再回落。
  时间轴仍来自 edge-tts 的逐句边界，所以是“词级近似”，不是 Whisper 那种逐字对齐——
  但比纯字数比例更贴近真实语流，且完全确定性、零额外依赖。
- **单一字幕源**：渲染器（节点2）仍然禁止画字幕；节点4 烧录后画面里只有一份字幕。
- **同文去重**：若画面里已有与字幕完全相同的大标题（常见于结尾金句），该条字幕跳过烧录，
  避免同一句话在画面中心和底部各出现一次；`.srt` / `.vtt` 台词稿仍完整保留。
- **外挂字幕**：`.srt` / `.vtt` 仍然导出，作为台词稿或给需要外挂字幕的平台备用。
  **已经烧录的情况下不要再在平台上挂同名 srt，否则会重叠成双份字幕。**
- 想保留干净画面、只外挂字幕：加 `--subs sidecar`。
- ffmpeg 不带 libass（没有 `ass` 滤镜）时会自动退回 sidecar 并告警。

## 音频：BGM 选曲、闪避与旁白规范化

节点4（`audio.js`）自动完成三件事，不需要手动指定 BGM 也能出片：

**1）BGM 三级选曲：显式文件 → Jamendo → 本地兜底**

- **模型推荐**：节点1 在 `meta.bgm` 里给出具体歌曲、艺术家、版本、片段起止
  （`mm:ss`）、歌词/器乐提示、是否器乐、BPM，以及英文检索词
  `jamendo_query` / `jamendo_tags` / `fallback_queries`。参考歌曲只用来表达创作意图，
  项目**不下载原曲**。
- **Jamendo 自动选曲**：配置 `JAMENDO_CLIENT_ID` 后，节点4 用上面的检索词搜索
  Jamendo 授权曲库，过滤 NC（禁止商用）许可证，优先器乐、可下载的曲目，
  下载到 `audio/bgm/jamendo-<id>.mp3`（重复运行直接复用），并按推荐片段的起点
  `-ss` 切入。混音清单会记录实际曲目、许可证与署名串。
- **本地兜底**：没有 client id、网络失败或加 `--no-jamendo` 时，按 `meta.bgm_style`
  查找 `--bgm` → `audio/bgm/<style>.<ext>` → `audio/bgm-<style>.<ext>` →
  文件名关键词 → `audio/bgm.mp3` → `audio/bgm/` 里唯一音频。找不到时明确告警并只用配音，
  不会静默出一版“干声片”。

本地兜底风格：

| 风格值 | 情绪 |
|---|---|
| `ambient_tech_tension` | 科技悬疑、倒计时（默认） |
| `ambient_calm` | 平静共情 |
| `lofi_focus` | 专注日常 |
| `cinematic_uplift` | 反转顿悟、上扬 |
| `news_urgent` | 危机警示 |
| `minimal_pulse` | 极简脉冲 |

> **为什么不在剪映里搜歌合成？** 剪映专业版没有面向个人开发者的公开 API，
> 界面是 CEF + Qt 自绘、UIAutomation 拿不到时间线与素材库控件，模拟点击依赖登录态和
> 推荐排序，草稿还加密，协议也限制自动化。更重要的是，软件内能试听不等于能下载/商用。
> 因此选曲与混音全部放在流水线内部完成，100% 可复现。详见 WORKFLOW.md 4.9。

> **授权边界**：Jamendo 曲目是 CC 授权作品，不是模型推荐的原曲。发布时按
> `.audio.json` 里的 `attribution` 署名；ND 许可证会被降权并告警，CC 素材的
> 商用范围请逐曲核对。免费 API 主要面向非商业应用；商业项目建议只用自购/自制
> BGM（`--bgm` + `--no-jamendo`）。

**2）侧链闪避 + 首尾淡入淡出**

人声一出现，BGM 自动下压约 10dB（`sidechaincompress=threshold=0.05:ratio=8:
attack=20:release=300`），人声停下自动恢复；人声会先 `asplit=2`，一路留作主轨、
一路当侧链触发信号（`sidechaincompress` 会消耗第二路输入，不拆分会直接报错）。
两路统一为 48kHz 立体声后再混音。BGM 先 `atrim` 到视频长度，再做 0.8s 淡入和
最长 1.2s 淡出，循环接缝不会突然断掉。

**3）旁白标点规范化 + 默认 +5% 语速**

TTS 之前会统一全/半角标点、合并重复标点、把换行变成停顿，并给超长分句补呼吸逗号；
只改标点、不改字，`highlight` 词仍原样保留。默认语速 `+5%`（`--rate` 可覆盖），
减少 edge-tts 中段的机械拖音。想完全保留原文可加 `--no-text-normalize`。

节点4 同时输出与成片同名的 `<标题>.audio.json` 混音清单（清单版本 2），记录标题、
BGM 来源/文件/风格/闪避开关、实际曲目、许可证、署名串、片段起点、模型推荐的参考曲与片段、
语速、每幕配音时长和规范化后的台词。节点5 用它检查 BGM 是否真的挂上、授权是否可用、
闪避是否开启、旁白覆盖率是否低于 75%。

## 目录结构

```
main.js               主控，串起节点1→5
node1.js              节点1：DeepSeek 生成选题 / 脚本 / 拆书知识点
node2.js              节点2：DeepSeek 生成 HTML 渲染器 + 产出物自检
render.js             Playwright 逐帧截图 + ffmpeg 合成
audio.js              edge-tts 配音、时间轴拼接、BGM 闪避、ASS 特效字幕烧录
qa.js                 成片质检
setup.js              环境自检与一键安装
lib/util.js           共享工具（参数解析、探测、ffmpeg 封装）
lib/bgm.js            BGM 风格库与本地自动选曲
lib/jamendo.js        Jamendo 检索 / 授权过滤 / 下载 / 片段起点 / 署名
lib/naming.js         标题 → 安全文件名、重名策略、同名产物路径
lib/layout.js         像素级版式 / 节奏 / 构图占屏分析
lib/deepseek.js       共享 DeepSeek 流式客户端（停滞检测、错误提示）
lib/theme.js          风格令牌 → 提示词注入
lib/subtitle.js       srt / vtt / ass 解析与生成（含关键词高亮）
themes/themes.json    视觉风格令牌（来源见 NOTICE.md）
prompts/node1-topics.md        选题提示词
prompts/node1-script.md        选题 → 脚本提示词（V2 剧作原则）
prompts/node1-points.md        资料 → 知识点提示词
prompts/node1-point-script.md  知识点 → 脚本补充提示词
prompts/node2-prompt.md        节点2 系统提示词
examples/             可直接跑通的示例
```

## 实现中踩过并修掉的坑

这些都不是理论问题，是实测复现后改的，改动原因写在代码注释里。

**`ffmpeg -shortest` 会截断视频。** 实测：10 秒无声视频 + 3 秒音频，
输出只有 **3.000000 秒**。改成给音频补 `apad` 到无限长、再用 `-t` 明确
指定输出时长。实测输出 10.000000 秒。

**`amix` 默认按输入数量做归一化。** 3 段旁白混音后整体音量被除以 3。
实测：默认参数 -23.4dB，加 `normalize=0` 后 -13.8dB（单路正弦参考 -21.1dB）。
所有 `amix` 都显式写了 `normalize=0`。

**`adelay` 要加 `all=1`。** edge-tts 输出的是单声道，写成 `adelay=N|N`
（文档里的立体声写法）在单声道轨上会出错。

**DeepSeek 的模型名。** 网上流传的 `deepseek-chat` 已经不存在了，查
`/models` 实际只有 `deepseek-v4-pro` 和 `deepseek-flash`。

**字幕精度。** 实测 edge-tts 的 `WordBoundary` 事件数为 **0**（中英文都是），
只有 `SentenceBoundary`。所以字幕时间轴是逐句的，做不到真正的逐字卡点。
ASS 里关键词的弹跳时刻按“字符位置 / 句子总字数”按比例估算，视觉上已经能跟上语速，
但它不是真实发音时刻。要真逐字得上 Whisper 二次对齐，本项目暂不引入。

**AI 会把旁白画进画面。** 第一版生成的三条旁白全部被当成画面文案绘制，
成片出现双份字幕。而当时的五项静态自检**全部通过**——结构检查看不出画面里画了什么。
修法见上方「画面里不许出现旁白台词」。

**坐标系重复加偏移，整条视频报废。** 提示词给了相机变换
`translate(W/2, H/2)`，但没说明世界坐标原点在哪。模型于是按屏幕坐标绘制
（标题画在 `W/2`），又叠加了一层 `translate(W/2)` → 整体右移 960、下移 540，
标题落在 (1920, 1080)，画面只剩右下角残片。已把「世界坐标原点 = 画面中心」
写进提示词并给出 ✓/✗ 对照。**这是提示词缺一条约定导致的事故，不是模型能力问题。**

**结尾压黑盖住了还没亮完的标题。** 生成的代码让结尾标题在 58–59.5s 淡入，同时从 58s
就开始压黑，实测 58.5s 标题只剩四成亮度。已把压黑推迟到最后 0.8s（59.2–60s）。
同类问题还有：开场副标题落在标题上升路径上被撞、大问号压住副标题——都属于
**静态检查全过、抽帧才看得见**的版式冲突。这些时间窗/路径冲突已写进提示词。

**只在一小段时间里触发的运行时错误。** 生成的代码里 `iconY3` 变量名写错，
但该分支只在 56–58 秒执行。渲染跑到第 1681 帧才抛 `ReferenceError`，
前面 28 分钟的截图全部白做。现在 `render.js` 会在开始截图前**先扫一遍时间轴**
（每秒 4 帧，只调用 `renderFrame` 不截图），实测 2 秒内就能定位到 56.23s 的报错。

## 已知限制

- **渲染耗时随画面复杂度大幅波动**。同样是 900 帧 1920x1080，两次实测差 3.6 倍：

  | 渲染的 HTML | 逐帧截图耗时 | 单帧 | 全流程 |
  |---|---|---|---|
  | `examples/index.html`（手写演示，每帧绘制量大） | 475s | 0.53s | 11.5 分钟 |
  | `examples/index.generated.html`（AI 生成，8.2KB） | **133s** | **0.15s** | **3.1 分钟** |

  所以「30 秒视频要多久」没有固定答案，取决于 AI 写了多少绘制逻辑。
  同一份成片里，PNG → x264 编码只占约 15 秒（1.97x 实时），配音+混音+质检约 3 分钟。

  瓶颈**不在**编码，而在每帧的 `page.screenshot()`。走一遍链路要：
  浏览器内 PNG 编码 → base64 → Playwright IPC → Node 解码 → 写盘 → 事后 ffmpeg 再读回来解码。
  中间帧按每帧 1~3MB 估算，900 帧可能上 GB（节点3 会提前提示预估体积）。

  业界做法是**别让 PNG 和 base64 出现在链路上**：要么用 CDP screencast 直出 JPEG，
  要么在页面内用 WebCodecs 的 `VideoEncoder` 直接产出编码码流喂给 ffmpeg。
  后者更契合本项目——它同样是「按帧号确定性渲染」，不依赖实时播放。
  这是目前最值得做的优化，尚未实施。
- **只有 1920x1080**：竖屏 9:16 / 4:5 尚未支持，提示词里只做了安全区约束。
- **质检是信号级 + 像素级的**：`qa.js` 查编解码、分辨率、帧率、时长、音量、黑帧，
  用 `lib/layout.js` 每秒采样一帧检查内容是否被画面边缘裁切，并以 4fps 抽帧比较相邻帧，
  检测超过 4 秒的静止区段、前 3 秒视觉事件数；同时核对同名 `.ass` 的字幕与高亮数量。
  但它仍然 **查不出元素之间的重叠/遮挡**，也查不出语义错误（比如字写错了）——这些只能靠抽帧人看。
  满屏粒子、全屏过渡等故意出画的画面会被判为边缘裁切；有意的长定格（例如结尾金句停留）
  也可能被节奏检查列为“静止”，均属预期内提醒。
  节奏检查默认优先分析同目录的 `<标题>_silent.mp4`（烧录字幕后底部一直在变，会掩盖画面静止），
  旧版回退 `output/video_silent.mp4`，都不存在时改分析成片并裁掉底部 18% 的字幕区。
- **字幕时间轴是逐句的**，关键词弹跳时刻是比例估算，不是真实逐字时间戳；见上。
- **烧录会重新编码视频**：`--subs burn`（默认）多一次 x264 编码，约 15–30 秒；
  `--subs sidecar` 用 `-c:v copy`，更快但字幕不进画面。

## 第三方来源

`themes/themes.json` 直接导出自 [explainroo](https://github.com/vincentsch/explainroo)
（MIT），运镜与镜头语言的规范借鉴自其导演层。完整署名与「想抄但还没抄」的
清单见 [NOTICE.md](NOTICE.md)。
