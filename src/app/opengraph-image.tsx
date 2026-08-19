import { ImageResponse } from 'next/og';
import { spadeDataUri, BRAND } from '@/lib/mark';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Pocket Odds — learn poker without losing money';

/**
 * The preview card for shared links.
 *
 * Deliberately typographically plain: generating this with the site's serif
 * would mean shipping a font binary to the image renderer, and a broken preview
 * card is far worse than one set in the default face. The colour and the mark
 * carry the brand instead.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: BRAND.felt,
          padding: 72,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <img src={spadeDataUri(56)} width={56} height={56} alt="" />
          <div style={{ fontSize: 30, color: 'rgba(248,246,240,0.65)', letterSpacing: 2 }}>
            POCKET ODDS
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 82, color: BRAND.paper, lineHeight: 1.05, letterSpacing: -2 }}>
            Learn poker without
          </div>
          <div style={{ fontSize: 82, color: BRAND.lavender, lineHeight: 1.05, letterSpacing: -2 }}>
            paying tuition
          </div>
        </div>

        <div style={{ fontSize: 27, color: 'rgba(248,246,240,0.6)', lineHeight: 1.4 }}>
          Play opponents you can see through. Every decision graded in big blinds.
        </div>
      </div>
    ),
    size
  );
}
