import { useId } from "react";
import {
  Box,
  FONT,
  Palette,
  ScriptMeta,
  ScriptScene,
  clampNum,
  contrastParts,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  fmtNum,
  lerp,
  numbersIn,
  treeLabels,
} from "./types";

export type FormGraphicProps = {
  form: string;
  variant: string;
  data: Record<string, unknown>;
  meta?: ScriptMeta;
  scene: ScriptScene;
  box: Box;
  p: number;
  frame: number;
  fps: number;
  palette: Palette;
  golden: boolean;
};

const glow = (color: string) => ({ filter: `drop-shadow(0 0 10px ${color})` });
const step = (p: number, delay: number) => clampNum((p - delay) / 0.6, 0, 1);

const SvgText = ({
  x,
  y,
  text,
  size = 28,
  color,
  weight = 700,
  anchor = "middle",
  opacity = 1,
  glowColor,
}: {
  x: number;
  y: number;
  text: string;
  size?: number;
  color: string;
  weight?: number;
  anchor?: "start" | "middle" | "end";
  opacity?: number;
  glowColor?: string;
}) => (
  <text
    x={x}
    y={y}
    fill={color}
    fontSize={size}
    fontWeight={weight}
    textAnchor={anchor}
    dominantBaseline="middle"
    fontFamily={FONT}
    opacity={opacity}
    style={glowColor ? glow(glowColor) : undefined}
  >
    {text}
  </text>
);

const RootPill = ({
  x,
  y,
  text,
  palette,
  q,
}: {
  x: number;
  y: number;
  text: string;
  palette: Palette;
  q: number;
}) => {
  const chars = Array.from(text);
  const lines =
    chars.length > 4
      ? [chars.slice(0, Math.ceil(chars.length / 2)).join(""), chars.slice(Math.ceil(chars.length / 2)).join("")]
      : [text];
  return (
    <g opacity={q}>
      <circle
        cx={x}
        cy={y}
        r={128}
        fill={`${palette.primary}20`}
        stroke={palette.primary}
        strokeWidth={6}
        style={glow(palette.primary)}
      />
      {lines.map((line, i) => (
        <SvgText
          key={i}
          x={x}
          y={y + (i - (lines.length - 1) / 2) * 54}
          text={line}
          size={46}
          color={palette.ink}
        />
      ))}
    </g>
  );
};

const pillWidth = (text: string) => Math.max(170, Math.min(560, text.length * 40 + 120));

const NodePill = ({
  x,
  y,
  text,
  index,
  palette,
  q,
  anchor = "middle",
}: {
  x: number;
  y: number;
  text: string;
  index: number;
  palette: Palette;
  q: number;
  anchor?: "start" | "middle" | "end";
}) => {
  const width = pillWidth(text);
  return (
    <g opacity={q} transform={`translate(${x} ${y})`}>
      <rect
        x={-width / 2}
        y={-43}
        width={width}
        height={86}
        rx={43}
        fill={`${palette.primary}18`}
        stroke={palette.primary}
        strokeWidth={4}
      />
      <circle cx={-width / 2 + 40} cy={0} r={26} fill={`${palette.primary}55`} />
      <SvgText
        x={-width / 2 + 40}
        y={2}
        text={String(index + 1)}
        size={30}
        color={palette.ink}
      />
      <SvgText
        x={-width / 2 + 80}
        y={2}
        text={text}
        size={44}
        color={palette.ink}
        anchor={anchor === "middle" ? "start" : anchor}
      />
    </g>
  );
};

export const FormGraphic = (props: FormGraphicProps) => {
  switch (props.form) {
    case "倒计时":
      return <Countdown {...props} />;
    case "折线图":
      return <LineChart {...props} />;
    case "卡片矩阵":
      return <CardGrid {...props} />;
    case "树状拆解":
      return <Tree {...props} />;
    case "圆环雷达":
      return <Radar {...props} />;
    case "时间轴":
      return <Timeline {...props} />;
    case "聚焦镜头":
      return <Spotlight {...props} />;
    case "对比轨道":
      return <Compare {...props} />;
    case "进度条":
      return <Progress {...props} />;
    case "方块拆解":
      return <Blocks {...props} />;
    case "节点推演":
      return <Nodes {...props} />;
    case "眼球特写":
      return <Eye {...props} />;
    case "对比分屏":
      return <Split {...props} />;
    case "流程分支":
      return <Flow {...props} />;
    case "堆叠塔":
      return <Stack {...props} />;
    default:
      return <Spotlight {...props} />;
  }
};

const Countdown = ({ data, meta, box, p, palette, variant }: FormGraphicProps) => {
  const raw = String(data.number ?? meta?.hook_number ?? data.value ?? "");
  const num = numbersIn(raw)[0];
  const unit = String(data.unit ?? raw.replace(/[\d.\s]+/g, "") ?? "");
  const label = String(data.label ?? "只剩");
  const from = Number(data.from ?? (num != null ? Math.max(num * 2, num + 6) : 12));
  const shown = num != null ? Math.round(lerp(from, num, easeOutCubic(p))) : 0;
  const shownText = num != null ? fmtNum(shown) : raw;
  const digits = shownText.length;
  const dialSize = digits >= 5 ? 110 : digits === 4 ? 140 : 190;
  const flipSize = digits >= 5 ? 112 : 168;
  const cx = box.cx;
  const cy = box.cy;
  const R = Math.min(box.h / 2, 290);
  if (variant === "flip") {
    const sy = 0.55 + 0.45 * clampNum(easeOutBack(p), 0, 1);
    return (
      <g>
        <g transform={`translate(${cx} ${cy}) scale(1 ${sy}) translate(${-cx} ${-cy})`}>
          <rect
            x={cx - Math.min(box.w * 0.28, 320)}
            y={cy - 180}
            width={Math.min(box.w * 0.56, 640)}
            height={360}
            rx={32}
            fill={`${palette.primary}12`}
            stroke={palette.primary}
            strokeWidth={5}
            style={glow(palette.primary)}
          />
          <SvgText x={cx} y={cy - 100} text={label} size={48} color={palette.muted} />
          <SvgText x={cx} y={cy + 20} text={shownText} size={flipSize} color={palette.ink} glowColor={palette.primary} />
          {unit ? <SvgText x={cx} y={cy + 128} text={unit} size={54} color={palette.primary} /> : null}
        </g>
      </g>
    );
  }
  if (variant === "hourglass") {
    const hw = Math.min(box.w * 0.4, 400);
    const hh = Math.min(box.h * 0.8, 480);
    const top = cy - hh / 2;
    const bot = cy + hh / 2;
    const sand = clampNum(p, 0, 1);
    return (
      <g>
        <polygon points={`${cx - hw / 2},${top} ${cx + hw / 2},${top} ${cx},${cy}`} fill={`${palette.primary}22`} stroke={palette.primary} strokeWidth={5} style={glow(palette.primary)} />
        <polygon points={`${cx - hw / 2},${bot} ${cx + hw / 2},${bot} ${cx},${cy}`} fill={`${palette.primary}10`} stroke={palette.primary} strokeWidth={5} />
        <line x1={cx} y1={cy + 8} x2={cx} y2={lerp(cy + 8, bot - 22, sand)} stroke={palette.accent} strokeWidth={5} />
        <SvgText x={cx} y={top - 48} text={label} size={46} color={palette.muted} />
        <SvgText x={cx} y={cy + 20} text={shownText} size={digits >= 5 ? 84 : 110} color={palette.ink} glowColor={palette.primary} />
        {unit ? <SvgText x={cx} y={bot + 46} text={unit} size={48} color={palette.primary} /> : null}
      </g>
    );
  }
  const remain = clampNum(Number(data.remaining) || 0.12, 0.04, 0.5);
  const frac = variant === "ring" ? 1 - (1 - remain) * p : 1 - (1 - remain) * p;
  const dash = 2 * Math.PI * (R - 4);
  const ringColor = p > 0.55 ? palette.accent : palette.primary;
  const tipAngle = -Math.PI / 2 + frac * Math.PI * 2;
  const ring = (
    <>
      <circle cx={cx} cy={cy} r={R - 4} fill="none" stroke={`${palette.ink}18`} strokeWidth={16} />
      <circle
        cx={cx}
        cy={cy}
        r={R - 4}
        fill="none"
        stroke={ringColor}
        strokeWidth={16}
        strokeLinecap="round"
        strokeDasharray={dash}
        strokeDashoffset={dash * (1 - frac)}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={glow(ringColor)}
      />
      <circle
        cx={cx + Math.cos(tipAngle) * (R - 4)}
        cy={cy + Math.sin(tipAngle) * (R - 4)}
        r={10}
        fill={palette.ink}
        style={glow(ringColor)}
      />
    </>
  );
  return (
    <g>
      {variant === "ring" ? null : (
        <g opacity={0.5}>
          {Array.from({ length: 60 }).map((_, i) => {
            const a = -Math.PI / 2 + (i / 60) * Math.PI * 2;
            const major = i % 5 === 0;
            const r0 = R + 14;
            const r1 = R + (major ? 34 : 24);
            return (
              <line
                key={i}
                x1={cx + Math.cos(a) * r0}
                y1={cy + Math.sin(a) * r0}
                x2={cx + Math.cos(a) * r1}
                y2={cy + Math.sin(a) * r1}
                stroke={palette.ink}
                strokeWidth={major ? 3 : 1.5}
                opacity={major ? 0.55 : 0.22}
              />
            );
          })}
        </g>
      )}
      {ring}
      <SvgText x={cx} y={cy - 150} text={label} size={54} color={palette.muted} />
      <SvgText x={cx} y={cy + 10} text={shownText} size={dialSize} color={p > 0.55 ? palette.accent : palette.ink} glowColor={ringColor} />
      {unit ? <SvgText x={cx} y={cy + 118} text={unit} size={54} color={palette.primary} /> : null}
    </g>
  );
};

const LineChart = ({ data, box, p, palette, variant }: FormGraphicProps) => {
  const pts = Array.isArray(data.points) ? (data.points as unknown[]).map(Number).filter(Number.isFinite) : [];
  if (pts.length < 2) return null;
  const x0 = box.cx - box.w / 2 + 100;
  const x1 = box.cx + box.w / 2 - 70;
  const y0 = box.cy + box.h / 2 - 60;
  const y1 = box.cy - box.h / 2 + 80;
  const lo = Math.min(0, ...pts);
  const hi = Math.max(...pts) * 1.12 || 1;
  const X = (i: number) => lerp(x0, x1, i / (pts.length - 1));
  const Y = (v: number) => lerp(y0, y1, (v - lo) / (hi - lo || 1));
  const down = data.trend === "down" || (data.trend !== "up" && pts[pts.length - 1] < pts[0]);
  const color = down ? palette.accent : palette.primary;
  const points = pts.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const stepPoints = pts
    .map((v, i) => (i === 0 ? `${X(i)},${Y(v)}` : `${X(i)},${Y(pts[i - 1])} ${X(i)},${Y(v)}`))
    .join(" ");
  const unit = String(data.unit || "");
  const endV = pts[pts.length - 1];
  return (
    <g>
      {Array.from({ length: 5 }).map((_, i) => {
        const y = lerp(y0, y1, i / 4);
        return <line key={i} x1={x0} y1={y} x2={x1} y2={y} stroke={palette.ink} strokeWidth={1.5} opacity={0.09 * p} />;
      })}
      <polyline points={`${x0},${y1 - 20} ${x0},${y0} ${x1 + 30},${y0}`} fill="none" stroke={`${palette.ink}70`} strokeWidth={3} />
      {variant === "bars" ? (
        <g>
          {pts.map((v, i) => {
            const q = step(p, i * 0.08);
            const bw = (x1 - x0) / pts.length * 0.58;
            const h = Math.max(2, (y0 - Y(v)) * q);
            return (
              <g key={i}>
                <rect x={X(i) - bw / 2} y={y0 - h} width={bw} height={h} rx={8} fill={color} opacity={0.82} />
                <SvgText x={X(i)} y={y0 - h - 26} text={fmtNum(v)} size={28} color={palette.ink} opacity={q} />
              </g>
            );
          })}
        </g>
      ) : (
        <g>
          {variant === "area" ? (
            <polygon points={`${X(0)},${y0} ${points} ${X(pts.length - 1)},${y0}`} fill={`${color}33`} opacity={p} />
          ) : null}
          {variant === "dual" ? (
            <polyline
              points={Array.isArray(data.points2) ? (data.points2 as number[]).map((v, i) => `${X(i)},${Y(v)}`).join(" ") : `${x0},${Y(hi * 0.55)} ${x1},${Y(hi * 0.55)}`}
              fill="none"
              stroke={palette.muted}
              strokeWidth={4}
              strokeDasharray="14 12"
              opacity={0.6}
            />
          ) : null}
          <polyline
            points={variant === "step" ? stepPoints : points}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={1 - p}
            style={glow(color)}
          />
          <circle cx={X(pts.length - 1)} cy={Y(endV)} r={15} fill={color} style={glow(color)} opacity={p} />
          <SvgText x={X(pts.length - 1)} y={Y(endV) - 54} text={`${fmtNum(endV)}${unit}`} size={58} color={palette.ink} glowColor={color} opacity={p} />
        </g>
      )}
      {Array.isArray(data.x_labels) ? (
        <g>
          <SvgText x={x0} y={y0 + 40} text={String(data.x_labels[0] || "")} size={28} color={palette.muted} />
          <SvgText x={x1} y={y0 + 40} text={String(data.x_labels[1] || "")} size={28} color={palette.muted} />
        </g>
      ) : null}
      {data.y_label ? <SvgText x={x0 + 70} y={y1 - 26} text={String(data.y_label)} size={28} color={palette.muted} anchor="start" /> : null}
    </g>
  );
};

const CardGrid = ({ data, meta, box, p, palette, variant }: FormGraphicProps) => {
  let groups = Array.isArray(data.groups)
    ? (data.groups as { label?: string; count?: number }[]).filter((g) => g && Number.isFinite(Number(g.count)))
    : [];
  if (!groups.length) groups = contrastParts(meta);
  if (!groups.length) return null;
  const prepared: { label: string; count: number }[] = groups.slice(0, 3).map((g) => ({
    label: String(g.label || ""),
    count: clampNum(Math.round(Number(g.count)), 1, 60),
  }));
  const maxC = Math.max(...prepared.map((g) => g.count));
  const gap = 70;
  const regionW = (box.w - gap * (prepared.length - 1)) / prepared.length;
  const gridH = box.h - 190;
  const layoutFor = (count: number) => {
    let bestCell = 0;
    let bestCols = 1;
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const cell = Math.min(regionW / cols, gridH / rows);
      if (cell > bestCell) {
        bestCell = cell;
        bestCols = cols;
      }
    }
    return { cell: Math.min(bestCell, 220), cols: bestCols };
  };
  const top = box.cy - box.h / 2 + 28;
  return (
    <g>
      {prepared.map((g, gi) => {
        const regionX = box.cx - box.w / 2 + gi * (regionW + gap);
        const { cell, cols: colsK } = layoutFor(g.count);
        const cw = cell * 0.84;
        const ch = cw / 1.32;
        const gx0 = regionX + (regionW - colsK * cell) / 2;
        const color = gi === 0 ? palette.primary : gi === 1 ? palette.ink : palette.accent;
        return (
          <g key={gi}>
            {Array.from({ length: g.count }).map((_, j) => {
              const q = step(p, (j / Math.max(1, maxC)) * 0.55);
              if (q <= 0) return null;
              const bx = gx0 + (j % colsK) * cell + cell / 2;
              const by = top + Math.floor(j / colsK) * (ch + (cell - cw)) + ch / 2;
              let transform = "";
              if (variant === "flip") transform = `translate(${bx} ${by}) scale(${Math.max(0.05, easeOutBack(q))} 1) translate(${-bx} ${-by})`;
              else if (variant === "rain") transform = `translate(0 ${-(1 - easeOutBack(q)) * 220})`;
              else if (variant === "wave") transform = `translate(0 ${-(1 - easeOutCubic(q)) * 50 + Math.sin((j + gi * 3) * 0.55) * 8})`;
              return (
                <g key={j} opacity={q} transform={transform}>
                  <rect x={bx - cw / 2} y={by - ch / 2} width={cw} height={ch} rx={cw * 0.12} fill={`${color}22`} stroke={color} strokeWidth={Math.max(1.5, cw * 0.03)} />
                  <line x1={bx - cw * 0.26} y1={by - ch * 0.08} x2={bx + cw * 0.26} y2={by - ch * 0.08} stroke={color} strokeWidth={2} opacity={0.6} />
                  <line x1={bx - cw * 0.26} y1={by + ch * 0.16} x2={bx + cw * 0.1} y2={by + ch * 0.16} stroke={color} strokeWidth={2} opacity={0.45} />
                </g>
              );
            })}
            <SvgText x={regionX + regionW / 2} y={box.cy + box.h / 2 - 92} text={String(Math.round(g.count * easeOutCubic(p)))} size={92} color={color} glowColor={color} />
            <SvgText x={regionX + regionW / 2} y={box.cy + box.h / 2 - 30} text={g.label} size={32} color={palette.muted} />
          </g>
        );
      })}
    </g>
  );
};

const Tree = ({ data, meta, scene, box, p, palette, variant }: FormGraphicProps) => {
  const nodes = treeLabels(scene, data, meta);
  if (!nodes.length) return null;
  const n = nodes.length;
  const root = String(data.root || meta?.law_name || "计划");
  const rootQ = clampNum(p / 0.25, 0, 1);
  const positions: { x: number; y: number }[] = [];
  let rootX = box.cx - box.w * 0.32;
  let rootY = box.cy;
  if (variant === "vertical") {
    rootX = box.cx;
    rootY = box.cy - box.h * 0.34;
    nodes.forEach((_, i) => {
      const gap = Math.min(280, box.w / (n + 0.5));
      positions.push({ x: box.cx - ((n - 1) * gap) / 2 + i * gap, y: box.cy + box.h * 0.24 });
    });
  } else if (variant === "radial") {
    rootX = box.cx;
    rootY = box.cy;
    const radius = Math.min(box.w, box.h) * 0.36;
    nodes.forEach((_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
      positions.push({ x: box.cx + Math.cos(a) * radius, y: box.cy + Math.sin(a) * radius });
    });
  } else if (variant === "cascade") {
    rootX = box.cx - box.w * 0.34;
    rootY = box.cy - box.h * 0.3;
    nodes.forEach((_, i) => {
      positions.push({ x: box.cx - box.w * 0.18 + i * box.w * 0.16, y: box.cy - box.h * 0.18 + i * box.h * 0.14 });
    });
  } else {
    const rowH = Math.min(124, (box.h - 30) / n);
    nodes.forEach((_, i) => {
      positions.push({ x: box.cx + box.w * 0.04, y: box.cy + (i - (n - 1) / 2) * rowH });
    });
  }
  return (
    <g>
      <RootPill x={rootX} y={rootY} text={root} palette={palette} q={rootQ} />
      {nodes.map((label, i) => {
        const q = step(p, 0.12 + i * 0.08);
        const pos = positions[i];
        const angle = Math.atan2(pos.y - rootY, pos.x - rootX);
        return (
          <g key={i}>
            <line
              x1={rootX + Math.cos(angle) * 128}
              y1={rootY + Math.sin(angle) * 128}
              x2={pos.x - pillWidth(label) / 2}
              y2={pos.y}
              stroke={palette.primary}
              strokeWidth={4}
              opacity={q * 0.7}
            />
            <NodePill x={pos.x} y={pos.y} text={label} index={i} palette={palette} q={q} />
          </g>
        );
      })}
    </g>
  );
};

const Radar = ({ data, box, p, palette, variant }: FormGraphicProps) => {
  const rings = Array.isArray(data.rings)
    ? (data.rings as { label?: string; value?: number }[]).filter((r) => r && Number.isFinite(Number(r.value)))
    : [];
  if (rings.length < 2) return null;
  const n = Math.min(5, rings.length);
  const R = Math.min(box.h / 2, 260);
  const cx = box.cx - box.w * 0.15;
  const cy = box.cy;
  const items = rings.slice(0, n).map((r) => ({
    label: String(r.label || ""),
    value: clampNum(Number(r.value) > 1 ? Number(r.value) / 100 : Number(r.value), 0, 1),
  }));
  if (variant === "polygon") {
    const pts = items.map((r, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
      return `${cx + Math.cos(a) * R * r.value * p},${cy + Math.sin(a) * R * r.value * p}`;
    });
    return (
      <g>
        {items.map((r, i) => {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={cx + Math.cos(a) * R} y2={cy + Math.sin(a) * R} stroke={`${palette.ink}30`} strokeWidth={2} />
              <SvgText x={cx + Math.cos(a) * (R + 60)} y={cy + Math.sin(a) * (R + 60)} text={r.label} size={28} color={palette.ink} />
            </g>
          );
        })}
        <polygon points={pts.join(" ")} fill={`${palette.primary}33`} stroke={palette.primary} strokeWidth={5} style={glow(palette.primary)} />
      </g>
    );
  }
  const gapR = Math.min(66, R / (n + 0.6));
  return (
    <g>
      {items.map((r, i) => {
        const rad = R - i * gapR;
        const color = r.value < 0.3 ? palette.accent : palette.primary;
        const dash = 2 * Math.PI * rad;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={rad} fill="none" stroke={`${palette.ink}18`} strokeWidth={16} />
            <circle
              cx={cx}
              cy={cy}
              r={rad}
              fill="none"
              stroke={color}
              strokeWidth={16}
              strokeLinecap="round"
              strokeDasharray={variant === "dashed" ? "14 12" : dash}
              strokeDashoffset={variant === "dashed" ? 0 : dash * (1 - r.value * p)}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={glow(color)}
            />
            {variant === "dual" ? (
              <circle cx={cx} cy={cy} r={rad + 12} fill="none" stroke={color} strokeWidth={5} opacity={0.45} strokeDasharray={dash} strokeDashoffset={dash * (1 - r.value * p)} transform={`rotate(-90 ${cx} ${cy})`} />
            ) : null}
            <circle cx={box.cx + box.w * 0.1} cy={box.cy + (i - (n - 1) / 2) * 90} r={10} fill={color} />
            <SvgText x={box.cx + box.w * 0.14} y={box.cy + (i - (n - 1) / 2) * 90} text={r.label} size={28} color={palette.ink} anchor="start" />
            <SvgText x={box.cx + box.w * 0.43} y={box.cy + (i - (n - 1) / 2) * 90} text={`${Math.round(r.value * 100 * p)}%`} size={34} color={color} anchor="end" />
          </g>
        );
      })}
    </g>
  );
};

const Timeline = ({ data, meta, scene, box, p, palette, variant }: FormGraphicProps) => {
  const raw = Array.isArray(data.milestones) ? (data.milestones as { label?: string; text?: string }[]) : [];
  let labels = raw.map((m) => String(m.label || m.text || "")).filter(Boolean);
  if (labels.length < 2) labels = treeLabels(scene, data, meta);
  if (labels.length < 2) return null;
  const n = labels.length;
  if (variant === "vertical") {
    const x = box.cx;
    const y0 = box.cy - box.h / 2 + 30;
    const y1 = box.cy + box.h / 2 - 30;
    return (
      <g>
        <line x1={x} y1={y0} x2={x} y2={y1} stroke={`${palette.ink}30`} strokeWidth={5} />
        {labels.map((label, i) => {
          const q = step(p, i * 0.08);
          const y = lerp(y0, y1, i / (n - 1));
          const left = i % 2 === 0;
          return (
            <g key={i} opacity={q}>
              <circle cx={x} cy={y} r={16} fill={palette.bg} stroke={i === n - 1 ? palette.accent : palette.primary} strokeWidth={5} />
              <SvgText x={x + (left ? -34 : 34)} y={y} text={label} size={30} color={palette.ink} anchor={left ? "end" : "start"} />
            </g>
          );
        })}
      </g>
    );
  }
  const x0 = box.cx - box.w / 2 + 80;
  const x1 = box.cx + box.w / 2 - 80;
  const head = lerp(x0, x1, p);
  const zig = variant === "zigzag";
  const points = labels.map((_, i) => ({
    x: lerp(x0, x1, i / (n - 1)),
    y: box.cy + (zig ? (i % 2 ? 60 : -60) : 0),
  }));
  return (
    <g>
      <polyline
        points={points.map((q) => `${q.x},${q.y}`).join(" ")}
        fill="none"
        stroke={`${palette.ink}35`}
        strokeWidth={variant === "dots" ? 3 : 5}
        strokeDasharray={variant === "dots" ? "2 16" : undefined}
      />
      <line x1={x0} y1={points[0].y} x2={head} y2={points[0].y} stroke={palette.primary} strokeWidth={5} opacity={0.3} />
      {labels.map((label, i) => {
        const q = step(p, i * 0.08);
        const point = points[i];
        if (point.x > head + 6) return null;
        return (
          <g key={i} opacity={q}>
            <circle cx={point.x} cy={point.y} r={14} fill={palette.bg} stroke={i === n - 1 ? palette.accent : palette.primary} strokeWidth={5} />
            <SvgText x={point.x} y={point.y + (zig ? (i % 2 ? 72 : -72) : -68)} text={label} size={26} color={palette.ink} />
          </g>
        );
      })}
      <circle cx={head} cy={box.cy} r={12} fill={palette.primary} style={glow(palette.primary)} />
    </g>
  );
};

const Spotlight = ({ data, scene, box, p, palette, golden, variant, frame, fps }: FormGraphicProps) => {
  const uid = useId().replace(/:/g, "");
  const text = String(data.text || data.target || scene.highlight?.[0] || "");
  const r = lerp(620, 220, easeInOutCubic(p));
  if (variant === "vignette") {
    return (
      <g>
        <defs>
          <radialGradient id={`vig-${uid}`}>
            <stop offset="0%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.82)" />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={1920} height={1080} fill={`url(#vig-${uid})`} />
        <circle cx={box.cx} cy={box.cy} r={330} fill={`${palette.primary}12`} />
        {!golden && text ? <SvgText x={box.cx} y={box.cy} text={text} size={112} color={palette.ink} glowColor={palette.primary} /> : null}
      </g>
    );
  }
  const scan = variant === "scan" ? box.cy + Math.sin((frame / fps) * 2) * r * 0.8 : null;
  return (
    <g>
      <defs>
        <radialGradient id={`iris-${uid}`}>
          <stop offset="0%" stopColor={`${palette.primary}22`} />
          <stop offset="70%" stopColor={`${palette.primary}08`} />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>
      <circle cx={box.cx} cy={box.cy} r={r} fill={`url(#iris-${uid})`} />
      <circle cx={box.cx} cy={box.cy} r={r} fill="none" stroke={palette.primary} strokeWidth={6} style={glow(palette.primary)} />
      <line x1={box.cx - r - 50} y1={box.cy} x2={box.cx - r + 20} y2={box.cy} stroke={palette.ink} strokeWidth={2} opacity={0.6} />
      <line x1={box.cx + r - 20} y1={box.cy} x2={box.cx + r + 50} y2={box.cy} stroke={palette.ink} strokeWidth={2} opacity={0.6} />
      <line x1={box.cx} y1={box.cy - r - 50} x2={box.cx} y2={box.cy - r + 20} stroke={palette.ink} strokeWidth={2} opacity={0.6} />
      <line x1={box.cx} y1={box.cy + r - 20} x2={box.cx} y2={box.cy + r + 50} stroke={palette.ink} strokeWidth={2} opacity={0.6} />
      {variant === "lens" ? (
        <g>
          <circle cx={box.cx} cy={box.cy} r={r * 1.12} fill="none" stroke={`${palette.accent}cc`} strokeWidth={4} strokeDasharray="18 14" />
          {Array.from({ length: 16 }).map((_, i) => {
            const a = (i * Math.PI) / 8;
            return (
              <line
                key={i}
                x1={box.cx + Math.cos(a) * r * 1.14}
                y1={box.cy + Math.sin(a) * r * 1.14}
                x2={box.cx + Math.cos(a) * r * 1.2}
                y2={box.cy + Math.sin(a) * r * 1.2}
                stroke={palette.ink}
                strokeWidth={2}
                opacity={0.35}
              />
            );
          })}
        </g>
      ) : null}
      {scan != null ? (
        <line x1={box.cx - r} y1={scan} x2={box.cx + r} y2={scan} stroke={palette.accent} strokeWidth={4} style={glow(palette.accent)} />
      ) : null}
      {!golden && text ? (
        <SvgText x={box.cx} y={box.cy + (variant === "scan" ? 0 : 0)} text={text} size={112} color={palette.ink} glowColor={palette.primary} />
      ) : null}
    </g>
  );
};

const Compare = ({ data, meta, box, p, palette, variant }: FormGraphicProps) => {
  const cp = contrastParts(meta);
  const L = { label: String((data.left as { label?: string })?.label || cp[0]?.label || ""), value: Number((data.left as { value?: number })?.value ?? cp[0]?.count ?? 0), unit: String((data.left as { unit?: string })?.unit || "") };
  const R = { label: String((data.right as { label?: string })?.label || cp[1]?.label || ""), value: Number((data.right as { value?: number })?.value ?? cp[1]?.count ?? 0), unit: String((data.right as { unit?: string })?.unit || "") };
  if (!L.label && !R.label) return null;
  const big = Math.max(L.value, R.value, 1);
  const q = easeOutCubic(p);
  if (variant === "split") {
    const pw = (box.w - 40) / 2;
    const ph = box.h * 0.62;
    return (
      <g>
        {[
          { x: box.cx - pw / 2 - 20, item: L, color: palette.primary },
          { x: box.cx + pw / 2 + 20, item: R, color: palette.ink },
        ].map(({ x, item, color }, i) => (
          <g key={i} opacity={q}>
            <rect x={x - pw / 2} y={box.cy - ph / 2} width={pw} height={ph} rx={26} fill={`${color}18`} stroke={`${color}b0`} strokeWidth={4} />
            <SvgText x={x} y={box.cy - ph * 0.2} text={item.label} size={30} color={palette.muted} />
            <SvgText x={x} y={box.cy + ph * 0.12} text={`${fmtNum(item.value * q)}${item.unit}`} size={92} color={color} glowColor={color} />
          </g>
        ))}
      </g>
    );
  }
  if (variant === "bars" || variant === "mirror") {
    const base = box.cy + box.h * 0.28;
    const maxH = box.h * 0.55;
    const bw = Math.min(140, box.w * 0.16);
    return (
      <g>
        {[
          { x: variant === "mirror" ? box.cx - 120 : box.cx - box.w * 0.2, item: L, color: palette.primary },
          { x: variant === "mirror" ? box.cx + 120 : box.cx + box.w * 0.2, item: R, color: palette.ink },
        ].map(({ x, item, color }, i) => {
          const h = Math.max(6, (item.value / big) * maxH * q);
          return (
            <g key={i}>
              <rect x={x - bw / 2} y={base - h} width={bw} height={h} rx={16} fill={color} opacity={0.82} />
              <SvgText x={x} y={base - h - 36} text={`${fmtNum(item.value * q)}${item.unit}`} size={48} color={color} glowColor={color} />
              <SvgText x={x} y={base + 40} text={item.label} size={28} color={palette.muted} />
            </g>
          );
        })}
      </g>
    );
  }
  const x0 = box.cx - box.w / 2 + 280;
  const x1 = box.cx + box.w / 2 - 160;
  return (
    <g>
      {[
        { y: box.cy - 110, item: L, color: palette.primary },
        { y: box.cy + 110, item: R, color: palette.ink },
      ].map(({ y, item, color }, i) => {
        const w = (x1 - x0) * (item.value / big) * q;
        return (
          <g key={i}>
            <line x1={x0} y1={y} x2={x1} y2={y} stroke={`${palette.ink}25`} strokeWidth={5} />
            <line x1={x0} y1={y} x2={x0 + w} y2={y} stroke={color} strokeWidth={12} strokeLinecap="round" style={glow(color)} />
            <circle cx={x0 + w} cy={y} r={14} fill={color} style={glow(color)} />
            <SvgText x={x0 - 24} y={y} text={item.label} size={30} color={palette.ink} anchor="end" />
            <SvgText x={x0 + w} y={y - 46} text={`${fmtNum(item.value * q)}${item.unit}`} size={44} color={color} glowColor={color} />
          </g>
        );
      })}
    </g>
  );
};

const Progress = ({ data, box, p, palette, variant }: FormGraphicProps) => {
  const from = clampNum(Number(data.from ?? 1), 0, 1);
  const to = clampNum(Number(data.to ?? 0.12), 0, 1);
  const v = lerp(from, to, easeOutCubic(p));
  const color = v < 0.4 ? palette.accent : palette.primary;
  const pct = `${Math.round(v * 100)}%`;
  if (variant === "ring") {
    const R = Math.min(box.h / 2, 220);
    const dash = 2 * Math.PI * R;
    return (
      <g>
        <circle cx={box.cx} cy={box.cy} r={R} fill="none" stroke={`${palette.ink}20`} strokeWidth={24} />
        <circle cx={box.cx} cy={box.cy} r={R} fill="none" stroke={color} strokeWidth={24} strokeLinecap="round" strokeDasharray={dash} strokeDashoffset={dash * (1 - v)} transform={`rotate(-90 ${box.cx} ${box.cy})`} style={glow(color)} />
        <SvgText x={box.cx} y={box.cy + 6} text={pct} size={96} color={palette.ink} glowColor={color} />
      </g>
    );
  }
  if (variant === "segments") {
    const count = 24;
    const bw = box.w * 0.82;
    const gap = 8;
    const segW = (bw - gap * (count - 1)) / count;
    const x0 = box.cx - bw / 2;
    return (
      <g>
        {Array.from({ length: count }).map((_, i) => (
          <rect key={i} x={x0 + i * (segW + gap)} y={box.cy - 32} width={segW} height={64} rx={8} fill={i / count < v ? color : `${palette.ink}18`} opacity={0.9} />
        ))}
        <SvgText x={box.cx} y={box.cy - 94} text={pct} size={92} color={palette.ink} glowColor={color} />
      </g>
    );
  }
  if (variant === "fill") {
    const bw = Math.min(box.w * 0.3, 420);
    const bh = box.h * 0.7;
    const x = box.cx - bw / 2;
    const y = box.cy - bh / 2;
    return (
      <g>
        <rect x={x} y={y} width={bw} height={bh} rx={24} fill={`${palette.ink}12`} stroke={`${palette.ink}30`} strokeWidth={3} />
        <rect x={x + 8} y={y + bh - 8 - (bh - 16) * v} width={bw - 16} height={(bh - 16) * v} rx={16} fill={color} opacity={0.8} />
        <SvgText x={box.cx} y={box.cy} text={pct} size={86} color={palette.ink} glowColor={color} />
      </g>
    );
  }
  const bw = box.w * 0.82;
  const bh = 64;
  const x0 = box.cx - bw / 2;
  return (
    <g>
      <rect x={x0} y={box.cy - bh / 2} width={bw} height={bh} rx={bh / 2} fill={`${palette.ink}18`} />
      <rect x={x0} y={box.cy - bh / 2} width={Math.max(bh, bw * v)} height={bh} rx={bh / 2} fill={color} style={glow(color)} />
      <SvgText x={box.cx} y={box.cy - 100} text={pct} size={92} color={palette.ink} glowColor={color} />
    </g>
  );
};

const Blocks = ({ data, meta, box, p, palette, variant }: FormGraphicProps) => {
  let groups = Array.isArray(data.groups)
    ? (data.groups as { label?: string; count?: number }[]).filter((g) => g && Number.isFinite(Number(g.count)))
    : [];
  if (!groups.length && Array.isArray(data.parts)) {
    groups = (data.parts as { label?: string; value?: number }[]).map((g) => ({ label: g.label, count: g.value }));
  }
  if (!groups.length) groups = contrastParts(meta);
  if (!groups.length) return null;
  const gs = groups.slice(0, 3).map((g) => ({ label: String(g.label || ""), count: clampNum(Math.round(Number(g.count)), 1, 36) }));
  const maxC = Math.max(...gs.map((g) => g.count));
  const cols = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(maxC * 1.6))));
  const cell = Math.min(box.w / (gs.length * cols + 1), box.h / (cols + 1), 86);
  return (
    <g>
      {gs.map((g, gi) => {
        const regionW = box.w / gs.length;
        const rx = box.cx - box.w / 2 + gi * regionW + (regionW - cols * cell) / 2;
        const rows = Math.ceil(g.count / cols);
        const ry = box.cy - (rows * cell) / 2;
        const color = gi === 0 ? palette.primary : gi === 1 ? palette.ink : palette.accent;
        return (
          <g key={gi}>
            {Array.from({ length: g.count }).map((_, j) => {
              const q = step(p, (j / Math.max(1, gs.reduce((a, b) => a + b.count, 0))) * 0.4);
              const bx = rx + (j % cols) * cell + cell / 2;
              const by = ry + Math.floor(j / cols) * cell + cell / 2;
              let transform = "";
              if (variant === "explode") {
                const dx = (bx - box.cx) * 0.55 * q;
                const dy = (by - box.cy) * 0.55 * q;
                transform = `translate(${dx} ${dy})`;
              } else if (variant === "cascade") transform = `translate(0 ${-(1 - easeOutBack(q)) * 220})`;
              else if (variant === "stack") transform = `translate(0 ${(1 - easeOutCubic(q)) * 160})`;
              return (
                <g key={j} opacity={q} transform={transform}>
                  <rect x={bx - cell * 0.4} y={by - cell * 0.4} width={cell * 0.8} height={cell * 0.8} rx={6} fill={`${color}22`} stroke={color} strokeWidth={2.5} />
                </g>
              );
            })}
            <SvgText x={rx + regionW / 2} y={box.cy + box.h / 2 - 50} text={String(Math.round(g.count * easeOutCubic(p)))} size={54} color={color} glowColor={color} />
            <SvgText x={rx + regionW / 2} y={box.cy + box.h / 2 - 6} text={g.label} size={26} color={palette.muted} />
          </g>
        );
      })}
    </g>
  );
};

const Nodes = ({ data, meta, scene, box, p, palette, variant, frame, fps }: FormGraphicProps) => {
  const labels = treeLabels(scene, data, meta);
  if (!labels.length) return null;
  const n = labels.length;
  const center = { x: box.cx, y: box.cy };
  const positions = labels.map((_, i) => {
    if (variant === "chain" || variant === "pipeline") {
      const gap = Math.min(200, box.w / (n + 1));
      return { x: box.cx - ((n - 1) * gap) / 2 + i * gap, y: box.cy };
    }
    if (variant === "tree") {
      return { x: box.cx - box.w * 0.08 + (i % 2) * box.w * 0.22, y: box.cy - ((n - 1) * 76) / 2 + i * 76 };
    }
    const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
    const rad = Math.min(box.w, box.h) * 0.34;
    return { x: box.cx + Math.cos(a) * rad, y: box.cy + Math.sin(a) * rad };
  });
  return (
    <g>
      <circle cx={center.x} cy={center.y} r={62 * clampNum(p / 0.25, 0, 1)} fill={`${palette.primary}22`} stroke={palette.primary} strokeWidth={5} style={glow(palette.primary)} />
      <SvgText x={center.x} y={center.y} text="起点" size={30} color={palette.ink} />
      {variant === "pulse"
        ? Array.from({ length: 3 }).map((_, k) => {
            const rr = 62 + (((frame / fps) * 60 + k * 55) % 190);
            return <circle key={k} cx={center.x} cy={center.y} r={rr} fill="none" stroke={palette.primary} strokeWidth={3} opacity={clampNum(1 - rr / 250, 0, 1) * 0.45} />;
          })
        : null}
      {labels.map((label, i) => {
        const q = step(p, i * 0.08);
        const pos = positions[i];
        return (
          <g key={i} opacity={q}>
            <line x1={center.x} y1={center.y} x2={pos.x} y2={pos.y} stroke={`${palette.primary}b0`} strokeWidth={3} />
            <circle cx={pos.x} cy={pos.y} r={44} fill={`${palette.ink}12`} stroke={palette.primary} strokeWidth={3.5} />
            <circle cx={pos.x} cy={pos.y} r={8} fill={palette.accent} />
            <SvgText x={pos.x} y={pos.y + 66} text={label} size={26} color={palette.ink} />
          </g>
        );
      })}
    </g>
  );
};

const Eye = ({ data, scene, box, p, palette, variant, frame, fps, golden }: FormGraphicProps) => {
  const uid = useId().replace(/:/g, "");
  const text = String(data.text || data.target || scene.highlight?.[0] || "");
  const ew = Math.min(box.w * 0.62, 850);
  const eh = Math.min(box.h * 0.55, 400);
  const blink = variant === "blink" ? Math.abs(Math.cos(Math.PI * clampNum(p, 0, 1))) : 1;
  const eyeH = Math.max(2, eh * blink);
  const R = Math.min(eyeH * 0.52, eh * 0.45);
  const ir = variant === "zoom" ? R * (0.55 + 0.45 * p) : R;
  const scan = variant === "scan" ? box.cy + Math.sin((frame / fps) * 2) * eyeH * 0.32 : null;
  return (
    <g>
      <defs>
        <radialGradient id={`eye-${uid}`}>
          <stop offset="0%" stopColor="#06080f" />
          <stop offset="45%" stopColor={palette.primary} />
          <stop offset="100%" stopColor={`${palette.primary}22`} />
        </radialGradient>
      </defs>
      <ellipse cx={box.cx} cy={box.cy} rx={ew / 2} ry={eyeH / 2} fill={`${palette.ink}08`} stroke={`${palette.ink}70`} strokeWidth={5} />
      <circle cx={box.cx} cy={box.cy} r={Math.max(1, ir * p)} fill={`url(#eye-${uid})`} />
      <circle cx={box.cx} cy={box.cy} r={Math.max(1, ir * 0.36)} fill="#06080f" />
      <circle cx={box.cx - ir * 0.25} cy={box.cy - ir * 0.28} r={Math.max(1, ir * 0.12)} fill={`${palette.ink}dd`} />
      {scan != null ? <line x1={box.cx - ew / 2} y1={scan} x2={box.cx + ew / 2} y2={scan} stroke={palette.accent} strokeWidth={4} style={glow(palette.accent)} /> : null}
      {!golden && text ? <SvgText x={box.cx} y={box.cy + eh / 2 + 58} text={text} size={54} color={palette.ink} glowColor={palette.primary} /> : null}
    </g>
  );
};

const Split = ({ data, meta, box, p, palette, variant }: FormGraphicProps) => {
  const cp = contrastParts(meta);
  const L = { label: String((data.left as { label?: string })?.label || cp[0]?.label || ""), value: Number((data.left as { value?: number })?.value ?? cp[0]?.count ?? 0) };
  const R = { label: String((data.right as { label?: string })?.label || cp[1]?.label || ""), value: Number((data.right as { value?: number })?.value ?? cp[1]?.count ?? 0) };
  if (!L.label && !R.label) return null;
  const q = easeOutCubic(p);
  if (variant === "bars") {
    const base = box.cy + box.h * 0.28;
    const maxH = box.h * 0.55;
    const big = Math.max(L.value, R.value, 1);
    return (
      <g>
        {[
          { x: box.cx - box.w * 0.2, item: L, color: palette.primary },
          { x: box.cx + box.w * 0.2, item: R, color: palette.accent },
        ].map(({ x, item, color }, i) => {
          const h = Math.max(6, (item.value / big) * maxH * q);
          return (
            <g key={i}>
              <rect x={x - 70} y={base - h} width={140} height={h} rx={16} fill={color} opacity={0.82} />
              <SvgText x={x} y={base - h - 36} text={fmtNum(item.value * q)} size={48} color={color} glowColor={color} />
              <SvgText x={x} y={base + 40} text={item.label} size={28} color={palette.muted} />
            </g>
          );
        })}
      </g>
    );
  }
  const horizontal = variant === "horizontal";
  const panels = horizontal
    ? [
        { x: box.cx, y: box.cy - box.h * 0.24, w: box.w, h: box.h * 0.4 },
        { x: box.cx, y: box.cy + box.h * 0.24, w: box.w, h: box.h * 0.4 },
      ]
    : [
        { x: box.cx - box.w * 0.24, y: box.cy, w: box.w * 0.46, h: box.h * 0.62 },
        { x: box.cx + box.w * 0.24, y: box.cy, w: box.w * 0.46, h: box.h * 0.62 },
      ];
  return (
    <g>
      {[
        { item: L, color: palette.primary, panel: panels[0] },
        { item: R, color: palette.accent, panel: panels[1] },
      ].map(({ item, color, panel }, i) => (
        <g key={i} opacity={q}>
          <rect x={panel.x - panel.w / 2} y={panel.y - panel.h / 2} width={panel.w} height={panel.h} rx={24} fill={`${color}16`} stroke={`${color}b0`} strokeWidth={4} />
          <SvgText x={panel.x} y={panel.y - panel.h * 0.2} text={item.label} size={30} color={palette.muted} />
          <SvgText x={panel.x} y={panel.y + panel.h * 0.12} text={fmtNum(item.value * q)} size={92} color={color} glowColor={color} />
        </g>
      ))}
      {variant === "diagonal" ? <line x1={box.cx - box.w * 0.5} y1={box.cy + box.h * 0.3} x2={box.cx + box.w * 0.5} y2={box.cy - box.h * 0.3} stroke={palette.accent} strokeWidth={5} opacity={0.8} /> : null}
    </g>
  );
};

const Flow = ({ data, meta, scene, box, p, palette, variant }: FormGraphicProps) => {
  const labels = treeLabels(scene, data, meta);
  if (labels.length < 2) return null;
  const n = labels.length;
  const points = labels.map((_, i) => {
    if (variant === "pipeline" || variant === "zigzag") {
      const gap = Math.min(190, box.w / (n + 1));
      return { x: box.cx - ((n - 1) * gap) / 2 + i * gap, y: box.cy + (variant === "zigzag" && i % 2 ? 72 : -72) };
    }
    if (variant === "loop") {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
      return { x: box.cx + Math.cos(a) * Math.min(box.w, box.h) * 0.34, y: box.cy + Math.sin(a) * Math.min(box.w, box.h) * 0.34 };
    }
    const gap = Math.min(180, box.w / (n + 1));
    return { x: box.cx - ((n - 1) * gap) / 2 + i * gap, y: box.cy + (i % 2 ? 72 : -72) };
  });
  return (
    <g>
      <polyline points={points.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={`${palette.primary}b0`} strokeWidth={4} />
      {labels.map((label, i) => {
        const q = step(p, i * 0.08);
        const pos = points[i];
        return (
          <g key={i} opacity={q}>
            <circle cx={pos.x} cy={pos.y} r={44} fill={`${palette.ink}12`} stroke={i === Math.floor(p * (n - 1)) ? palette.accent : palette.primary} strokeWidth={4} />
            <SvgText x={pos.x} y={pos.y + 2} text={String(i + 1)} size={24} color={palette.ink} />
            <SvgText x={pos.x} y={pos.y + 66} text={label} size={24} color={palette.ink} />
          </g>
        );
      })}
    </g>
  );
};

const Stack = ({ data, meta, scene, box, p, palette, variant }: FormGraphicProps) => {
  const labels = treeLabels(scene, data, meta);
  const values = Array.isArray(data.values) ? (data.values as unknown[]).map(Number).filter(Number.isFinite) : [];
  if (!labels.length && !values.length) return null;
  const n = Math.max(labels.length, values.length, 2);
  const maxV = Math.max(1, ...values);
  const bw = Math.min(box.w * 0.58, 540);
  const bh = Math.min(60, (box.h * 0.62) / n);
  const base = box.cy + box.h * 0.28;
  return (
    <g>
      {Array.from({ length: n }).map((_, i) => {
        const q = step(p, i * 0.08);
        if (q <= 0) return null;
        const val = values[i];
        let x = box.cx - bw / 2;
        let w = bw;
        let y = base - i * bh;
        let h = bh * 0.86;
        if (variant === "stairs") {
          x = box.cx - bw / 2 + i * (box.w * 0.05);
          w = bw * 0.6;
        } else if (variant === "pyramid") {
          const shrink = (i / n) * 0.5;
          x = box.cx - (bw * (1 - shrink)) / 2;
          w = bw * (1 - shrink);
        } else if (variant === "columns") {
          const cw = Math.min(100, (box.w * 0.8) / n);
          x = box.cx - (n * cw) / 2 + i * cw;
          w = cw * 0.7;
          h = val != null ? Math.max(10, (val / maxV) * box.h * 0.55) : bh * 0.86;
          y = base - h;
        }
        const color = i % 2 ? palette.accent : palette.primary;
        return (
          <g key={i} opacity={q}>
            <rect x={x} y={y} width={w} height={h} rx={Math.min(16, h * 0.25)} fill={`${color}33`} stroke={color} strokeWidth={3} />
            <SvgText x={x + w / 2} y={y + h / 2} text={labels[i] || (val != null ? fmtNum(val) : "")} size={Math.min(28, h * 0.5)} color={palette.ink} />
          </g>
        );
      })}
    </g>
  );
};
