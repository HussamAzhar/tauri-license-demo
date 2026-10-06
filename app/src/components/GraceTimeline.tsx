import { useLayoutEffect, useRef, useState } from 'react';
import type { LicenseDetails } from '../lib/types';
import { formatDateTime, formatDuration } from '../lib/format';

type Tone = 'active' | 'grace' | 'blocked';

interface Props {
  details: LicenseDetails;
  now: number;
  tone: Tone;
}

const PAD = 14;
const LINE_Y = 40;

/**
 * The offline allowance drawn as an engineering dimension line: extension lines
 * at "last checked" and "connection required", arrowheads, the length written
 * above the line, and a marker for where today sits along it.
 */
export function GraceTimeline({ details, now, tone }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const start = details.lastValidatedAt;
  const end = details.graceEndsAt;
  const span = Math.max(end - start, 1);
  const progress = Math.min(Math.max((now - start) / span, 0), 1);

  const x0 = PAD;
  const x1 = width - PAD;
  const nowX = x0 + (x1 - x0) * progress;
  const overdue = now > end;
  const nowLabel = overdue ? `Now, ${formatDuration(now - end)} overdue` : 'Now';
  // Anchor the label so it never runs past either end of the drawing.
  const anchor = progress > 0.8 ? 'end' : progress < 0.2 ? 'start' : 'middle';
  const labelX = anchor === 'end' ? nowX + 6 : anchor === 'start' ? nowX - 6 : nowX;

  return (
    <figure className={`timeline timeline--${tone}`} ref={ref}>
      <svg width={width} height={124} role="img" aria-label={`Offline allowance: ${formatDuration(span)}. ${Math.round(progress * 100)}% used.`}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M0,1.5 L10,5 L0,8.5 Z" className="timeline-arrow" />
          </marker>
        </defs>

        {/* extension lines */}
        <line x1={x0} x2={x0} y1={LINE_Y - 22} y2={LINE_Y + 10} className="timeline-ext" />
        <line x1={x1} x2={x1} y1={LINE_Y - 22} y2={LINE_Y + 10} className="timeline-ext" />

        {/* dimension line with arrowheads, and the dimension text above it */}
        <line x1={x0 + 1} x2={x1 - 1} y1={LINE_Y} y2={LINE_Y} className="timeline-dim" markerStart="url(#arrow)" markerEnd="url(#arrow)" />
        <text x={(x0 + x1) / 2} y={LINE_Y - 9} textAnchor="middle" className="timeline-dimtext">
          {formatDuration(span)} offline allowance
        </text>

        {/* used portion */}
        <line x1={x0} x2={nowX} y1={LINE_Y} y2={LINE_Y} className="timeline-used" />

        {/* now marker */}
        <line x1={nowX} x2={nowX} y1={LINE_Y - 7} y2={LINE_Y + 16} className="timeline-now" />
        <circle cx={nowX} cy={LINE_Y} r={4.5} className="timeline-dot" />
        <text x={labelX} y={LINE_Y + 32} textAnchor={anchor} className="timeline-nowtext">
          {nowLabel}
        </text>

        {/* end labels */}
        <text x={x0} y={LINE_Y + 62} className="timeline-label">Last checked online</text>
        <text x={x0} y={LINE_Y + 80} className="timeline-value">{formatDateTime(start)}</text>
        <text x={x1} y={LINE_Y + 62} textAnchor="end" className="timeline-label">Connection required</text>
        <text x={x1} y={LINE_Y + 80} textAnchor="end" className="timeline-value">{formatDateTime(end)}</text>
      </svg>
    </figure>
  );
}
