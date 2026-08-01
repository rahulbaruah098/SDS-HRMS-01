import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const INITIAL_SIZE = {
  width: 1200,
  height: 720,
};

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function buildFrameGeometry(width, height) {
  const safeWidth = Math.max(width, 280);
  const safeHeight = Math.max(height, 420);

  const inset = clamp(safeWidth * 0.018, 9, 24);
  const cornerRadius = clamp(safeWidth * 0.032, 16, 38);
  const notchLift = clamp(safeWidth * 0.014, 8, 18);
  const notchWidth = clamp(
    safeWidth * (safeWidth <= 720 ? 0.42 : 0.26),
    132,
    340,
  );
  const notchRadius = clamp(notchLift * 0.72, 6, 13);

  const baseTop = inset + notchLift;
  const capTop = inset;
  const centerX = safeWidth / 2;
  const notchLeft = centerX - notchWidth / 2;
  const notchRight = centerX + notchWidth / 2;
  const right = safeWidth - inset;
  const bottom = safeHeight - inset;

  const path = [
    `M ${inset} ${baseTop + cornerRadius}`,
    `Q ${inset} ${baseTop} ${inset + cornerRadius} ${baseTop}`,
    `H ${notchLeft - notchRadius}`,
    `Q ${notchLeft} ${baseTop} ${notchLeft} ${baseTop - notchRadius}`,
    `V ${capTop + notchRadius}`,
    `Q ${notchLeft} ${capTop} ${notchLeft + notchRadius} ${capTop}`,
    `H ${notchRight - notchRadius}`,
    `Q ${notchRight} ${capTop} ${notchRight} ${capTop + notchRadius}`,
    `V ${baseTop - notchRadius}`,
    `Q ${notchRight} ${baseTop} ${notchRight + notchRadius} ${baseTop}`,
    `H ${right - cornerRadius}`,
    `Q ${right} ${baseTop} ${right} ${baseTop + cornerRadius}`,
    `V ${bottom - cornerRadius}`,
    `Q ${right} ${bottom} ${right - cornerRadius} ${bottom}`,
    `H ${inset + cornerRadius}`,
    `Q ${inset} ${bottom} ${inset} ${bottom - cornerRadius}`,
    "Z",
  ].join(" ");

  const nodeRadius = clamp(safeWidth * 0.0052, 4.5, 7.5);

  const nodes = [
    [notchLeft, baseTop],
    [notchRight, baseTop],
    [right, safeHeight * 0.5],
    [safeWidth * 0.82, bottom],
    [safeWidth * 0.18, bottom],
    [inset, safeHeight * 0.5],
  ];

  return {
    path,
    nodes,
    nodeRadius,
    viewBox: `0 0 ${safeWidth} ${safeHeight}`,
  };
}

export default function FooterFlowFrame() {
  const hostRef = useRef(null);
  const [size, setSize] = useState(INITIAL_SIZE);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const frame = host?.parentElement;

    if (!host || !frame) return undefined;

    const updateSize = () => {
      const rect = frame.getBoundingClientRect();

      const nextWidth = Math.max(
        Math.round(rect.width),
        280,
      );
      const nextHeight = Math.max(
        Math.round(rect.height),
        420,
      );

      setSize((current) => {
        if (
          current.width === nextWidth &&
          current.height === nextHeight
        ) {
          return current;
        }

        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    };

    updateSize();

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(updateSize)
        : null;

    resizeObserver?.observe(frame);
    window.addEventListener("resize", updateSize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  const geometry = useMemo(
    () => buildFrameGeometry(size.width, size.height),
    [size.height, size.width],
  );

  return (
    <div
      ref={hostRef}
      className="yc-flow-footer-art"
      aria-hidden="true"
    >
      <svg
        viewBox={geometry.viewBox}
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs>
          <linearGradient
            id="yc-footer-liquid"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#36c8ff" />
            <stop offset="28%" stopColor="#5578ff" />
            <stop offset="56%" stopColor="#8668ff" />
            <stop offset="80%" stopColor="#7fd0ae" />
            <stop offset="100%" stopColor="#ffd467" />
          </linearGradient>

          <linearGradient
            id="yc-footer-pipe"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#f3fbff" />
            <stop offset="54%" stopColor="#edf1ff" />
            <stop offset="100%" stopColor="#edf9f5" />
          </linearGradient>
        </defs>

        <path
          className="yc-flow-pipe-outline"
          d={geometry.path}
        />

        <path
          className="yc-flow-pipe-bed"
          d={geometry.path}
          stroke="url(#yc-footer-pipe)"
        />

        <path
          className="yc-flow-liquid yc-flow-liquid-glow"
          pathLength="1000"
          d={geometry.path}
          stroke="url(#yc-footer-liquid)"
        />

        <path
          className="yc-flow-liquid yc-flow-liquid-core"
          pathLength="1000"
          d={geometry.path}
          stroke="url(#yc-footer-liquid)"
        />

        <g className="yc-flow-junctions">
          {geometry.nodes.map(([cx, cy], index) => (
            <circle
              cx={cx}
              cy={cy}
              r={geometry.nodeRadius}
              key={`${cx}-${cy}-${index}`}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
