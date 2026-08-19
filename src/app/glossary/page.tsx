'use client';

import { useMemo, useState } from 'react';
import { GLOSSARY, CATEGORIES } from '@/lib/poker/glossary';
import type { GlossaryCategory } from '@/lib/poker/glossary';

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
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Poker vocabulary</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">
          Poker has an unusually dense private language, and not knowing it makes everything
          harder than it needs to be. Every definition here assumes you know nothing, and where
          it matters, says what the term means for your actual decisions.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          These same definitions appear as hover tooltips while you play, so you learn a word at
          the moment it happens to you.
        </p>
      </header>

      <div className="sticky top-14 z-10 -mx-4 mb-5 bg-[#080c14]/95 px-4 py-3 backdrop-blur">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search - try &ldquo;nuts&rdquo;, &ldquo;boat&rdquo;, &ldquo;pot odds&rdquo;…"
          className="w-full rounded-lg border border-white/15 bg-slate-900 px-4 py-2.5 text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-400"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['All', ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c as GlossaryCategory | 'All')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                category === c ? 'bg-emerald-500 text-emerald-950' : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {results.length === 0 && (
        <p className="py-12 text-center text-slate-500">
          Nothing matches &ldquo;{query}&rdquo;. Try a shorter search.
        </p>
      )}

      {[...grouped.entries()].map(([cat, entries]) => (
        <section key={cat} className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-400/80">{cat}</h2>
          <dl className="space-y-3">
            {entries.map((e) => (
              <div key={e.term} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <dt className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold text-slate-100">{e.term}</span>
                  {e.aliases && (
                    <span className="text-xs text-slate-500">also: {e.aliases.join(', ')}</span>
                  )}
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-slate-300">{e.short}</dd>
                {e.why && (
                  <dd className="mt-2 rounded-md bg-emerald-500/[0.07] px-3 py-2 text-sm leading-relaxed text-emerald-200/85">
                    {e.why}
                  </dd>
                )}
                {e.example && (
                  <dd className="mt-2 text-sm italic leading-relaxed text-slate-400">{e.example}</dd>
                )}
              </div>
            ))}
          </dl>
        </section>
      ))}

      <p className="border-t border-white/10 pt-4 text-xs text-slate-500">
        {GLOSSARY.length} terms.
      </p>
    </div>
  );
}
