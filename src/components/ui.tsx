'use client';

import React from 'react';

/* A white panel on the paper. The workhorse container. */
export function Panel({
  children, className = '', pad = true,
}: { children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section
      className={`lift relative overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-surface)] ${
        pad ? 'p-5' : ''
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="eyebrow">{children}</h2>
      {right}
    </div>
  );
}

type ButtonTone = 'primary' | 'accent' | 'quiet' | 'ghost' | 'danger';

const TONES: Record<ButtonTone, string> = {
  primary: 'bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[#2c2a25]',
  accent: 'bg-[var(--color-lav)] text-[var(--color-lav-ink)] hover:bg-[var(--color-lav-deep)] hover:text-white',
  quiet: 'bg-[var(--color-paper-deep)] text-[var(--color-ink)] hover:bg-[var(--color-line)]',
  ghost: 'text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-deep)] hover:text-[var(--color-ink)]',
  danger: 'bg-[var(--color-bad-soft)] text-[var(--color-bad)] hover:bg-[#efd6d0]',
};

export function Button({
  children, tone = 'quiet', size = 'md', className = '', ...rest
}: {
  children: React.ReactNode;
  tone?: ButtonTone;
  size?: 'sm' | 'md' | 'lg';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizes = {
    sm: 'px-3 py-1.5 text-[13px]',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-[15px]',
  };
  return (
    <button
      {...rest}
      className={`rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${TONES[tone]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

/** A labelled number. The value uses the serif, which makes figures feel considered. */
export function Stat({
  label, value, sub, tone = 'default', size = 'md',
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: 'default' | 'good' | 'bad' | 'warn';
  size?: 'sm' | 'md' | 'lg';
}) {
  const colours = {
    default: 'text-[var(--color-ink)]',
    good: 'text-[var(--color-good)]',
    bad: 'text-[var(--color-bad)]',
    warn: 'text-[var(--color-warn)]',
  };
  const sizes = { sm: 'text-xl', md: 'text-[28px]', lg: 'text-[38px]' };
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className={`display tnum mt-0.5 ${sizes[size]} ${colours[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-[var(--color-ink-faint)]">{sub}</div>}
    </div>
  );
}

export function Toggle({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--color-paper-deep)]"
    >
      <span
        className={`mt-0.5 grid h-[18px] w-[30px] shrink-0 rounded-full p-[2px] transition ${
          checked ? 'bg-[var(--color-felt)]' : 'bg-[var(--color-line-strong)]'
        }`}
      >
        <span
          className={`h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-[12px]' : ''
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-tight">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-[var(--color-ink-faint)]">{hint}</span>}
      </span>
    </button>
  );
}

/** Segmented control - a row of options where exactly one is chosen. */
export function Segmented<T extends string | number>({
  options, value, onChange, size = 'md',
}: {
  options: Array<{ value: T; label: string; title?: string }>;
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-full border border-[var(--color-line)] bg-[var(--color-paper-deep)] p-[3px]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-full font-medium transition ${
            size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]'
          } ${
            value === o.value
              ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm'
              : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({
  children, tone = 'neutral',
}: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const tones = {
    neutral: 'bg-[var(--color-paper-deep)] text-[var(--color-ink-muted)]',
    good: 'bg-[var(--color-good-soft)] text-[var(--color-good)]',
    warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
    bad: 'bg-[var(--color-bad-soft)] text-[var(--color-bad)]',
    accent: 'bg-[var(--color-lav)] text-[var(--color-lav-ink)]',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** A dark, rounded slab - used to ground a section, like the reference site. */
export function Slab({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[var(--radius-slab)] bg-[var(--color-ink)] px-6 py-14 text-[var(--color-paper)] sm:px-12 ${className}`}
    >
      {children}
    </section>
  );
}
