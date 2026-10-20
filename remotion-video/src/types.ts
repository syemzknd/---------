export type Palette = {
  primary: string;
  accent: string;
  ink: string;
  muted: string;
  bg: string;
};

export type Box = { cx: number; cy: number; w: number; h: number };

export type SceneElement = {
  type?: string;
  text?: string;
  label?: string;
  sub?: string;
  at?: [number, number];
  color?: string;
  size?: number;
  focus?: boolean;
  occupancy?: number;
  spectacle?: boolean;
  pulse?: boolean;
  easing?: string;
  motion?: string;
  groups?: { label?: string; count?: number }[];
  parts?: { label?: string; value?: number }[];
  points?: number[];
  points2?: number[];
  unit?: string;
  trend?: string;
  x_labels?: string[];
  y_label?: string;
  nodes?: (string | { label?: string; text?: string })[];
  rings?: { label?: string; value?: number }[];
  milestones?: { label?: string; text?: string; at?: number }[];
  left?: { label?: string; value?: number; unit?: string };
  right?: { label?: string; value?: number; unit?: string };
  number?: string | number;
  from?: number;
  remaining?: number;
  values?: number[];
  steps?: (string | { label?: string; text?: string })[];
  value?: number;
  [key: string]: unknown;
};

export type Beat = { t: number; end?: number; text: string };

export type ScriptScene = {
  id?: string;
  role?: string;
  emotion?: string;
  start: number;
  end: number;
  narration?: string;
  visual_form?: string;
  variant?: string;
  layout?: string;
  entrance?: string;
  motion_curve?: string;
  transition_in?: string | null;
  highlight?: string[];
  elements?: SceneElement[];
  beats?: Beat[];
  [key: string]: unknown;
};

export type ScriptMeta = {
  title?: string;
  duration?: number;
  fps?: number;
  primary?: string;
  background?: string;
  palette?: string;
  hook_number?: string;
  law?: string;
  law_name?: string;
  contrast?: string;
  method_steps?: string[];
  golden_line?: string;
  [key: string]: unknown;
};

export type ScriptDoc = {
  meta?: ScriptMeta;
  scenes: ScriptScene[];
};

export type ScriptVideoProps = {
  fps?: number;
  width?: number;
  height?: number;
  duration?: number;
  script: ScriptDoc;
  theme?: {
    primary?: string;
    bg?: string;
    palette?: Partial<Palette>;
    legacyMotion?: boolean;
  };
  seed?: string;
};

export const DEFAULT_PALETTE: Palette = {
  primary: "#22d3ee",
  accent: "#ef4444",
  ink: "#f8fafc",
  muted: "#94a3b8",
  bg: "#06080f",
};

export const FONT =
  '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Microsoft JhengHei", system-ui, sans-serif';

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const clampNum = (v: number, a: number, b: number) =>
  Math.min(b, Math.max(a, v));

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clampNum(t, 0, 1), 3);
export const easeInOutCubic = (t: number) => {
  const x = clampNum(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOutBack = (t: number) => {
  const x = clampNum(t, 0, 1);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
export const smootherstep = (t: number) => {
  const x = clampNum(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

export const curveFn = (name?: string) => {
  switch (String(name || "")) {
    case "easeInOutCubic":
      return easeInOutCubic;
    case "easeOutBack":
      return easeOutBack;
    case "smootherstep":
      return smootherstep;
    default:
      return easeOutCubic;
  }
};

export const LAYOUTS: Record<string, Box> = {
  center: { cx: 960, cy: 530, w: 1560, h: 560 },
  left: { cx: 600, cy: 530, w: 980, h: 600 },
  right: { cx: 1320, cy: 530, w: 980, h: 600 },
  top: { cx: 960, cy: 440, w: 1500, h: 360 },
  bottom: { cx: 960, cy: 650, w: 1500, h: 360 },
  offset: { cx: 1140, cy: 500, w: 1200, h: 520 },
};

export const layoutBox = (layout?: string): Box =>
  LAYOUTS[String(layout || "center")] || LAYOUTS.center;

export const numbersIn = (value: unknown): number[] =>
  String(value == null ? "" : value)
    .match(/\d+(?:\.\d+)?/g)
    ?.map(Number) ?? [];

export const fmtNum = (v: number) =>
  Math.abs(v) >= 100 || Math.abs(v - Math.round(v)) < 0.05
    ? String(Math.round(v))
    : v.toFixed(1);

export const contrastParts = (meta?: ScriptMeta) => {
  const parts = String(meta?.contrast || "")
    .split(/\s*(?:vs\.?|VS|Vs|对比|versus|，而|；)\s*/i)
    .filter(Boolean);
  const out: { label: string; count: number }[] = [];
  for (const part of parts.slice(0, 3)) {
    const nums = numbersIn(part);
    if (!nums.length) continue;
    let label = part.replace(/\d+(?:\.\d+)?[\s\S]*$/, "");
    label = label
      .replace(/(每天|一天|每月|一个月|每年|一年|每次|一次|每周|一周)[\s\S]*$/, "")
      .replace(/[，,：:\s]+$/g, "")
      .slice(0, 8);
    if (label) out.push({ label, count: nums[0] });
  }
  return out.length >= 2 ? out : [];
};

export const treeLabels = (
  scene: ScriptScene,
  data: Record<string, unknown>,
  meta?: ScriptMeta,
) => {
  const raw = (data.nodes as unknown[]) || (data.steps as unknown[]) ||
    scene.elements?.find((e) => e.type === "tree")?.nodes ||
    meta?.method_steps ||
    [];
  return (raw as unknown[])
    .map((n) =>
      n && typeof n === "object"
        ? String((n as { label?: string; text?: string }).label ||
            (n as { text?: string }).text ||
            "")
        : String(n),
    )
    .filter(Boolean)
    .slice(0, 6);
};
