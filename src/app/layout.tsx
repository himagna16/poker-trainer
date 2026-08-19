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
 * This is hardcoded on purpose. The obvious approach - read Vercel's env vars -
 * looks cleaner and has a nasty failure mode: those variables are baked in at
 * BUILD time, so renaming the domain in Vercel's settings without redeploying
 * leaves the preview image pointing at a URL that no longer resolves. That
 * already happened once here, and nothing on the site itself showed any sign of
 * it - the pages were all fine, only the link previews were dead.
 *
 * A constant cannot rot that way. Set NEXT_PUBLIC_SITE_URL to override it if
 * the site ever moves to a custom domain.
 *
 * The override is checked for emptiness rather than just for being undefined.
 * An environment variable that exists but is blank - trivially easy to create
 * by accident in a hosting dashboard - would otherwise sail past a ?? check and
 * blow up the build inside new URL('') with an error that names neither the
 * variable nor this file.
 */
const PRODUCTION_URL = 'https://pocketodds.vercel.app';

const override = process.env.NEXT_PUBLIC_SITE_URL?.trim();

const siteUrl = override
  ? override
  : process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NODE_ENV === 'development'
      ? 'http://localhost:3007'
      : PRODUCTION_URL;

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
