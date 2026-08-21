import { useId, useState } from 'react';
import type { AnalyticsBucket } from '../lib/types';

/**
 * Charts are hand-drawn SVG rather than a charting library.
 *
 * The app needs four chart types with consistent theming, and every mainstream
 * library would add far more weight than that is worth and would need its own
 * theming layer to follow the CSS custom properties. Drawing them directly
 * keeps colours, fonts and dark mode automatic.
 */

const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
];

export const seriesColor = (index: number) => SERIES[index % SERIES.length]!;

/* ---------------------------------------------------------------------------
   Horizontal bars — for ranked categorical comparisons
   --------------------------------------------------------------------------- */

export function HorizontalBars({
  data,
  format,
  max: explicitMax,
  colorAt,
}: {
  data: AnalyticsBucket[];
  format: (n: number) => string;
  max?: number;
  colorAt?: (index: number) => string;
}) {
  const max = explicitMax ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="hbar">
      {data.map((item, index) => (
        <div className="hbar__row" key={item.label}>
          <span className="hbar__label">{item.label}</span>
          <span className="hbar__value">
            {format(item.value)}
            {item.count !== undefined && <span className="dim"> · {item.count}</span>}
          </span>
          <div className="hbar__track">
            <div
              className="hbar__fill"
              style={{
                width: `${Math.max(2, (item.value / max) * 100)}%`,
                background: (colorAt ?? seriesColor)(index),
                animationDelay: `${index * 60}ms`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Column chart — for time series
   --------------------------------------------------------------------------- */

export function ColumnChart({
  data,
  format,
  height = 200,
}: {
  data: AnalyticsBucket[];
  format: (n: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 1);

  const width = 100;
  const plotHeight = height - 34;
  const gap = 1.6;
  const barWidth = data.length > 0 ? (width - gap * (data.length - 1)) / data.length : 0;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"
        aria-label={`Column chart of ${data.length} periods`}>
        {/* Gridlines at quarter intervals give the eye a reference without a full axis. */}
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            key={fraction}
            className="chart__grid"
            x1={0}
            x2={width}
            y1={plotHeight - plotHeight * fraction}
            y2={plotHeight - plotHeight * fraction}
            vectorEffect="non-scaling-stroke"
            opacity={0.5}
          />
        ))}

        {data.map((item, index) => {
          const barHeight = Math.max(1.5, (item.value / max) * plotHeight);
          const x = index * (barWidth + gap);
          const active = hover === index;

          return (
            <g key={item.label}>
              <rect
                className="chart__bar"
                x={x}
                y={plotHeight - barHeight}
                width={barWidth}
                height={barHeight}
                rx={1.5}
                fill={active ? 'var(--accent-hover)' : 'var(--accent)'}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${item.label}: ${format(item.value)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>

      {/* Labels sit outside the SVG so they are not distorted by
          preserveAspectRatio="none", which stretches the plot to fill. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${data.length}, 1fr)`,
          gap: '2px',
          marginTop: '0.4rem',
        }}
      >
        {data.map((item, index) => (
          <span
            key={item.label}
            className="tiny dim"
            style={{
              textAlign: 'center',
              fontWeight: hover === index ? 700 : 500,
              color: hover === index ? 'var(--accent)' : undefined,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {item.label}
          </span>
        ))}
      </div>

      <div className="tiny muted" style={{ marginTop: '0.5rem', minHeight: '1.2em' }}>
        {hover !== null && data[hover]
          ? `${data[hover]!.label}: ${format(data[hover]!.value)}${
              data[hover]!.count !== undefined ? ` across ${data[hover]!.count} requisitions` : ''
            }`
          : `Peak ${format(max)}`}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Donut — for part-to-whole with few categories
   --------------------------------------------------------------------------- */

export function DonutChart({
  data,
  format,
  size = 150,
  centerLabel,
  centerValue,
}: {
  data: AnalyticsBucket[];
  format: (n: number) => string;
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const id = useId();
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <div className="row" style={{ gap: '1.25rem', alignItems: 'center' }}>
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-labelledby={id}>
        <title id={id}>Donut chart totalling {format(total)}</title>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--surface-3)" strokeWidth="13" />
        {data.map((item, index) => {
          const fraction = total > 0 ? item.value / total : 0;
          const length = fraction * circumference;
          const dash = `${length} ${circumference - length}`;
          const rotation = (offset / circumference) * 360 - 90;
          offset += length;

          return (
            <circle
              key={item.label}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={seriesColor(index)}
              strokeWidth="13"
              strokeDasharray={dash}
              transform={`rotate(${rotation} 50 50)`}
              style={{ transition: 'stroke-dasharray 0.6s var(--ease)' }}
            >
              <title>{`${item.label}: ${format(item.value)}`}</title>
            </circle>
          );
        })}
        {(centerValue || centerLabel) && (
          <>
            <text
              x="50"
              y={centerLabel ? 47 : 53}
              textAnchor="middle"
              fill="var(--text)"
              fontSize="13"
              fontWeight="680"
            >
              {centerValue}
            </text>
            {centerLabel && (
              <text x="50" y="60" textAnchor="middle" fill="var(--text-tertiary)" fontSize="7">
                {centerLabel}
              </text>
            )}
          </>
        )}
      </svg>

      <div className="donut__legend" style={{ flex: 1, minWidth: 0 }}>
        {data.map((item, index) => (
          <div className="donut__item" key={item.label}>
            <span className="donut__swatch" style={{ background: seriesColor(index) }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.label}
            </span>
            <span className="donut__value">{format(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Sparkline — compact trend inside a card
   --------------------------------------------------------------------------- */

export function Sparkline({
  values,
  color = 'var(--accent)',
  height = 34,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const width = 100;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }}
      aria-hidden="true"
    >
      <polyline
        points={`0,${height} ${points.join(' ')} ${width},${height}`}
        fill={color}
        opacity={0.12}
        stroke="none"
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
