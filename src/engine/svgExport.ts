import { BoundaryShape, GenerationParams, RenderedPath } from '../types';

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

  const boundaryEl =
    boundary.type === 'ellipse'
      ? `<ellipse cx="${boundary.x + boundary.width / 2}" cy="${boundary.y + boundary.height / 2}" rx="${boundary.width / 2}" ry="${boundary.height / 2}" fill="none" stroke="#999" stroke-width="0.5" />`
      : `<rect x="${boundary.x}" y="${boundary.y}" width="${boundary.width}" height="${boundary.height}" fill="none" stroke="#999" stroke-width="0.5" />`;

  const strokeGroups = new Map<number, string[]>();
  for (const p of paths) {
    if (!strokeGroups.has(p.strokeWidth)) {
      strokeGroups.set(p.strokeWidth, []);
    }
    strokeGroups.get(p.strokeWidth)!.push(`    <path d="${p.d}" />`);
  }

  let pathGroupsEl = '';
  for (const [sw, pathEls] of strokeGroups) {
    pathGroupsEl += `  <g fill="none" stroke="#000000" stroke-width="${sw}" stroke-linecap="${params.capStyle}" stroke-linejoin="round">\n`;
    pathGroupsEl += pathEls.join('\n') + '\n';
    pathGroupsEl += `  </g>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}">
  <!-- Serpentine Path Generator | Seed: ${params.seed} -->
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
