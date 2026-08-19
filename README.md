# Pocket Odds

A poker trainer you can see through. Play No-Limit Hold'em from heads-up to
nine-handed against opponents whose cards, odds and reasoning you can switch on
and off, and get every decision scored in big blinds with an explanation of why.

Everything runs in the browser. No account, no server, no cap on hands played.

```bash
npm install
npm run dev     # http://localhost:3007
npm test        # the full engine test suite
```

## What it does

**Progressive X-ray.** Six overlays that come off one at a time: everyone's hole
cards, your live equity, the pot odds, your outs, the EV of every action, and
each opponent's inferred range on the standard 13×13 grid. Four presets take you
from full X-ray to blind. Decisions are graded either way, so playing blind costs
you help during the hand but not feedback after it.

**Two to nine players, side pots and all.** Heads-up teaches you one game and a
full table teaches you another. Bluffing one opponent who folds 70% of the time
works; bluffing five of them works 17% of the time, and the app shows you that
arithmetic rather than just stating the rule.

**Five opponents worth reading.** A rock who folds everything, a station who
calls everything, a maniac, and two competent regulars — each with a note on how
to beat them. The same 7-high on the same board is a shove against one and a
check against another, and the trainer will tell you so.

**It remembers, and it replays your mistakes.** Every decision graded worse than
"close enough" is saved with the whole situation intact — the cards, the money,
and what each opponent's range looked like at the time — then comes back later
as a drill. Get it right and the next showing moves further out; get it wrong
and it returns sooner. That's spaced repetition, pointed at exactly the gaps you
have rather than the average player's.

Lifetime hands, win rate, decision accuracy and VPIP/PFR persist across sessions
too. All of it lives in your browser: no account, nothing sent anywhere.

**Drills.** Play-or-fold, price check, count-the-outs and guess-the-odds, for
when you want two hundred decisions instead of twenty.

**A glossary that finds you.** 94 terms defined for someone who genuinely
doesn't know them, wired into the game as hover notes so the definition appears
the moment you flop the boat.

## How it decides what's correct

Serious poker tools grade you against a *solver* — a computed near-equilibrium
strategy. Solvers are expensive to run and they grade you against an opponent
you will never actually meet.

This does something simpler. Because the opponents' strategies are written down
in `bots.ts`, the best response to them is computable by brute force: take the
current spot, try every action, replay the rest of the hand a few hundred times
against their real strategy, and see which one makes the most money. No theory —
just counting. The answer is exactly right for the players in front of you.

Two numbers come back, and the gap between them is the point: EV against the
hands they actually held, and EV against everything they could have held. When
those disagree, that *is* the lesson, and the app says so explicitly.

## The interesting parts

**`evaluator.ts`** — packs any 5–7 card hand into a single 24-bit integer where
bigger is strictly better, so comparing hands is one integer compare with no
tie-break logic at the call site. Straight detection is an 8192-entry table
computed at load. Runs at ~18M evaluations/sec, validated by enumerating all
2,598,960 five-card hands: the category frequencies match the known values
exactly and the distinct-hand-strength count comes out at 7,462.

**`engine.ts`** — betting order is expressed with formulas that collapse to the
correct heads-up behaviour instead of branching on player count. Side pots are
built by walking the distinct contribution levels and slicing the money into
layers, which also handles uncalled bets for free: the bettor is simply the only
player eligible for the top layer.

**`equity.ts`** — knows when *not* to simulate. There are only C(45,2) = 990
possible futures on the flop and 44 on the turn, so postflop equity is
enumerated exactly and instantly; only the preflop case (1,712,304 runouts) is
worth sampling. Sampled results always carry a 95% confidence interval.

**`preflopStrength.ts`** — hands are ranked by equity against the top 25% of
hands, *not* against a random hand. Against a random hand K5o beats 76s; against
a range of real hands it's the other way round, because K5o is dominated by
every better king while 76s makes hands nobody sees coming. Ranking the naive
way had the app teaching the opposite of every serious preflop chart.

**`ranges.ts`** — runs the bots' own policy function backwards. For each of the
1,326 possible holdings: how likely was this hand to have played that way?
Multiply through and the range reweights itself. It's Bayes' rule, reusing the
decision function rather than needing a second model of the opponent.

**`spots.ts`** — freezes a decision point small enough to store by the hundred.
Ranges are collapsed from 1,326 weighted combinations to the 169 distinct hand
types, which loses a little card-removal precision and saves roughly forty times
the space. A saved spot is about 7KB, so thousands fit in browser storage.

**`storage.ts`** — reads localStorage through `useSyncExternalStore` rather than
copying it into state from an effect. localStorage is an external system that
can change from another tab; the effect approach renders once with the wrong
data before correcting itself and silently ignores changes made elsewhere. The
same file exposes the clock the same way, so relative times like "ready in 2h"
update on their own and never make a render impure.

**`grade.ts`** — rollout-based best response, using common random numbers across
candidate actions so the *difference* between two options is measured far more
precisely than either absolute value. Fold equity is computed exactly as the
compound chance that every remaining opponent folds.

## Tests

`npm test` runs six suites. The engine one is a fuzzer: 160,000 hands across
every table size with deliberately lopsided stacks, checking that chips are
conserved in every single hand.

| suite | what it proves |
|---|---|
| `test:evaluator` | all 2.6M five-card hands classified correctly; 7,462 distinct strengths |
| `test:equity` | matches published equities; enumeration counts exact; Monte Carlo lands inside its own error bar |
| `test:engine` | 160k fuzzed hands, 88k with side pots, chips conserved; betting order correct at every table size |
| `test:bots` | opening ranges widen 18% → 42% from under the gun to the button; realistic VPIP/PFR; self-consistent win matrix |
| `test:grade` | folding is exactly 0 EV; the same bluff is +14bb against a rock and −13bb against a station; fold equity collapses 55% → 20% as opponents are added |
| `test:drills` | every drill generator terminates and stays fast |
| `test:memory` | a saved spot round-trips to the same verdict, same recommendation and same EV; review intervals lengthen on success and shorten on failure |

## Design

Warm ivory paper, deep desaturated green for the table, near-black grounding
slabs, and one muted lavender accent. Instrument Serif carries display type and
large figures, with emphasis coming from its italic rather than from heavier
weights; Instrument Sans does the interface.

Small numbers deliberately use the sans: Instrument Serif is high-contrast, and
below about 24px the thin horizontal strokes of a zero drop out entirely, so `0`
renders closer to `()`. In an app this full of numbers that isn't a trade worth
making.

## What this isn't

It isn't a solver, and it won't teach you game-theory-optimal play. The bots are
deliberately exploitable, which means the trainer will sometimes recommend an
aggressive line that is correct against *them* and reckless against a real
player — where that happens, the interface says so.

Your history is stored in one browser. It doesn't follow you to another device,
and clearing your browser data clears it.

Play money only. Nothing here can be wagered, deposited, or cashed out.
