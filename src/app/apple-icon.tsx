import { ImageResponse } from 'next/og';
import { spadeDataUri, BRAND } from '@/lib/mark';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * iOS insists on a raster image for home-screen icons, and it applies its own
 * rounded corners, so this one is drawn as a full-bleed square with the mark
 * inset rather than reusing the rounded tile.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BRAND.felt,
        }}
      >
        <img src={spadeDataUri(120)} width={120} height={120} alt="" />
      </div>
    ),
    size
  );
}
