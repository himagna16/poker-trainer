/**
 * The spade mark, in one place.
 *
 * The same shape is used by the browser tab icon, the iOS home-screen icon and
 * the social preview card. Keeping the path here means it can only ever drift
 * in one direction: change it once and everything follows.
 *
 * It's drawn deliberately bold and low-shouldered. A more elegant spade looks
 * better at 96px and turns into an unreadable blob at 16px, which is the size
 * it actually lives at most of the time.
 */
export const SPADE_PATH =
  'M32 9C26 19 7 29 7 40.5C7 48 12.5 53 19.5 53C24.5 53 28.5 50.5 30.4 46.5' +
  'C30.4 51 28 55 23.5 57.5L40.5 57.5C36 55 33.6 51 33.6 46.5C35.5 50.5 39.5 53 44.5 53' +
  'C51.5 53 57 48 57 40.5C57 29 38 19 32 9Z';

export const BRAND = {
  felt: '#2d5248',
  feltDeep: '#1e3a33',
  paper: '#f8f6f0',
  ink: '#1b1a17',
  lavender: '#c9bff2',
  inkMuted: '#565146',
};

/** The mark as a standalone SVG string, sized to `size`. */
export function spadeSvg(size: number, fill = BRAND.paper, background?: string): string {
  const bg = background
    ? `<rect width="64" height="64" rx="14" fill="${background}"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">` +
    `${bg}<path fill="${fill}" d="${SPADE_PATH}"/></svg>`
  );
}

/** Data URI, for embedding in generated images where a file path won't do. */
export function spadeDataUri(size: number, fill = BRAND.paper, background?: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(spadeSvg(size, fill, background)).toString('base64')}`;
}
