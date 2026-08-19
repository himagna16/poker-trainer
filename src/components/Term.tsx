'use client';

import { GLOSSARY_KEYS, lookup } from '@/lib/poker/glossary';
import type { GlossaryEntry } from '@/lib/poker/glossary';
import React from 'react';

function Tooltip({ entry, children }: { entry: GlossaryEntry; children: React.ReactNode }) {
  return (
    <span className="group relative inline-block">
      <span className="term-underline decoration-slate-400/60">{children}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg border border-white/15 bg-slate-900 p-3 text-left text-xs font-normal leading-relaxed text-slate-200 opacity-0 shadow-xl transition group-hover:opacity-100"
      >
        <span className="block font-semibold text-emerald-300">{entry.term}</span>
        <span className="mt-1 block text-slate-300">{entry.short}</span>
        {entry.why && <span className="mt-1.5 block text-slate-400">{entry.why}</span>}
      </span>
    </span>
  );
}

/** Wrap a single known term. */
export function Term({ children }: { children: string }) {
  const entry = lookup(children);
  if (!entry) return <>{children}</>;
  return <Tooltip entry={entry}>{children}</Tooltip>;
}

/**
 * Scan a block of text and make every glossary term in it hoverable.
 *
 * This is the feature that actually teaches vocabulary. A glossary page is
 * something you have to remember to visit; a definition that appears under the
 * word "boat" at the moment you just flopped one is something you cannot miss.
 *
 * We match longest phrases first so "open-ended straight draw" wins over the
 * "straight" sitting inside it.
 */
export function Annotated({ text, className = '' }: { text: string; className?: string }) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  const lower = text.toLowerCase();

  while (cursor < text.length) {
    let matchedKey: string | null = null;
    let matchAt = -1;

    for (const key of GLOSSARY_KEYS) {
      const at = lower.indexOf(key, cursor);
      if (at < 0) continue;
      // Only match on whole words, so "call" doesn't light up inside "called".
      const before = at === 0 ? ' ' : text[at - 1];
      const after = at + key.length >= text.length ? ' ' : text[at + key.length];
      if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) continue;
      if (matchAt < 0 || at < matchAt || (at === matchAt && key.length > (matchedKey?.length ?? 0))) {
        matchAt = at;
        matchedKey = key;
      }
    }

    if (!matchedKey || matchAt < 0) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (matchAt > cursor) nodes.push(text.slice(cursor, matchAt));
    const entry = lookup(matchedKey)!;
    nodes.push(
      <Tooltip key={`${matchAt}-${matchedKey}`} entry={entry}>
        {text.slice(matchAt, matchAt + matchedKey.length)}
      </Tooltip>
    );
    cursor = matchAt + matchedKey.length;
  }

  return <span className={className}>{nodes}</span>;
}
