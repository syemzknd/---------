import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FormGraphic } from "./forms";
import {
  DEFAULT_PALETTE,
  FONT,
  Palette,
  SceneElement,
  ScriptMeta,
  ScriptScene,
  ScriptVideoProps,
  clamp,
  clampNum,
  contrastParts,
  curveFn,
  easeInOutCubic,
  easeOutCubic,
  fmtNum,
  layoutBox,
  lerp,
  smootherstep,
  treeLabels,
} from "./types";

const KICKER_TYPES = new Set(["subtitle", "text", "caption", "digits", "counter"]);
const FORM_TYPES: Record<string, string> = {
  linechart: "折线图",
  cardgrid: "卡片矩阵",
  tree: "树状拆解",
  radar: "圆环雷达",
  timeline: "时间轴",
  spotlight: "聚焦镜头",
  compare: "对比轨道",
  progress: "进度条",
  countdown: "倒计时",
  blocks: "方块拆解",
  nodes: "节点推演",
  eye: "眼球特写",
  split: "对比分屏",
  flow: "流程分支",
  stack: "堆叠塔",
};
const FORM_ALIASES: Record<string, string[]> = {
  方块拆解: ["卡片矩阵"],
  节点推演: ["树状拆解"],
  眼球特写: ["聚焦镜头"],
  对比分屏: ["对比轨道"],
  流程分支: ["树状拆解"],
  堆叠塔: ["树状拆解"],
};
const ROLE_FORM: Record<string, string> = {
  钩子: "倒计时",
  共情: "折线图",
  拆解: "卡片矩阵",
  顿悟: "树状拆解",
  金句: "聚焦镜头",
};
const VALID_FORMS = new Set([
  "倒计时",
  "折线图",
  "卡片矩阵",
  "树状拆解",
  "圆环雷达",
  "时间轴",
  "聚焦镜头",
  "对比轨道",
  "进度条",
  "方块拆解",
  "节点推演",
  "眼球特写",
  "对比分屏",
  "流程分支",
  "堆叠塔",
]);

const formOf = (scene: ScriptScene) => {
  const f = String(scene.visual_form || "").trim();
  if (VALID_FORMS.has(f)) return f;
  return ROLE_FORM[String(scene.role || "")] || "聚焦镜头";
};

const dataOf = (scene: ScriptScene, form: string) => {
  const elements = scene.elements || [];
  for (const el of elements) {
    if (el && FORM_TYPES[String(el.type || "").toLowerCase()] === form) return el;
  }
  for (const alias of FORM_ALIASES[form] || []) {
    for (const el of elements) {
      if (el && FORM_TYPES[String(el.type || "").toLowerCase()] === alias) return el;
    }
  }
  return {};
};

const hasData = (
  form: string,
  data: Record<string, unknown>,
  meta: ScriptMeta | undefined,
  scene: ScriptScene,
) => {
  if (form === "聚焦镜头" || form === "眼球特写" || form === "进度条") return true;
  if (form === "倒计时") return Boolean(String(data.number ?? meta?.hook_number ?? "").trim());
  if (form === "折线图") return Array.isArray(data.points) && (data.points as unknown[]).length >= 2;
  if (form === "卡片矩阵") {
    return (Array.isArray(data.groups) && (data.groups as unknown[]).length >= 1) || contrastParts(meta).length >= 2;
  }
  if (form === "圆环雷达") return Array.isArray(data.rings) && (data.rings as unknown[]).length >= 2;
  if (form === "时间轴") {
    return (Array.isArray(data.milestones) && (data.milestones as unknown[]).length >= 2) ||
      treeLabels(scene, data, meta).length >= 2;
  }
  if (form === "树状拆解" || form === "节点推演" || form === "流程分支" || form === "堆叠塔") {
    return treeLabels(scene, data, meta).length >= 2;
  }
  if (form === "对比轨道" || form === "对比分屏") {
    return Boolean((data.left && data.right) || contrastParts(meta).length >= 2);
  }
  if (form === "方块拆解") {
    return (Array.isArray(data.groups) && (data.groups as unknown[]).length >= 1) ||
      (Array.isArray(data.parts) && (data.parts as unknown[]).length >= 1) ||
      contrastParts(meta).length >= 2;
  }
  return true;
};

const keywordOf = (scene: ScriptScene) => {
  const hl = scene.highlight?.[0];
  if (hl) return String(hl);
  const m = String(scene.narration || "").match(/\d+(?:\.\d+)?\s*[一-龥]{0,2}/);
  return m ? m[0].trim() : "";
};

const anchorOf = (scene: ScriptScene) => {
  const b = layoutBox(scene.layout);
  if (formOf(scene) === "树状拆解") return { x: b.cx - b.w * 0.14, y: b.cy };
  if (formOf(scene) === "倒计时") return { x: b.cx, y: b.cy - Math.min(b.h / 2, 290) };
  return { x: b.cx, y: b.cy };
};

const Background = ({
  palette,
  time,
  sceneStart,
  tint,
}: {
  palette: Palette;
  time: number;
  sceneStart: number;
  tint?: string;
}) => {
  const age = Math.max(0, time - sceneStart);
  const beat = Math.sin(Math.PI * clampNum(((age % 2.4) / 2.4) * 2.5, 0, 1));
  const breathe = 0.5 + 0.5 * Math.sin(time * 1.6);
  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.07) 1px, transparent 1px)",
          backgroundSize: "96px 96px",
          backgroundPosition: `0px ${time * 12}px`,
          opacity: 0.7,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 42%, ${tint || palette.primary}${Math.round(
            (0.11 + 0.04 * breathe + 0.025 * beat) * 255,
          )
            .toString(16)
            .padStart(2, "0")} 0%, transparent 62%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.66) 100%)",
        }}
      />
      <AbsoluteFill style={{ backgroundColor: palette.primary, opacity: 0.035 * beat }} />
    </AbsoluteFill>
  );
};

const Title = ({
  scene,
  palette,
  contentFrame,
  fps,
  golden,
  legacy,
}: {
  scene: ScriptScene;
  palette: Palette;
  contentFrame: number;
  fps: number;
  golden: boolean;
  legacy: boolean;
}) => {
  const title = (scene.elements || []).find((el) => String(el.type) === "title" && el.text);
  if (!title) return null;
  const at = Array.isArray(title.at) ? title.at : [scene.start, scene.end];
  const atFrame = Math.round((Number(at[0]) - scene.start) * fps);
  const bFrame = Math.round((Number(at[1]) - scene.start) * fps);
  const enter = spring({
    frame: contentFrame - atFrame,
    fps,
    config: { damping: 20, stiffness: 130, mass: 0.9 },
  });
  const exit =
    bFrame < Math.round((scene.end - scene.start) * fps)
      ? 1 - interpolate(contentFrame, [bFrame - Math.round(0.25 * fps), bFrame], [0, 1], clamp)
      : 1;
  const opacity = clampNum(enter, 0, 1) * clampNum(exit, 0, 1);
  if (opacity <= 0.001) return null;
  const size = clampNum((Number(title.size) || (golden ? 132 : 100)) * (golden ? 1.28 : 1), 72, 168);
  const color =
    /^#[0-9a-f]{6}$/i.test(String(title.color || "")) &&
    String(title.color).toLowerCase() !== "#ffffff"
      ? String(title.color)
      : palette.ink;
  const y = golden ? 500 : 135;
  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        right: 80,
        top: y,
        maxWidth: golden ? 1400 : 1560,
        marginLeft: "auto",
        marginRight: "auto",
        textAlign: "center",
        fontSize: size,
        fontWeight: 800,
        lineHeight: 1.12,
        letterSpacing: 1,
        color,
        fontFamily: FONT,
        opacity,
        transform: `translateY(${(1 - clampNum(enter, 0, 1)) * (legacy ? 26 : 42)}px) scale(${
          legacy ? 1 : 0.92 + 0.08 * clampNum(enter, 0, 1)
        })`,
        textShadow: `0 0 ${golden ? 28 : 14}px ${golden ? palette.primary : color}55`,
        whiteSpace: "pre-wrap",
        pointerEvents: "none",
      }}
    >
      {String(title.text)}
    </div>
  );
};

const Kicker = ({
  scene,
  palette,
  contentFrame,
  fps,
  legacy,
}: {
  scene: ScriptScene;
  palette: Palette;
  contentFrame: number;
  fps: number;
  legacy: boolean;
}) => {
  const absTime = scene.start + contentFrame / fps;
  let chosen: SceneElement | null = null;
  let chosenAt = -Infinity;
  for (const el of scene.elements || []) {
    if (!el || !KICKER_TYPES.has(String(el.type || ""))) continue;
    const at = Array.isArray(el.at) ? Number(el.at[0]) : NaN;
    if (!Number.isFinite(at) || at > absTime + 0.001) continue;
    if (at >= chosenAt) {
      chosen = el;
      chosenAt = at;
    }
  }
  if (!chosen) return null;
  const atFrame = Math.round((chosenAt - scene.start) * fps);
  const enter = spring({
    frame: contentFrame - atFrame,
    fps,
    config: { damping: 22, stiffness: 130, mass: 0.9 },
  });
  let text = String(chosen.text ?? chosen.label ?? "");
  const ty = String(chosen.type || "").toLowerCase();
  if ((ty === "digits" || ty === "counter") && chosen.value != null && Number.isFinite(Number(chosen.value))) {
    const u = easeOutCubic(clampNum((contentFrame - atFrame) / (1.1 * fps), 0, 1));
    text = `${chosen.label ? String(chosen.label) + " " : ""}${fmtNum(Number(chosen.value) * u)}${
      chosen.unit ? String(chosen.unit) : ""
    }`;
  }
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        right: 80,
        top: 222,
        textAlign: "center",
        fontSize: 40,
        fontWeight: 700,
        letterSpacing: 3,
        color: palette.muted,
        fontFamily: FONT,
        opacity: clampNum(enter, 0, 1) * 0.92,
        transform: `translateY(${(1 - clampNum(enter, 0, 1)) * (legacy ? 20 : 28)}px)`,
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  );
};

const Graphic = ({
  scene,
  palette,
  contentFrame,
  fps,
  golden,
}: {
  scene: ScriptScene;
  palette: Palette;
  contentFrame: number;
  fps: number;
  golden: boolean;
}) => {
  let form = formOf(scene);
  let data = dataOf(scene, form) as Record<string, unknown>;
  const meta = (scene as ScriptScene & { _meta?: ScriptMeta })._meta;
  if (!hasData(form, data, meta, scene)) {
    form = "聚焦镜头";
    data = dataOf(scene, form) as Record<string, unknown>;
  }
  if (form === "聚焦镜头" && !data.text) data = { ...data, text: keywordOf(scene) };
  const box = layoutBox(scene.layout);
  const firstBeat = scene.beats?.[0]?.t;
  const startSec = firstBeat != null
    ? clampNum(Number(firstBeat) - scene.start, 0, Math.max(0, scene.end - scene.start - 0.2))
    : 0.2;
  const startFrame = Math.round(startSec * fps);
  const spanFrames = Math.max(1, Math.round(Math.min(2.6, Math.max(1.2, (scene.end - scene.start) * 0.7)) * fps));
  const p = interpolate(contentFrame, [startFrame, startFrame + spanFrames], [0, 1], {
    ...clamp,
    easing: curveFn(scene.motion_curve),
  });
  return (
    <div style={{ position: "absolute", inset: 0, opacity: golden ? 0.14 : 1, pointerEvents: "none" }}>
      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <FormGraphic
          form={form}
          variant={String(scene.variant || "")}
          data={data}
          meta={meta}
          scene={scene}
          box={box}
          p={clampNum(p, 0, 1)}
          frame={contentFrame}
          fps={fps}
          palette={palette}
          golden={golden}
        />
      </svg>
    </div>
  );
};

const TransitionDecor = ({
  mode,
  p,
  anchor,
  prevAnchor,
  palette,
}: {
  mode: string;
  p: number;
  anchor: { x: number; y: number };
  prevAnchor: { x: number; y: number };
  palette: Palette;
}) => {
  if (p <= 0 || p >= 1) return null;
  const alpha = Math.sin(Math.PI * clampNum(p, 0, 1));
  const mx = lerp(prevAnchor.x, anchor.x, p);
  const my = lerp(prevAnchor.y, anchor.y, p);
  return (
    <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {mode === "图形形变" ? (
        <g opacity={alpha}>
          {Array.from({ length: 24 }).map((_, i) => {
            const t = i / 23;
            const x = lerp(prevAnchor.x, anchor.x, t) + Math.sin((i + p * 10) * 0.8) * 40;
            const y = lerp(prevAnchor.y, anchor.y, t) + Math.cos((i + p * 8) * 0.7) * 30;
            return <circle key={i} cx={x} cy={y} r={i % 5 === 0 ? 7 : 4} fill={i % 5 === 0 ? palette.ink : palette.primary} />;
          })}
        </g>
      ) : null}
      {mode === "知识树生长" ? (
        <g opacity={alpha}>
          {Array.from({ length: 6 }).map((_, i) => {
            const a = -Math.PI / 2 + (i - 2.5) * 0.55;
            const len = 190 * alpha;
            return (
              <line
                key={i}
                x1={mx}
                y1={my}
                x2={mx + Math.cos(a) * len}
                y2={my + Math.sin(a) * len}
                stroke={palette.primary}
                strokeWidth={4}
              />
            );
          })}
        </g>
      ) : null}
      {mode === "缩放推进" ? (
        <circle cx={anchor.x} cy={anchor.y} r={90 + 220 * p} fill="none" stroke={palette.primary} strokeWidth={5} opacity={alpha * 0.8} />
      ) : null}
      {mode === "擦除" || mode === "时间轴延伸" ? (
        <g opacity={alpha}>
          <line x1={mx} y1={0} x2={mx} y2={1080} stroke={palette.primary} strokeWidth={4} opacity={0.5} />
          <circle cx={mx} cy={my} r={14 + 24 * Math.sin(Math.PI * p)} fill={palette.primary} />
        </g>
      ) : null}
    </svg>
  );
};

const transitionStyle = (
  mode: string,
  p: number,
  index: number,
  anchor: { x: number; y: number },
  prevAnchor: { x: number; y: number },
  legacy: boolean,
): CSSProperties => {
  if (legacy) return { opacity: p };
  if (index === 0) return {};
  const style: CSSProperties = { willChange: "clip-path, transform, opacity" };
  const clipCircle = (x: number, y: number, radius: number) => `circle(${radius}% at ${x}px ${y}px)`;
  const m = String(mode || "擦除");
  if (m === "slide") {
    style.transform = `translateX(${(1 - p) * 100}%)`;
  } else if (m === "wipe") {
    style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
  } else if (m === "clockWipe") {
    style.maskImage = `conic-gradient(#000 ${p * 360}deg, transparent 0)`;
    (style as CSSProperties & { WebkitMaskImage?: string }).WebkitMaskImage =
      `conic-gradient(#000 ${p * 360}deg, transparent 0)`;
  } else if (m === "缩放推进") {
    style.transform = `scale(${1.6 - 0.6 * p})`;
    style.transformOrigin = `${anchor.x}px ${anchor.y}px`;
    style.clipPath = clipCircle(anchor.x, anchor.y, p * 150);
  } else if (m === "图形形变") {
    style.clipPath = clipCircle(lerp(prevAnchor.x, anchor.x, p), lerp(prevAnchor.y, anchor.y, p), p * 150);
  } else if (m === "时间轴延伸") {
    style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
  } else if (m === "知识树生长") {
    style.clipPath = clipCircle(anchor.x, anchor.y, p * 150);
  } else if (index % 2 === 0) {
    style.clipPath = clipCircle(anchor.x, anchor.y, p * 150);
  } else {
    style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
  }
  return style;
};

const SceneLayer = ({
  scene,
  prev,
  index,
  palette,
  meta,
  legacy,
}: {
  scene: ScriptScene;
  prev: ScriptScene | null;
  index: number;
  palette: Palette;
  meta?: ScriptMeta;
  legacy: boolean;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneDurFrames = Math.max(1, Math.round((scene.end - scene.start) * fps));
  const contentFrame = Math.min(frame, sceneDurFrames - 1);
  const trFrames = Math.max(1, Math.round(0.65 * fps));
  const p = index === 0 ? 1 : interpolate(frame, [0, trFrames], [0, 1], clamp);
  const anchor = anchorOf(scene);
  const prevAnchor = prev ? anchorOf(prev) : anchor;
  const styled = transitionStyle(String(scene.transition_in || ""), p, index, anchor, prevAnchor, legacy);
  const golden = String(scene.role || "") === "金句";
  const sceneWithMeta = { ...scene, _meta: meta } as ScriptScene & { _meta?: ScriptMeta };
  const sceneAge = contentFrame / fps;
  const beatU = (sceneAge % 2.4) / 2.4;
  const beatOn = !legacy && sceneAge > 0.15 && beatU < 0.32;
  const beatR = 80 + 320 * easeOutCubic(clampNum(beatU / 0.32, 0, 1));
  const driftX = legacy ? 0 : Math.sin(sceneAge * 0.9) * 12;
  const driftY = legacy ? 0 : Math.cos(sceneAge * 0.7) * 7;
  const push = legacy ? 1 : 1 + 0.02 * (contentFrame / Math.max(1, sceneDurFrames));
  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg, ...styled }}>
      <Background
        palette={palette}
        time={scene.start + contentFrame / fps}
        sceneStart={scene.start}
        tint={String(scene.role || "") === "钩子" ? palette.accent : undefined}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translate(${driftX}px, ${driftY}px) scale(${push})`,
          transformOrigin: "50% 50%",
        }}
      >
        <Graphic scene={sceneWithMeta} palette={palette} contentFrame={contentFrame} fps={fps} golden={golden} />
      </div>
      <Title scene={scene} palette={palette} contentFrame={contentFrame} fps={fps} golden={golden} legacy={legacy} />
      <Kicker scene={scene} palette={palette} contentFrame={contentFrame} fps={fps} legacy={legacy} />
      {beatOn ? (
        <svg
          viewBox="0 0 1920 1080"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <circle
            cx={anchor.x}
            cy={anchor.y}
            r={beatR}
            fill="none"
            stroke={palette.accent}
            strokeWidth={8}
            opacity={0.6 * (1 - beatU / 0.32)}
            style={{ filter: `drop-shadow(0 0 18px ${palette.accent})` }}
          />
        </svg>
      ) : null}
      {!legacy ? (
        <TransitionDecor
          mode={String(scene.transition_in || "")}
          p={p}
          anchor={anchor}
          prevAnchor={prevAnchor}
          palette={palette}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const Motif = ({ scenes, palette }: { scenes: ScriptScene[]; palette: Palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (!scenes.length) return null;
  let i = 0;
  for (let k = scenes.length - 1; k >= 0; k--) {
    if (t >= scenes[k].start - 1e-6) {
      i = k;
      break;
    }
  }
  const s = scenes[i];
  const nxt = scenes[i + 1];
  const a = anchorOf(s);
  const b = nxt ? anchorOf(nxt) : a;
  const win = 0.3;
  let k = 0;
  if (nxt && t > s.end - win) {
    k = smootherstep(clampNum((t - (s.end - win)) / (2 * win), 0, 1));
  }
  const x = lerp(a.x, b.x, k);
  const y = lerp(a.y, b.y, k);
  const color = palette.primary;
  return (
    <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 90 }}>
      {Array.from({ length: 8 }).map((_, j) => {
        const tt = Math.max(0, t - (j + 1) * 0.045);
        let ii = 0;
        for (let q = scenes.length - 1; q >= 0; q--) {
          if (tt >= scenes[q].start - 1e-6) {
            ii = q;
            break;
          }
        }
        const ss = scenes[ii];
        const nn = scenes[ii + 1];
        const aa = anchorOf(ss);
        const bb = nn ? anchorOf(nn) : aa;
        let kk = 0;
        if (nn && tt > ss.end - win) {
          kk = smootherstep(clampNum((tt - (ss.end - win)) / (2 * win), 0, 1));
        }
        const px = lerp(aa.x, bb.x, kk);
        const py = lerp(aa.y, bb.y, kk);
        return <line key={j} x1={x} y1={y} x2={px} y2={py} stroke={color} strokeWidth={8 * (1 - j / 10)} opacity={0.45 * (1 - j / 9)} />;
      })}
      <circle cx={x} cy={y} r={13} fill={color} style={{ filter: `drop-shadow(0 0 14px ${color})` }} />
    </svg>
  );
};

const Carry = ({ scenes, palette }: { scenes: ScriptScene[]; palette: Palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const rings = scenes.slice(1).map((scene, idx) => {
    const i = idx + 1;
    const start = scene.start;
    const p = (t - start) / 0.65;
    if (p <= 0 || p >= 1) return null;
    const prev = scenes[i - 1];
    const a = anchorOf(prev);
    const b = anchorOf(scene);
    const x = lerp(a.x, b.x, easeInOutCubic(p));
    const y = lerp(a.y, b.y, easeInOutCubic(p));
    const r = 26 + 34 * Math.sin(Math.PI * p);
    const alpha = clampNum(0.55 * (1 - Math.abs(p - 0.5) * 0.9), 0, 1);
    return (
      <g key={i} opacity={alpha}>
        <circle cx={x} cy={y} r={r} fill="none" stroke={palette.primary} strokeWidth={5} style={{ filter: `drop-shadow(0 0 12px ${palette.primary})` }} />
        <circle cx={x} cy={y} r={10} fill={palette.primary} />
      </g>
    );
  });
  return (
    <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 95 }}>
      {rings}
    </svg>
  );
};

export const ScriptVideo = ({ script, theme }: ScriptVideoProps) => {
  const { fps } = useVideoConfig();
  const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
  const meta = script?.meta;
  const palette: Palette = {
    ...DEFAULT_PALETTE,
    ...(theme?.palette || {}),
    ...(theme?.primary ? { primary: theme.primary } : {}),
    ...(theme?.bg ? { bg: theme.bg } : {}),
  };
  const legacy = Boolean(theme?.legacyMotion);
  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg, fontFamily: FONT }}>
      {scenes.map((scene, i) => {
        const from = Math.round(scene.start * fps);
        const dur = Math.max(1, Math.round((scene.end - scene.start) * fps));
        const tail = i < scenes.length - 1 ? Math.max(1, Math.round(0.65 * fps)) : 0;
        return (
          <Sequence
            key={scene.id || String(i)}
            from={from}
            durationInFrames={dur + tail}
            name={scene.id || String(i)}
          >
            <SceneLayer
              scene={scene}
              prev={i > 0 ? scenes[i - 1] : null}
              index={i}
              palette={palette}
              meta={meta}
              legacy={legacy}
            />
          </Sequence>
        );
      })}
      {!legacy ? <Motif scenes={scenes} palette={palette} /> : null}
      {!legacy ? <Carry scenes={scenes} palette={palette} /> : null}
    </AbsoluteFill>
  );
};
