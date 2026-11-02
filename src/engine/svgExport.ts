import { BoundaryShape, GenerationParams, RenderedPath } from '../types';
import { pxToMm } from './units';
import { boundaryShapeElement } from './geometry';

const fmt = (n: number) => Number(n.toFixed(3)).toString();

export function buildSvgDocument(
  boundary: BoundaryShape,
  paths: RenderedPath[],
  params: GenerationParams
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

  const strokeGroups = new Map<number, string[]>();
  for (const p of paths) {
    if (!strokeGroups.has(p.strokeWidth)) {
      strokeGroups.set(p.strokeWidth, []);
    }
    strokeGroups.get(p.strokeWidth)!.push(`    <path d="${p.d}" />`);
  }

  let pathGroupsEl = '';
  for (const [sw, pathEls] of strokeGroups) {
    pathGroupsEl += `  <g fill="none" stroke="#000000" stroke-width="${sw}" stroke-linecap="${params.capStyle}" stroke-linejoin="round" clip-path="url(#boundary-clip)">\n`;
    pathGroupsEl += pathEls.join('\n') + '\n';
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

export function downloadSvg(svgContent: string, seed: number): void {
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `serpentine-${seed}-${Date.now()}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
