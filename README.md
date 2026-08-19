# Pocket Odds

A poker trainer you can see through. Play heads-up No-Limit Hold'em against bots
whose cards, odds, and reasoning you can switch on and off, and get every
decision scored in big blinds with an explanation of why.

Everything runs in the browser. No account, no server, no cap on hands played.

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # the full engine test suite
```

## What it does

**Progressive X-ray.** Six overlays that come off one at a time: their hole
cards, your live equity, the pot odds, your outs, the EV of every action, and
their inferred range on the standard 13x13 grid. Start with everything visible
and you can watch the machinery of the game directly; switch things off as they
start to feel obvious. Decisions are graded either way, so playing blind costs
you help during the hand but not feedback after it.

**Five opponents worth reading.** A rock who folds everything, a station who
calls everything, a maniac, and two competent regulars — each with a written
note on how to beat them. The same 7-high on the same board is a profitable
shove against one and a clear check against another, and the trainer will tell
you so.

**Drills.** Play-or-fold, price check, count-the-outs, and guess-the-odds, for
when you want two hundred decisions instead of twenty.

**A glossary that finds you.** 94 terms defined for someone who genuinely
doesn't know them, wired into the game as hover tooltips so the definition
appears the moment you flop the boat.

## How it decides what's correct

Serious poker tools grade you against a *solver* — a computed near-equilibrium
strategy. Solvers are expensive to run and they grade you against an opponent
you will never actually meet.

This does something simpler. Because the bots' strategies are written down in
`bots.ts`, the best response to them is computable by brute force: take the
current spot, try every action, replay the rest of the hand a few hundred times
against their real strategy, and see which one makes the most money. No theory —
just counting. The answer is exactly right for the opponent in front of you,
and learning to exploit a specific player type is closer to what wins money at a
live table than equilibrium play is.

Two numbers come back, and the gap between them is the point: EV against the
hand they actually held, and EV against everything they could have held. When
those disagree, that *is* the lesson.

## The interesting parts

**`evaluator.ts`** — packs any 5–7 card hand into a single 24-bit integer where
bigger is strictly better, so comparing hands is one integer compare with no
tie-break logic at the call site. Straight detection is an 8192-entry table
computed at load. Runs at ~18M evaluations/sec, validated by enumerating all
2,598,960 five-card hands: the category frequencies match the known values
exactly and the distinct-hand-strength count comes out at 7,462.

**`equity.ts`** — knows when *not* to simulate. There are only C(45,2) = 990
possible futures on the flop and 44 on the turn, so postflop equity is
enumerated exactly and instantly; only the preflop case (1,712,304 runouts) is
worth sampling. Sampled results always carry a 95% confidence interval.

**`ranges.ts`** — runs the bots' own policy function backwards. For each of the
1,326 possible holdings: how likely was this hand to have played that way?
Multiply through and the range reweights itself. It's Bayes' rule, reusing the
decision function rather than needing a second model of the opponent.

**`grade.ts`** — rollout-based best response, using common random numbers across
candidate actions so the *difference* between two options is measured far more
precisely than either absolute value. Also computes fold equity exactly, which
is the number that explains why betting a weak hand can beat checking.

## Tests

`npm test` runs six suites. The engine one is a fuzzer: 100,000 hands of random
legal play, checking that chips are conserved in every single hand.

| suite | what it proves |
|---|---|
| `test:evaluator` | all 2.6M five-card hands classified correctly; 7,462 distinct strengths |
| `test:equity` | matches published equities; enumeration counts are exact; Monte Carlo lands inside its own error bar |
| `test:engine` | 100k fuzzed hands, chips conserved, no illegal states |
| `test:bots` | personas produce realistic VPIP/PFR/WTSD and a self-consistent win matrix |
| `test:grade` | folding is exactly 0 EV; the same bluff flips from +11.8bb to −13.8bb between opponents |
| `test:drills` | every drill generator terminates and stays fast |

## What this isn't

It isn't a solver, and it won't teach you game-theory-optimal play. It's
heads-up only. The bots are deliberately exploitable, which means the trainer
will sometimes recommend an aggressive line that is correct against *them* and
reckless against a real player — where that happens, the interface says so.

Play money only. Nothing here can be wagered, deposited, or cashed out.
