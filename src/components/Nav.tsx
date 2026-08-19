'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/play', label: 'Play' },
  { href: '/drills', label: 'Drills' },
  { href: '/glossary', label: 'Glossary' },
];

/**
 * A floating pill rather than a full-width bar.
 *
 * A bar pinned edge to edge draws a hard line across the page and makes the
 * whole thing feel like an admin dashboard. A pill floating on the paper keeps
 * the page feeling like a document, and the active tab reads instantly without
 * needing a colour to shout about it.
 */
export function Nav() {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-50 px-4 pt-4 pb-2">
      <nav className="lift mx-auto flex max-w-3xl items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)]/92 px-2 py-2 backdrop-blur-md">
        <Link
          href="/"
          className="group mr-1 flex items-center gap-2 rounded-full pl-2 pr-3 py-1.5"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--color-felt)] text-[13px] leading-none text-white">
            ♠
          </span>
          <span className="display text-[17px] tracking-tight">Pocket Odds</span>
        </Link>

        <div className="ml-auto flex items-center gap-1">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(link.href + '/');
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full px-4 py-1.5 text-sm transition ${
                  active
                    ? 'bg-[var(--color-ink)] text-[var(--color-paper)]'
                    : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-deep)] hover:text-[var(--color-ink)]'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
