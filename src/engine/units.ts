/** World units are CSS pixels at 96 dpi; rulers and exports are in mm. */
export const PX_PER_MM = 96 / 25.4;
export const pxToMm = (px: number) => px / PX_PER_MM;
export const mmToPx = (mm: number) => mm * PX_PER_MM;

/**
 * A typed length as px: a bare number is mm; "cm", "in" (or a double quote)
 * and "px" suffixes are understood, and a comma works as the decimal mark.
 * Returns null for anything that is not a positive length.
 */
export function parseLength(text: string): number | null {
  const m = text.trim().toLowerCase().replace(',', '.').match(/^(\d*\.?\d+)\s*(mm|cm|in|"|px)?$/);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  switch (m[2]) {
    case 'cm': return mmToPx(v * 10);
    case 'in':
    case '"': return v * 96;
    case 'px': return v;
    default: return mmToPx(v);
  }
}
