# 第三方来源与署名

本项目自研渲染管线，但**刻意抄袭**了部分成熟开源项目的成果，特此署名。

## hyperframes（heygen-com）

- 仓库：https://github.com/heygen-com/hyperframes
- 许可：未核实（本项目**未复制其代码**，仅采用公开描述的算法思路）

`lib/layout.js` 的「边缘窄带 + 亮度陡变检测」思路来自其 PR #4427
（`feat(cli): warn when canvas content touches the frame edge`）。
核心论断是：DOM 层面的布局检查看不到 canvas 里画了什么，
「标题被切成半截」这类问题只能靠读真实像素发现。本项目独立实现，
零额外依赖（ffmpeg 解 raw rgb24，Node 直接分析字节）。

## explainroo

- 仓库：https://github.com/vincentsch/explainroo
- 作者：Vincent Schmalbach
- 许可：MIT（副本见 `themes/LICENSE-explainroo.txt`）

### 抄袭了什么

| 本项目文件 | 来源 | 说明 |
|---|---|---|
| `themes/themes.json` | `engine/themes.js` | **直接导出**。6 套视觉风格（paper / clean / chalk / blueprint / midnight / editorial）的完整设计令牌：配色、语义色、描边参数、入场动画、转场、代码高亮、终端与字幕配色。 |
| `prompts/node2-prompt.md` 的「风格令牌」节 | `engine/director.js`、`engine/runtime.js` | **思路借鉴**。运镜（镜头跟随旁白推进、结尾拉远）、运动模糊、安全区避让、缓动与入场动画的规范。 |
| `lib/subtitle.js` | explainroo 的字幕产物 | **思路借鉴**。导出 `.srt` / `.vtt` 供平台直接上传。实现不同：explainroo 用 Whisper 做逐字对齐，本项目直接取 edge-tts 的逐句边界（零额外依赖，代价是精确到句而非逐字）。具体源文件名未核实，故不列。 |

### 想抄但还没抄的

| 能力 | 来源 | 状态 |
|---|---|---|
> 下表的「来源」只写到能力层面，未核实 explainroo 的具体文件名，故不杜撰路径。

| 能力 | 状态 |
|---|---|
| 布局自检（文字被裁切） | **已实现**（`lib/layout.js`），但技术方案不是抄 explainroo 的，见下节。 |
| 语音错读自检（TTS 读音与文案不符） | **未实现**。需要 ASR 回环比对，本项目尚无 ASR 依赖。 |
| 逐字字幕对齐 | **未实现**。见上表 `lib/subtitle.js` 说明。 |
| 多尺寸输出（16:9 / 9:16 / 4:5） | **未实现**。目前固定 1920x1080。 |

### 没抄什么

`engine/stage.js`（100KB，整个场景绘制 API）**没有抄**。抄它等于换引擎，而不是自研。
本项目保留了「AI 写 HTML 渲染器 → Playwright 逐帧截图 → ffmpeg 合成」的自研路线。

### 字体说明

`themes.json` 中的 `fonts` 字段指向 explainroo 自带的字体（Kalam / Patrick Hand /
JetBrains Mono）。本项目渲染器**不引入任何外部字体文件**，因此
`lib/theme.js` 在注入提示词时会把字体角色改写为系统字体栈，只沿用其配色与动效令牌。
