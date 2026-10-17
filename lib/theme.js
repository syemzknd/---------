'use strict';
/**
 * 风格包：把 explainroo 的设计令牌注入节点2 的提示词。
 *
 * 令牌来源见 NOTICE.md。这里做两件事：
 *   1) 去掉本项目用不上的字段（sfx —— 我们没有音效管线）
 *   2) 把字体角色改写成系统字体栈（渲染器不允许依赖外部字体文件）
 */
const fs = require('fs');
const path = require('path');

const THEMES_FILE = path.resolve(__dirname, '..', 'themes', 'themes.json');

// explainroo 自带 Kalam / Patrick Hand / JetBrains Mono；我们改用系统栈
const FONT_STACK = {
  display: '700 {size}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  body: '{size}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  hand: '{size}px "Segoe Print", "Comic Sans MS", system-ui, sans-serif',
  mono: '{size}px ui-monospace, Menlo, Consolas, monospace'
};

const FONT_ROLE_CN = {
  display: '大标题',
  body: '正文',
  hand: '手写体（可选）',
  mono: '等宽（代码/数字）'
};

let cache = null;

function loadThemes() {
  if (!cache) cache = JSON.parse(fs.readFileSync(THEMES_FILE, 'utf8'));
  return cache;
}

function themeNames() {
  return Object.keys(loadThemes());
}

function getTheme(name) {
  const all = loadThemes();
  const key = String(name || '').toLowerCase();
  if (!all[key]) {
    throw new Error(`未知风格 "${name}"。可用：${Object.keys(all).join('、')}`);
  }
  return all[key];
}

function kv(obj) {
  return Object.entries(obj)
    .map(([k, v]) => (v === null ? `${k}=无` : `${k}=${v}`))
    .join('，');
}

/** 生成注入系统提示词的「风格令牌」文本块 */
function themeBlock(name) {
  const t = getTheme(name);
  const L = [];

  L.push('## 视觉风格令牌（强制遵守，禁止自行发明配色）');
  L.push('');
  L.push(`风格：**${t.name}**${t.dark ? '（深色）' : '（浅色）'}`);
  L.push('');
  L.push('### 基础色');
  L.push(`- 背景 bg：${t.bg}`);
  L.push(`- 主文字 ink：${t.ink}`);
  L.push(`- 次要文字 muted：${t.muted}`);
  L.push(`- 卡片/面板 surface：${t.surface}`);
  L.push(`- 首选强调色 accent：${t.accent}（取其语义色值）`);
  L.push(`- 语义色板：${kv(t.colors)}`);
  L.push(`- 圆角 radius：${t.radius}px`);
  L.push(`- 淡色调强度 tintStrength：${t.tintStrength}`);
  if (t.shadow) L.push(`- 阴影：${kv(t.shadow)}`);
  else L.push('- 阴影：无（扁平风格）');

  L.push('');
  L.push('### 线条');
  if (t.stroke && t.stroke.rough) {
    L.push(
      `- 手绘风：开启。roughness=${t.stroke.roughness}，bowing=${t.stroke.bowing}，` +
      `线宽=${t.stroke.width}，填充方式=${t.stroke.fillStyle}` +
      (t.stroke.hachureGap ? `，排线间距=${t.stroke.hachureGap}` : '') +
      '。用确定性的伪随机抖动模拟手绘，不要真的用 Math.random()。'
    );
    if (t.stroke.texture) L.push(`- 纹理：${t.stroke.texture}`);
  } else {
    L.push(`- 手绘风：关闭。干净直线，线宽=${t.stroke ? t.stroke.width : 3}`);
    if (t.stroke && t.stroke.glow) L.push(`- 发光：${t.stroke.glow}px 外发光`);
  }

  L.push('');
  L.push('### 入场动画（元素类型 → 动画）');
  L.push(kv(t.enter));
  L.push(`- 场景转场：${t.transition}`);

  L.push('');
  L.push('### 代码块配色');
  L.push(kv(t.code));

  L.push('');
  L.push('### 终端配色');
  L.push(kv(t.terminal));

  L.push('');
  L.push('### 字幕配色（仅供节点4 生成 ASS 字幕参考；渲染器禁止在画面里画任何字幕）');
  L.push(kv(t.caption));

  L.push('');
  L.push('### 字体（只能用系统字体栈，禁止引入字体文件或 CDN）');
  for (const [role, stack] of Object.entries(FONT_STACK)) {
    const src = t.fonts && t.fonts[role] ? t.fonts[role] : null;
    L.push(`- ${role}（${FONT_ROLE_CN[role]}）：\`${stack}\`${src ? `　← 原风格为 ${src.family}，已替换为系统栈` : ''}`);
  }

  L.push('');
  L.push('### 使用要求');
  L.push('1. 上述色值必须原样使用，不要替换成近似色，也不要新增未列出的颜色。');
  L.push('   **唯一例外**：冲突/高潮的警示红 `#ef4444` 允许使用，但仅限情绪峰值与脉冲光晕，红色面积不超过画面 20%。');
  L.push('2. 需要区分层级时，用 tintStrength 把语义色与背景混合（混出淡色底），而不是引入新色。');
  L.push('3. 入场动画按上表逐元素类型执行；缓动按项目规则：入场 easeOutBack，位移/转场 easeInOutCubic，数据增长 easeOutCubic，禁止 linear。');
  L.push('4. 文字必须留出安全边距：左右不小于 120px，上下不小于 80px，底部 160px 留给节点4 的字幕；任何文字不得被画布边缘裁切。');

  return L.join('\n');
}

module.exports = { loadThemes, themeNames, getTheme, themeBlock, THEMES_FILE };
