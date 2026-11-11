import { BoundaryShape, GenerationParams, RenderedMarker, RenderedPath } from '../types';
import { pxToMm } from './units';
import { boundaryShapeElement } from './geometry';
import { markerGeometry, markerTransform, strokesVisible } from './pathStyle';

const fmt = (n: number) => Number(n.toFixed(3)).toString();

/** Default stroke colour for paths that carry none: black for cutting and engraving. */
const EXPORT_STROKE = '#000000';

function markerElement(m: RenderedMarker): string {
  const g = markerGeometry(m);
  const t = markerTransform(m);
  switch (g.kind) {
    case 'circle':
      return `<circle cx="${m.x}" cy="${m.y}" r="${g.r}" fill="${m.color}" />`;
    case 'rect':
      return `<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" fill="${m.color}" transform="${t}" />`;
    case 'line':
      return `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="${m.color}" stroke-width="${g.strokeWidth}" stroke-linecap="round" transform="${t}" />`;
    case 'polygon':
      return `<polygon points="${g.points}" fill="${m.color}" transform="${t}" />`;
  }
}

/**
 * Write the rendered paths (and the Style layer's markers) to an SVG in mm.
 * Paths are grouped by stroke width and colour; markers get their own group.
 * When the style says markers replace the stroke, the paths are left out.
 */
export function buildSvgDocument(
  boundary: BoundaryShape,
  paths: RenderedPath[],
  params: GenerationParams,
  markers: RenderedMarker[] = []
): string {
  const pad = 20;
  const vx = boundary.x - pad;
  const vy = boundary.y - pad;
  const vw = boundary.width + pad * 2;
  const vh = boundary.height + pad * 2;

  const shapeEl = boundaryShapeElement(boundary);
  const boundaryEl = `${shapeEl} fill="none" stroke="#999" stroke-width="0.5" />`;
  // Clip strokes exactly like the on-screen preview does, so an ellipse
  // export does not bleed past its boundary.
  const clipEl = `${shapeEl} />`;

  const strokeGroups = new Map<string, { sw: number; stroke: string; els: string[] }>();
  const drawStrokes = strokesVisible(params.style);
  for (const p of drawStrokes ? paths : []) {
    const stroke = p.stroke ?? EXPORT_STROKE;
    const key = `${p.strokeWidth}|${stroke}`;
    if (!strokeGroups.has(key)) {
      strokeGroups.set(key, { sw: p.strokeWidth, stroke, els: [] });
    }
    strokeGroups.get(key)!.els.push(`    <path d="${p.d}" />`);
  }

  let pathGroupsEl = '';
  for (const { sw, stroke, els } of strokeGroups.values()) {
    pathGroupsEl += `  <g fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="${params.capStyle}" stroke-linejoin="round" clip-path="url(#boundary-clip)">\n`;
    pathGroupsEl += els.join('\n') + '\n';
    pathGroupsEl += `  </g>\n`;
  }
  if (markers.length > 0) {
    pathGroupsEl += `  <g id="markers" clip-path="url(#boundary-clip)">\n`;
    pathGroupsEl += markers.map((m) => `    ${markerElement(m)}`).join('\n') + '\n';
    pathGroupsEl += `  </g>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${fmt(pxToMm(vw))}mm" height="${fmt(pxToMm(vh))}mm">
  <!-- Serpentine Path Generator | Seed: ${params.seed} | 1 user unit = 1/96 in -->
  <defs>
    <clipPath id="boundary-clip">
      ${clipEl}
    </clipPath>
  </defs>
  <g id="boundary">
    ${boundaryEl}
  </g>
${pathGroupsEl}</svg>`;
}

export function downloadSvg(svgContent: string, seed: number, label = ''): void {
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `serpentine-${seed}${label ? '-' + label : ''}-${Date.now()}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
