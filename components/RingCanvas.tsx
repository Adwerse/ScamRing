'use client';

import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { kindLabel, priceLabel, type RingNode, type RingResponse } from './contracts';

const defaultTheme = { pending: '#944F01', confirmed_scam: '#970606', legit: '#5C6C75', rejected: '#889397', canvas: '#F9FBFA', ink: '#001E2B', line: '#C1C7C6', identifier: '#E8EDEB', current: '#016BF8', surface: '#FFFFFF' };
const glyphs = { phone: 'P', pay: 'R', email: '@', iban: 'I', img: '▧' };
type GraphNode = NodeObject<RingNode>;

export default function RingCanvas({ data }: { data: RingResponse }) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraphMethods<RingNode> | undefined>(undefined);
  const images = useRef(new Map<string, HTMLImageElement>());
  const fitted = useRef(false);
  const [width, setWidth] = useState(700);
  const [theme, setTheme] = useState(defaultTheme);
  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const colour = (variable: string, fallback: string) => styles.getPropertyValue(variable).trim() || fallback;
    setTheme({ pending: colour('--risk-medium', defaultTheme.pending), confirmed_scam: colour('--risk-high', defaultTheme.confirmed_scam), legit: colour('--muted', defaultTheme.legit), rejected: colour('--control-border', defaultTheme.rejected), canvas: colour('--background', defaultTheme.canvas), ink: colour('--foreground', defaultTheme.ink), line: colour('--border', defaultTheme.line), identifier: colour('--soft-border', defaultTheme.identifier), current: colour('--focus', defaultTheme.current), surface: colour('--surface', defaultTheme.surface) });
  }, []);
  // ForceGraph mutates nodes and link endpoints. Never pass the response itself.
  const graphData = useMemo(() => ({ nodes: data.nodes.map(n => ({ ...n })), links: data.links.map(l => ({ ...l })) }), [data]);
  useEffect(() => {
    fitted.current = false;
    for (const node of data.nodes) if (node.type === 'identifier' && node.kind === 'img' && /^(\/[^/]|https:\/\/)/.test(node.hint)) {
      if (!images.current.has(node.hint)) { const img = new Image(); img.src = node.hint; images.current.set(node.hint, img); }
    }
  }, [data]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const draw = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0, y = node.y ?? 0;
    const radius = node.type === 'report' ? 8 : 6;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = node.type === 'report' ? theme[node.status] ?? theme.pending : theme.identifier; ctx.fill();
    ctx.lineWidth = node.type === 'report' && node.isCurrent ? 3 : 1;
    ctx.strokeStyle = node.type === 'report' && node.isCurrent ? theme.current : theme.surface; ctx.stroke();
    if (node.type === 'identifier') {
      const img = images.current.get(node.hint);
      if (node.kind === 'img' && img?.complete && img.naturalWidth > 0) {
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius - 1, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2); ctx.restore();
      } else { ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = theme.ink; ctx.fillText(glyphs[node.kind], x, y); }
    }
    if (node.type === 'report' && (scale > 0.75 || node.isCurrent)) {
      const label = `${node.area || 'Unspecified'} · ${priceLabel(node.priceEur).replace(' / month', '')}`;
      const size = Math.min(11 / scale, 10);
      ctx.font = `${size}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = theme.canvas; ctx.fillRect(x - textWidth / 2 - 2, y + radius + 3, textWidth + 4, size + 3);
      ctx.fillStyle = theme.ink; ctx.fillText(label, x, y + radius + 4);
    }
  }, [theme]);
  return <div className="graph-wrap"><div ref={container} className="graph-canvas" role="img" aria-label="Map of reports and the identifiers connecting them. The complete accessible list follows below.">
    <ForceGraph2D<RingNode> ref={graph} width={width} height={420} graphData={graphData} backgroundColor={theme.canvas} nodeCanvasObject={draw} nodeLabel={node => {
      // String tooltips are interpreted as HTML. Escape all untrusted API text.
      const label = node.type === 'report' ? `${node.area || 'Area unspecified'} — ${priceLabel(node.priceEur)}` : `${kindLabel[node.kind]}: ${node.kind === 'img' ? 'Reused photo' : node.hint}`;
      return label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }} linkColor={() => theme.line} linkWidth={1.5} cooldownTicks={100} onEngineStop={() => { if (!fitted.current) { graph.current?.zoomToFit(400, 45); fitted.current = true; } }} />
  </div><div className="graph-controls"><span>Drag to move · scroll to zoom</span><button type="button" className="button secondary small" onClick={() => graph.current?.zoomToFit(400, 45)}>Fit map</button></div></div>;
}
