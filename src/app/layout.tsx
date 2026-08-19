import type { Metadata } from 'next';
import { Instrument_Serif, Instrument_Sans } from 'next/font/google';
import './globals.css';
import { Nav } from '@/components/Nav';

// One serif for display, one grotesque for everything else. The serif carries
// only a single weight - emphasis comes from its italic rather than from adding
// heavier cuts, which is what keeps the typography feeling composed instead of
// shouty.
const serif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-instrument-serif',
  display: 'swap',
});

const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

const TITLE = 'Pocket Odds — learn poker without losing money';
const DESCRIPTION =
  'Play against opponents you can see through. Live odds, every decision graded in big blinds, ' +
  'and a glossary that explains what everyone at the table is talking about.';

/**
 * Where the site lives, for building absolute URLs to the preview image.
 *
 * Vercel sets VERCEL_URL on every deployment, including previews, so this
 * resolves correctly without anything being hardcoded. NEXT_PUBLIC_SITE_URL
 * overrides it once there's a custom domain.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3007');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'Pocket Odds',
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'Pocket Odds',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport = {
  themeColor: '#f8f6f0',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} h-full`}>
      <body className="min-h-full antialiased">
        <Nav />
        <main>{children}</main>
        <footer className="mx-auto max-w-6xl px-5 pb-10 pt-16">
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-5">
            <p className="text-xs text-[var(--color-ink-faint)]">
              Play money only. Nothing here can be wagered, deposited, or cashed out.
            </p>
            <p className="text-xs text-[var(--color-ink-faint)]">
              Everything runs in your browser.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
