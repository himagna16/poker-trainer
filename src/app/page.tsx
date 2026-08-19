import Link from 'next/link';
import { CardView } from '@/components/CardView';
import { Panel, Slab } from '@/components/ui';
import { parseCards } from '@/lib/poker/cards';

const FEATURES = [
  {
    title: 'See straight through the table',
    body:
      'Turn on X-ray and you can see everyone’s cards, your live odds, what each action is worth, and ' +
      'the range of hands each opponent could be holding. Then take the training wheels off one at a ' +
      'time until you’re playing blind — by which point the intuition the numbers were teaching has stuck.',
  },
  {
    title: 'Every decision graded, with a reason',
    body:
      'After each move you find out exactly what it cost or gained, in big blinds, and why. Not “you ' +
      'should fold here” — the price you were getting, how often you win, and how often everyone folds.',
  },
  {
    title: 'Two to nine players, side pots and all',
    body:
      'Heads-up teaches you one game; a full table teaches you another. Bluffing one opponent who folds ' +
      '70% of the time works. Bluffing five of them works 17% of the time, and the app will show you ' +
      'that arithmetic rather than just telling you the rule.',
  },
  {
    title: 'The words everyone assumes you know',
    body:
      'Ninety-four terms defined for someone who genuinely doesn’t know them yet, and wired into the ' +
      'game so the definition appears the moment you flop the boat — not on a page you never visit.',
  },
];

export default function HomePage() {
  const showcase = parseCards('AhKh');

  return (
    <div className="mx-auto max-w-6xl px-5">
      {/* ---- Hero ---- */}
      <section className="pt-16 text-center sm:pt-24">
        <p className="eyebrow">Poker training</p>
        <h1 className="display mx-auto mt-4 max-w-3xl text-[52px] sm:text-[76px]">
          Learn poker without
          <br />
          <em>paying tuition</em>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-[var(--color-ink-muted)]">
          Most people learn this game by losing money at it. Play against opponents you can see through,
          get every decision scored, and find out what the table is actually talking about.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link
            href="/play"
            className="rounded-full bg-[var(--color-ink)] px-7 py-3.5 text-[15px] font-medium text-[var(--color-paper)] transition hover:bg-[#2c2a25]"
          >
            Sit down at the table
          </Link>
          <Link
            href="/drills"
            className="rounded-full border border-[var(--color-line-strong)] px-7 py-3.5 text-[15px] font-medium transition hover:bg-[var(--color-surface)]"
          >
            Run some drills
          </Link>
        </div>

        {/* A small piece of the actual product, rather than a stock illustration. */}
        <div className="mt-14 flex items-end justify-center gap-2">
          {showcase.map((c, i) => (
            <CardView key={c} card={c} size="xl" delay={i * 90} />
          ))}
          <div className="ml-4 mb-1 text-left">
            <p className="eyebrow">Your equity</p>
            <p className="display text-[34px] text-[var(--color-good)]">67.2%</p>
            <p className="text-[12px] text-[var(--color-ink-faint)]">against a top-25% range</p>
          </div>
        </div>
      </section>

      {/* ---- Features ---- */}
      <section className="mt-24 grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Panel key={f.title} className="p-6">
            <h2 className="display text-[24px]">{f.title}</h2>
            <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">{f.body}</p>
          </Panel>
        ))}
      </section>

      {/* ---- How it works ---- */}
      <div className="mt-6">
        <Slab>
          <div className="mx-auto max-w-2xl">
            <p className="eyebrow text-[var(--color-lav)]">How it works</p>
            <h2 className="display mt-3 text-[38px] sm:text-[46px]">
              It doesn’t use a solver.
              <br />
              <em>It just counts.</em>
            </h2>
            <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-[var(--color-paper)]/70">
              <p>
                Serious poker tools grade you against a computed near-perfect strategy. Those are
                expensive to run, and they grade you against an opponent you will never actually meet.
              </p>
              <p>
                This does something simpler. Because the opponents’ strategies are written down, the best
                possible response to them can be worked out by brute force: take the spot you’re in, try
                every action, replay the rest of the hand a few hundred times, and see which one makes the
                most money. No theory involved — the answer is exactly right for the players in front of you.
              </p>
              <p className="text-[var(--color-paper)]">
                And because it knows their strategy, it can run that backwards too. Given that someone just
                bet, it asks which of the 1,326 possible hands would have bet like that — which is exactly
                the reasoning a good player does in their head.
              </p>
            </div>
          </div>
        </Slab>
      </div>

      {/* ---- The one number ---- */}
      <section className="mt-6 rounded-[var(--radius-slab)] bg-[var(--color-felt)] px-6 py-16 text-center text-white sm:px-12">
        <p className="eyebrow text-white/40">The lesson it keeps teaching</p>
        <h2 className="display mx-auto mt-4 max-w-3xl text-[36px] sm:text-[46px]">
          A good decision and a good result
          <br />
          <em>are different things</em>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-white/65">
          Every decision gets two scores: what it was worth against the hands they could have had, and
          what it was worth against the hand they turned out to have. When those disagree, that’s the
          whole lesson — and the app says so explicitly rather than letting you draw the wrong conclusion.
        </p>
      </section>

      <p className="py-12 text-center text-[13px] text-[var(--color-ink-faint)]">
        No account, no server, no cap on hands played.
      </p>
    </div>
  );
}
