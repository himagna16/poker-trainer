'use client';

import { useMemo, useState } from 'react';
import { GLOSSARY, CATEGORIES } from '@/lib/poker/glossary';
import type { GlossaryCategory } from '@/lib/poker/glossary';
import { Panel } from '@/components/ui';

export default function GlossaryPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GlossaryCategory | 'All'>('All');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GLOSSARY.filter((e) => {
      if (category !== 'All' && e.category !== category) return false;
      if (!q) return true;
      return (
        e.term.toLowerCase().includes(q) ||
        (e.aliases ?? []).some((a) => a.toLowerCase().includes(q)) ||
        e.short.toLowerCase().includes(q) ||
        (e.why ?? '').toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  const grouped = useMemo(() => {
    const map = new Map<GlossaryCategory, typeof GLOSSARY>();
    for (const entry of results) {
      if (!map.has(entry.category)) map.set(entry.category, []);
      map.get(entry.category)!.push(entry);
    }
    return map;
  }, [results]);

  return (
    <div className="mx-auto max-w-3xl px-5 pb-16 pt-6">
      <header className="mb-8">
        <p className="eyebrow">Vocabulary</p>
        <h1 className="display mt-2 text-[46px]">
          What everyone at the table
          <br />
          <em>assumes you know</em>
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
          Poker has an unusually dense private language, and not knowing it makes everything harder than
          it needs to be. Every definition here assumes you know nothing, and where it matters, says what
          the term means for your actual decisions.
        </p>
        <p className="mt-2 text-[14px] text-[var(--color-ink-faint)]">
          These same definitions appear as hover notes while you play, so you learn a word at the moment
          it happens to you.
        </p>
      </header>

      <div className="sticky top-[76px] z-10 mb-6 -mx-2 rounded-2xl bg-[var(--color-paper)]/92 px-2 py-3 backdrop-blur-md">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — try “nuts”, “boat”, “pot odds”…"
          aria-label="Search the glossary"
          className="w-full rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-5 py-3 text-[15px] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-ink)]"
        />
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(['All', ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c as GlossaryCategory | 'All')}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                category === c
                  ? 'bg-[var(--color-ink)] text-[var(--color-paper)]'
                  : 'bg-[var(--color-surface)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {results.length === 0 && (
        <p className="py-14 text-center text-[var(--color-ink-faint)]">
          Nothing matches “{query}”. Try a shorter search.
        </p>
      )}

      {[...grouped.entries()].map(([cat, entries]) => (
        <section key={cat} className="mb-10">
          <h2 className="eyebrow mb-3">{cat}</h2>
          <dl className="space-y-2.5">
            {entries.map((e) => (
              <Panel key={e.term} className="p-4">
                <dt className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[16px] font-medium">{e.term}</span>
                  {e.aliases && (
                    <span className="text-[12px] text-[var(--color-ink-faint)]">
                      also {e.aliases.join(', ')}
                    </span>
                  )}
                </dt>
                <dd className="mt-1.5 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">{e.short}</dd>
                {e.why && (
                  <dd className="mt-2 rounded-lg bg-[var(--color-good-soft)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-good)]">
                    {e.why}
                  </dd>
                )}
                {e.example && (
                  <dd className="mt-2 text-[13px] italic leading-relaxed text-[var(--color-ink-faint)]">
                    {e.example}
                  </dd>
                )}
              </Panel>
            ))}
          </dl>
        </section>
      ))}

      <p className="border-t border-[var(--color-line)] pt-4 text-[12px] text-[var(--color-ink-faint)]">
        {GLOSSARY.length} terms.
      </p>
    </div>
  );
}
