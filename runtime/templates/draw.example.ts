// Deterministic code-drawn sample. Run with Bun from the desired output directory.
export type Color = `#${string}`;
export type Bubble = readonly [x: number, y: number, radius: number];

export interface Palette {
  ink: Color;
  amber: Color;
  gold: Color;
  glass: Color;
  cream: Color;
  cork: Color;
}

export interface DrawOptions {
  width?: number;
  height?: number;
  palette?: Palette;
  bubbles?: readonly Bubble[];
}

const DEFAULT_PALETTE: Palette = {
  ink: '#35243f', amber: '#ee902f', gold: '#ffcb65', glass: '#9ce3d1',
  cream: '#fff4ce', cork: '#b67a58',
};
const DEFAULT_BUBBLES: readonly Bubble[] = [[197, 330, 8], [272, 367, 6], [305, 307, 11], [238, 292, 5]];

/** Draw an editable potion bottle; dimensions scale the fixed design viewBox. */
export function drawPotion({
  width = 512,
  height = 512,
  palette = DEFAULT_PALETTE,
  bubbles = DEFAULT_BUBBLES,
}: DrawOptions = {}): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Drawing width and height must be positive finite numbers');
  }
  const bubblePaths = bubbles.map(([x, y, radius]: Bubble): string =>
    `<circle cx="${x}" cy="${y}" r="${radius}" fill="${palette.gold}" opacity=".8"/>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="glass" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#e8fff3" stop-opacity=".95"/>
      <stop offset="1" stop-color="${palette.glass}" stop-opacity=".75"/>
    </linearGradient>
    <linearGradient id="liquid" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="${palette.gold}"/>
      <stop offset="1" stop-color="${palette.amber}"/>
    </linearGradient>
  </defs>
  <g stroke="${palette.ink}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <path d="M218 114h76v62c0 22 70 48 84 117 16 82-24 139-122 139s-138-57-122-139c14-69 84-95 84-117z" fill="url(#glass)"/>
    <path d="M159 278c45 16 80-12 116 0s51 9 78-1c7 11 11 29 11 47 0 63-39 92-108 92s-108-29-108-92c0-17 4-33 11-46z" fill="url(#liquid)" stroke-width="6"/>
    ${bubblePaths}
    <path d="M218 68h76l-7 57h-62z" fill="${palette.cork}"/>
    <path d="M242 81l-3 22m32-17-2 19" fill="none" stroke="#80513e" stroke-width="5"/>
    <rect x="207" y="116" width="98" height="30" rx="13" fill="${palette.glass}"/>
    <path d="M188 238c-17 15-26 32-31 54m-2 22v13" fill="none" stroke="${palette.cream}" stroke-width="13"/>
    <path d="M284 160c9 32 41 38 49 68" fill="none" stroke="#947055" stroke-width="6"/>
    <path d="M318 208l36 11 13 53-48 8-18-40z" fill="${palette.cream}" stroke-width="6"/>
    <path d="M332 234c-14 19-12 26 0 26s14-7 0-26z" fill="${palette.amber}" stroke-width="4"/>
  </g>
</svg>`;
}

if (import.meta.main) await Bun.write('asset.svg', drawPotion());
