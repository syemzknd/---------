'use strict';
/**
 * DeepSeek 调用（节点1、节点2 共用）。
 * 流式返回：长内容能实时看到进度，也能用停滞检测区分「还在写」和「连接已死」。
 */
const { fail } = require('./util');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-pro';

function loadApiKey() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || !key.trim()) {
    fail('未找到环境变量 DEEPSEEK_API_KEY。');
    console.error(`
请先设置 API Key 后重试：

  PowerShell（当前会话）:
    $env:DEEPSEEK_API_KEY = "sk-xxxxxxxx"

  PowerShell（永久，写入用户环境变量）:
    [Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY","sk-xxxxxxxx","User")

  cmd:
    set DEEPSEEK_API_KEY=sk-xxxxxxxx

  bash / Git Bash:
    export DEEPSEEK_API_KEY=sk-xxxxxxxx
`);
    process.exit(1);
  }
  return key.trim();
}

async function callDeepSeek({
  apiKey, baseUrl, model, systemPrompt, userPrompt,
  maxTokens, temperature, stallMs, responseFormat
}) {
  const ac = new AbortController();
  let stalled = false;
  let timer = null;

  const armStall = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      ac.abort();
    }, stallMs);
  };

  let content = '';
  let reasoning = '';
  let usage = null;
  let lastPaint = 0;

  const paint = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPaint < 500) return;
    lastPaint = now;
    const phase = content ? '生成中' : '思考中';
    process.stdout.write(
      `\r  ${phase}… 正文 ${content.length} 字符` +
      (reasoning ? `（推理 ${reasoning.length} 字符）` : '') + '   '
    );
  };

  armStall();

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: maxTokens,
    temperature,
    stream: true,
    stream_options: { include_usage: true }
  };
  if (responseFormat) body.response_format = responseFormat;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: ac.signal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    clearTimeout(timer);
    let hint = '';
    if (res.status === 401) hint = '\n  → API Key 无效或已过期，请检查 DEEPSEEK_API_KEY。';
    else if (res.status === 402) hint = '\n  → 账户余额不足。';
    else if (res.status === 404) hint = `\n  → 模型 "${model}" 不存在，可用：deepseek-v4-pro、deepseek-flash。`;
    else if (res.status === 400) hint = '\n  → 请求参数被拒绝，检查 DEEPSEEK_MODEL 是否为该账号可用模型。';
    throw new Error(`DeepSeek 返回 HTTP ${res.status}${hint}\n${text.slice(0, 800)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armStall();
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }

        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        if (delta) {
          if (delta.reasoning_content) reasoning += delta.reasoning_content;
          if (delta.content) content += delta.content;
        }
        if (chunk.usage) usage = chunk.usage;
        paint();
      }
    }
  } catch (err) {
    clearTimeout(timer);
    if (stalled) {
      throw new Error(
        `流式响应停滞超过 ${Math.round(stallMs / 1000)} 秒，已中断。` +
        `已收到正文 ${content.length} 字符。可重试，或用 DEEPSEEK_STALL_TIMEOUT 调大该阈值。`
      );
    }
    throw err;
  }

  clearTimeout(timer);
  paint(true);
  process.stdout.write('\n');
  return { content, reasoning, usage };
}

/** 从命令行参数/环境变量解析调用配置 */
function resolveOptions(args = {}, defaultMaxTokens = 8192) {
  return {
    apiKey: loadApiKey(),
    baseUrl: (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: args.model || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    maxTokens: Number(args['max-tokens'] || process.env.DEEPSEEK_MAX_TOKENS || defaultMaxTokens),
    temperature: args.temperature !== undefined ? Number(args.temperature) : 0.7,
    stallMs: Number(process.env.DEEPSEEK_STALL_TIMEOUT || 240) * 1000
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  loadApiKey,
  callDeepSeek,
  resolveOptions
};
