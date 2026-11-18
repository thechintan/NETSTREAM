import React from 'react';

export interface SparklineProps {
  label: string;
  values: Array<number | null>;
  color: string;
  unit?: string;
  decimals?: number;
  width?: number;
  height?: number;
  maxPoints?: number;
}

export const Sparkline: React.FC<SparklineProps> = ({
  label,
  values,
  color,
  unit = '',
  decimals = 1,
  width = 140,
  height = 30,
  maxPoints = 60,
}) => {
  const slice = values.slice(-maxPoints);
  const numericValues = slice.filter((v): v is number => v !== null && Number.isFinite(v));
  const latest = slice.length > 0 ? slice[slice.length - 1] : null;

  const minVal = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const maxVal = numericValues.length > 0 ? Math.max(...numericValues) : 1;
  const range = maxVal - minVal || Math.max(maxVal, 1);

  const padX = 2;
  const padY = 3;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const segments: string[] = [];
  let currentSegment: string[] = [];

  const count = Math.max(slice.length - 1, 1);

  slice.forEach((val, idx) => {
    if (val === null || !Number.isFinite(val)) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment.join(' '));
        currentSegment = [];
      }
      return;
    }

    const x = padX + (slice.length === 1 ? innerW : (idx / count) * innerW);
    const normalized = (val - minVal) / range;
    const y = padY + innerH - normalized * innerH;
    const cmd = currentSegment.length === 0 ? 'M' : 'L';
    currentSegment.push(`${cmd}${x.toFixed(1)},${y.toFixed(1)}`);
  });

  if (currentSegment.length > 0) {
    segments.push(currentSegment.join(' '));
  }

  const latestDisplay =
    latest !== null && Number.isFinite(latest) ? `${latest.toFixed(decimals)}${unit}` : '-';

  return (
    <div className="bg-slate-950/70 border border-slate-800/80 rounded px-2 py-1.5">
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className="text-slate-400 uppercase tracking-wider">{label}</span>
        <span className="font-mono font-semibold text-slate-100">{latestDisplay}</span>
      </div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="overflow-visible"
        aria-label={`${label} sparkline`}
      >
        <line
          x1={padX}
          y1={height - padY}
          x2={width - padX}
          y2={height - padY}
          stroke="rgba(148, 163, 184, 0.15)"
          strokeWidth="1"
        />
        {segments.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
};
