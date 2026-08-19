import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pocket Odds - learn poker without losing money',
  description:
    'Play against bots that you can see through. Live odds, every decision graded, and a glossary that explains what everyone at the table is talking about.',
};

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/play', label: 'Play' },
  { href: '/drills', label: 'Drills' },
  { href: '/glossary', label: 'Glossary' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#080c14] text-slate-200">
        <header className="border-b border-white/10 bg-black/30 backdrop-blur sticky top-0 z-50">
          <nav className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-3">
            <Link href="/" className="mr-4 flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30">
                ♠
              </span>
              <span>Pocket Odds</span>
            </Link>
            {NAV.slice(1).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            <span className="ml-auto hidden text-xs text-slate-500 sm:block">
              Play money only. Nothing here can be wagered.
            </span>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
