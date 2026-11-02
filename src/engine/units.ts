/** World units are CSS pixels at 96 dpi; rulers and exports are in mm. */
export const PX_PER_MM = 96 / 25.4;
export const pxToMm = (px: number) => px / PX_PER_MM;
export const mmToPx = (mm: number) => mm * PX_PER_MM;
