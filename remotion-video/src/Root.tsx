import { CalculateMetadataFunction, Composition } from "remotion";
import { AutoVideoIntro } from "./AutoVideoIntro";
import { ScriptVideo } from "./ScriptVideo";
import { ScriptVideoProps } from "./types";

const DEMO_PROPS: ScriptVideoProps = {
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 8,
  theme: {
    primary: "#22d3ee",
    bg: "#06080f",
    palette: {
      primary: "#22d3ee",
      accent: "#ef4444",
      ink: "#f8fafc",
      muted: "#94a3b8",
      bg: "#06080f",
    },
  },
  script: {
    meta: {
      title: "ScriptVideo",
      duration: 8,
      fps: 30,
      hook_number: "6个月",
      method_steps: ["第一步", "第二步", "第三步"],
      contrast: "A 10 vs B 2",
    },
    scenes: [
      {
        id: "demo-hook",
        role: "钩子",
        emotion: "焦虑",
        start: 0,
        end: 4,
        narration: "如果你只剩6个月，你还会这样过吗？",
        visual_form: "倒计时",
        variant: "dial",
        layout: "center",
        entrance: "scale",
        motion_curve: "easeOutCubic",
        elements: [
          { type: "title", text: "只剩 6 个月", at: [0, 4], size: 110, focus: true },
          { type: "countdown", number: "6", unit: "个月", label: "只剩", from: 12, at: [0, 4] },
        ],
      },
      {
        id: "demo-chart",
        role: "拆解",
        emotion: "拆解",
        start: 4,
        end: 8,
        narration: "时间越松，活儿越重。",
        visual_form: "折线图",
        variant: "area",
        layout: "center",
        entrance: "slide",
        motion_curve: "easeInOutCubic",
        transition_in: "擦除",
        elements: [
          { type: "title", text: "时间越松，活儿越重", at: [4, 8], size: 100, focus: true },
          { type: "linechart", points: [2, 4, 3, 6, 5], unit: "%", trend: "up", at: [4, 8], x_labels: ["开始", "结束"] },
        ],
      },
    ],
  },
};

const calculateMetadata: CalculateMetadataFunction<ScriptVideoProps> = ({ props }) => {
  const fps = Number(props.fps || props.script?.meta?.fps || 30);
  const duration = Number(props.duration || props.script?.meta?.duration || 30);
  return {
    fps,
    durationInFrames: Math.max(1, Math.round(duration * fps)),
    width: Number(props.width || 1920),
    height: Number(props.height || 1080),
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AutoVideoIntro"
        component={AutoVideoIntro}
        durationInFrames={540}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="ScriptVideo"
        component={ScriptVideo}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={DEMO_PROPS}
        calculateMetadata={calculateMetadata}
      />
    </>
  );
};
