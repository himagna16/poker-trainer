import Link from 'next/link';

const FEATURES = [
  {
    title: 'See straight through your opponent',
    body:
      'Turn on full X-ray and you can see their cards, your live odds, what each action is worth, and ' +
      'every hand they could be holding. Then switch the training wheels off one at a time until you are ' +
      'playing blind - by which point you have built the intuition the numbers were teaching.',
  },
  {
    title: 'Every decision graded, with a reason',
    body:
      'After each move you find out exactly what it cost or gained, in big blinds, and why. Not "you ' +
      'should fold here" - the actual price you were getting, how often you win, and how often they fold.',
  },
  {
    title: 'Five opponents worth learning to read',
    body:
      'A rock who folds everything, a station who calls everything, a maniac, and two competent regulars. ' +
      'The same hand is a shove against one and a fold against another. Learning to spot which is which is ' +
      'worth more at a real table than any chart.',
  },
  {
    title: 'The words everyone assumes you know',
    body:
      'Ninety-four terms, defined for someone who genuinely does not know them yet, and wired into the game ' +
      'so the definition appears the moment you flop the boat rather than sitting on a page you never visit.',
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-14">
      <section className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Learn poker without paying tuition to strangers
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-slate-400">
          Most people learn this game by losing money at it. Play against bots you can see through,
          get every decision scored, and find out what the table is actually talking about.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/play"
            className="rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-400"
          >
            Sit down at the table
          </Link>
          <Link
            href="/drills"
            className="rounded-lg border border-white/15 bg-white/5 px-6 py-3 font-semibold text-slate-200 transition hover:bg-white/10"
          >
            Run some drills
          </Link>
        </div>
      </section>

      <section className="mt-16 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="font-semibold text-emerald-300">{f.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-14 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="font-semibold text-slate-100">How it knows what the right play is</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Serious poker tools grade you against a &ldquo;solver&rdquo; - a computed near-perfect strategy.
          Solvers are expensive, and they grade you against an opponent you will never meet.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          This does something simpler and, for learning, more useful. Because the bots&apos; strategies are
          written down, the best possible response to them can be worked out by brute force: take the
          spot you are in, try every action, replay the rest of the hand a few thousand times, and see
          which one actually makes the most money. No theory involved - just counting. The answer is
          exactly right for the opponent sitting in front of you.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Everything runs in your browser. No account, no server, no limit on how many hands you play.
        </p>
      </section>

      <p className="mt-10 text-center text-xs text-slate-600">
        Play money only. Nothing here can be wagered, deposited, or cashed out.
      </p>
    </div>
  );
}
