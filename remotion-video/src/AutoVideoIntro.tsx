import React from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const CYAN = "#22d3ee";
const CYAN_LIGHT = "#a5f3fc";
const TEXT = "#f1f5f9";
const MUTED = "#8fa3bd";
const BG = "#06080f";
const FONT =
  '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';
const MONO = '"Cascadia Mono", "Consolas", "SFMono-Regular", monospace';

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;

  const particles = Array.from({ length: 28 }, (_, i) => {
    const x = (i * 137.5) % 1920;
    const baseY = (i * 83.7) % 1080;
    const y = (baseY + frame * (0.22 + (i % 5) * 0.1)) % 1080;
    const size = 1.5 + (i % 3);
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: size,
          height: size,
          borderRadius: "50%",
          backgroundColor: CYAN,
          opacity: 0.1 + (i % 4) * 0.05,
        }}
      />
    );
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.09) 1px, transparent 1px)",
          backgroundSize: "96px 96px",
          backgroundPosition: `0px ${t * 72}px`,
          maskImage:
            "radial-gradient(ellipse at 50% 45%, black 0%, transparent 72%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 50% 45%, black 0%, transparent 72%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1200,
          height: 1200,
          left: 360 + Math.sin(t * Math.PI * 2) * 90,
          top: -560,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(34,211,238,0.2) 0%, rgba(34,211,238,0) 62%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          left: -280,
          top: 600 + Math.cos(t * Math.PI * 2) * 70,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(59,130,246,0.13) 0%, rgba(59,130,246,0) 65%)",
        }}
      />
      {particles}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(6,8,15,0) 42%, rgba(6,8,15,0.84) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

const SceneIntro: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 8], [0, 1], clamp);
  const fadeOut = interpolate(
    frame,
    [duration - 16, duration - 6],
    [1, 0],
    clamp,
  );
  const kicker = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const line = interpolate(frame, [46, 86], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const subtitle = interpolate(frame, [58, 84], [0, 1], clamp);

  return (
    <AbsoluteFill
      style={{ opacity: fadeIn * fadeOut, fontFamily: FONT }}
    >
      <div
        style={{
          position: "absolute",
          top: 292,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          opacity: kicker,
          translate: `0px ${interpolate(kicker, [0, 1], [24, 0])}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "16px 34px",
            borderRadius: 999,
            border: "1px solid rgba(34,211,238,0.3)",
            backgroundColor: "rgba(34,211,238,0.06)",
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: CYAN,
              boxShadow: `0 0 18px ${CYAN}`,
            }}
          />
          <span
            style={{ fontSize: 30, letterSpacing: 8, color: CYAN_LIGHT }}
          >
            自动化产出简易视频
          </span>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 418,
          width: "100%",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", paddingBottom: 22 }}>
          {Array.from("一句话，一支视频").map((char, i) => {
            const pop = spring({
              frame: frame - 10 - i * 3,
              fps,
              config: { damping: 19, stiffness: 110, mass: 0.9 },
            });
            return (
              <span
                key={i}
                style={{ display: "inline-block", overflow: "hidden" }}
              >
                <span
                  style={{
                    display: "inline-block",
                    fontSize: 150,
                    fontWeight: 800,
                    color: TEXT,
                    letterSpacing: 2,
                    opacity: interpolate(pop, [0, 1], [0, 1]),
                    translate: `0px ${interpolate(pop, [0, 1], [160, 0])}px`,
                  }}
                >
                  {char}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 662,
          width: "100%",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            height: 4,
            width: line * 280,
            borderRadius: 999,
            backgroundColor: CYAN,
            boxShadow: `0 0 26px ${CYAN}`,
          }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          top: 716,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          opacity: subtitle,
          translate: `0px ${interpolate(subtitle, [0, 1], [20, 0])}px`,
        }}
      >
        <span style={{ fontSize: 42, color: MUTED, letterSpacing: 4 }}>
          AI 写脚本 · AI 画画面 · 代码合成成片
        </span>
      </div>
    </AbsoluteFill>
  );
};

const IconScript: React.FC = () => (
  <svg
    width="62"
    height="62"
    viewBox="0 0 64 64"
    fill="none"
    stroke={CYAN}
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 10h26l10 10v34H14z" />
    <path d="M40 10v10h10" />
    <path d="M22 30h20M22 40h20M22 50h12" />
  </svg>
);

const IconCode: React.FC = () => (
  <svg
    width="62"
    height="62"
    viewBox="0 0 64 64"
    fill="none"
    stroke={CYAN}
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M24 18 10 32l14 14M40 18l14 14-14 14M36 12l-8 40" />
  </svg>
);

const IconFilm: React.FC = () => (
  <svg
    width="62"
    height="62"
    viewBox="0 0 64 64"
    fill="none"
    stroke={CYAN}
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="8" y="14" width="48" height="36" rx="4" />
    <path d="M8 24h48M8 40h48M20 14v10M32 14v10M44 14v10M20 40v10M32 40v10M44 40v10" />
    <path d="m28 26 10 6-10 6z" />
  </svg>
);

const STEPS = [
  {
    num: "01",
    title: "写脚本",
    desc: "DeepSeek 拆解选题\n生成分镜与旁白",
    icon: <IconScript />,
  },
  {
    num: "02",
    title: "画画面",
    desc: "AI 生成 HTML\n逐帧绘制每一幕",
    icon: <IconCode />,
  },
  {
    num: "03",
    title: "合成片",
    desc: "Chromium 截图\nffmpeg 配音与字幕",
    icon: <IconFilm />,
  },
];

const ScenePipeline: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 8], [0, 1], clamp);
  const fadeOut = interpolate(
    frame,
    [duration - 16, duration - 6],
    [1, 0],
    clamp,
  );
  const heading = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const connector = interpolate(frame, [18, 76], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const caption = interpolate(frame, [92, 118], [0, 1], clamp);

  return (
    <AbsoluteFill
      style={{ opacity: fadeIn * fadeOut, fontFamily: FONT }}
    >
      <div
        style={{
          position: "absolute",
          top: 148,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          opacity: heading,
          translate: `0px ${interpolate(heading, [0, 1], [30, 0])}px`,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 26,
            letterSpacing: 10,
            color: CYAN,
          }}
        >
          WORKFLOW
        </span>
        <span
          style={{ fontSize: 96, fontWeight: 800, color: TEXT, letterSpacing: 2 }}
        >
          三步，自动成片
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          top: 594,
          left: 235,
          width: 1450,
          height: 2,
          background: `linear-gradient(90deg, rgba(34,211,238,0), rgba(34,211,238,0.55) ${20 + connector * 60}%, rgba(34,211,238,0.55) ${40 + connector * 60}%, rgba(34,211,238,0))`,
          opacity: connector,
        }}
      />

      {STEPS.map((step, i) => {
        const enter = spring({
          frame: frame - 24 - i * 14,
          fps,
          config: { damping: 22, stiffness: 120, mass: 0.9 },
        });
        const glow = 0.14 + 0.06 * Math.sin(frame / 16 + i * 1.4);
        return (
          <div
            key={step.num}
            style={{
              position: "absolute",
              left: 235 + i * 510,
              top: 360,
              width: 430,
              height: 468,
              borderRadius: 30,
              border: `1px solid rgba(34,211,238,${glow + 0.14})`,
              background:
                "linear-gradient(160deg, rgba(20,32,50,0.94), rgba(9,15,27,0.94))",
              boxShadow: "0 36px 90px rgba(0,0,0,0.45)",
              padding: 42,
              boxSizing: "border-box",
              opacity: enter,
              translate: `0px ${interpolate(enter, [0, 1], [90, 0])}px`,
              scale: interpolate(enter, [0, 1], [0.96, 1]),
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  width: 104,
                  height: 104,
                  borderRadius: 26,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(34,211,238,0.08)",
                  border: "1px solid rgba(34,211,238,0.22)",
                }}
              >
                {step.icon}
              </div>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 30,
                  color: "rgba(34,211,238,0.55)",
                  letterSpacing: 2,
                }}
              >
                {step.num}
              </span>
            </div>
            <div
              style={{
                marginTop: 46,
                fontSize: 62,
                fontWeight: 700,
                color: TEXT,
                letterSpacing: 2,
              }}
            >
              {step.title}
            </div>
            <div
              style={{
                marginTop: 22,
                fontSize: 36,
                lineHeight: 1.6,
                color: MUTED,
                whiteSpace: "pre-line",
              }}
            >
              {step.desc}
            </div>
          </div>
        );
      })}

      <div
        style={{
          position: "absolute",
          top: 904,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          opacity: caption,
          translate: `0px ${interpolate(caption, [0, 1], [16, 0])}px`,
        }}
      >
        <span style={{ fontSize: 38, color: "#64748b", letterSpacing: 3 }}>
          从脚本到成片，无需人工剪辑
        </span>
      </div>
    </AbsoluteFill>
  );
};

const CHIPS = ["脚本", "画面", "配音", "字幕"];

const SceneOutro: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 8], [0, 1], clamp);
  const fadeOut = interpolate(
    frame,
    [duration - 12, duration],
    [1, 0],
    clamp,
  );
  const lineOne = spring({ frame: frame - 5, fps, config: { damping: 200 } });
  const lineTwo = spring({
    frame: frame - 14,
    fps,
    config: { damping: 19, stiffness: 100, mass: 1 },
  });
  const progress = interpolate(frame, [40, 120], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.65, 0, 0.35, 1),
  });
  const percent = Math.round(progress * 100);
  const brand = interpolate(frame, [132, 158], [0, 1], clamp);

  return (
    <AbsoluteFill
      style={{ opacity: fadeIn * fadeOut, fontFamily: FONT }}
    >
      <div
        style={{
          position: "absolute",
          top: 186,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          opacity: lineOne,
          translate: `0px ${interpolate(lineOne, [0, 1], [24, 0])}px`,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 27,
            letterSpacing: 12,
            color: CYAN,
          }}
        >
          OUTPUT
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          top: 246,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          opacity: lineOne,
          translate: `0px ${interpolate(lineOne, [0, 1], [30, 0])}px`,
        }}
      >
        <span
          style={{ fontSize: 70, color: "#cbd5e1", letterSpacing: 4 }}
        >
          从选题到 MP4
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          top: 346,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          opacity: interpolate(lineTwo, [0, 1], [0, 1]),
          translate: `0px ${interpolate(lineTwo, [0, 1], [70, 0])}px`,
        }}
      >
        <span
          style={{
            fontSize: 168,
            fontWeight: 800,
            letterSpacing: 6,
            backgroundImage: `linear-gradient(92deg, ${CYAN} 0%, ${CYAN_LIGHT} 48%, ${CYAN} 100%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          全自动成片
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          top: 604,
          left: 460,
          width: 1000,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 16,
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: 26,
              letterSpacing: 7,
              color: "#64748b",
            }}
          >
            {percent === 100 ? "COMPLETE" : "RENDERING"}
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 44,
              color: percent === 100 ? CYAN_LIGHT : CYAN,
            }}
          >
            {percent}%
          </span>
        </div>
        <div
          style={{
            height: 12,
            borderRadius: 999,
            backgroundColor: "rgba(148,163,184,0.16)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: "100%",
              borderRadius: 999,
              background: `linear-gradient(90deg, ${CYAN}, ${CYAN_LIGHT})`,
              boxShadow: `0 0 26px ${CYAN}`,
            }}
          />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 742,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          gap: 26,
        }}
      >
        {CHIPS.map((chip, i) => {
          const lit = interpolate(
            frame,
            [78 + i * 16, 96 + i * 16],
            [0, 1],
            clamp,
          );
          return (
            <div
              key={chip}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "18px 36px",
                borderRadius: 999,
                fontSize: 36,
                color: lit > 0.5 ? TEXT : "#5b6b82",
                border: `1px solid rgba(34,211,238,${0.1 + lit * 0.4})`,
                backgroundColor: `rgba(34,211,238,${lit * 0.07})`,
                translate: `0px ${(1 - lit) * 14}px`,
              }}
            >
              <span style={{ color: CYAN, opacity: 0.25 + lit * 0.75 }}>✓</span>
              {chip}
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          top: 912,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          opacity: brand,
        }}
      >
        <span style={{ fontSize: 30, color: "#475569", letterSpacing: 8 }}>
          自动化产出简易视频
        </span>
      </div>
    </AbsoluteFill>
  );
};

export const AutoVideoIntro: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Background />
      <Sequence durationInFrames={165}>
        <SceneIntro duration={165} />
      </Sequence>
      <Sequence from={150} durationInFrames={210}>
        <ScenePipeline duration={210} />
      </Sequence>
      <Sequence from={345} durationInFrames={195}>
        <SceneOutro duration={195} />
      </Sequence>
    </AbsoluteFill>
  );
};
