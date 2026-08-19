/**
 * glossary.ts - the vocabulary.
 *
 * Poker has an unusually dense private language, and it's a real barrier. When
 * someone says they "flopped the boat but got rivered by the backdoor nut
 * flush", a new player hears noise - and, worse, can't tell whether the sentence
 * contains anything they needed to know.
 *
 * Two things matter about how this is built. First, the definitions assume you
 * know nothing, and never explain a term using three other undefined terms.
 * Second, every entry carries the plain-language version of what it MEANS for
 * your decisions, not just what it refers to.
 *
 * These entries do double duty: they fill the glossary page, and they power the
 * tooltips that appear inside hand commentary. Reading "you flopped a set" with
 * the word live and hoverable, at the moment it happens to you, is worth far
 * more than reading the same definition on a list.
 */

export type GlossaryCategory =
  | 'The deal'
  | 'Position'
  | 'Actions'
  | 'Hands'
  | 'Draws'
  | 'Strategy'
  | 'Player types'
  | 'Slang'
  | 'Stats';

export interface GlossaryEntry {
  term: string;
  /** Other spellings that should trigger the same tooltip. */
  aliases?: string[];
  category: GlossaryCategory;
  short: string;
  /** Why it matters when you're actually playing. */
  why?: string;
  example?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  // ---------- The deal ----------
  { term: 'Hole cards', aliases: ['hole card', 'pocket cards'], category: 'The deal',
    short: 'The two cards dealt face down that only you can see.',
    example: 'You look down at two aces - those are your hole cards.' },
  { term: 'Community cards', aliases: ['the board', 'board'], category: 'The deal',
    short: 'The five shared cards in the middle. Everyone uses them.',
    why: 'You make your best five-card hand from any mix of your two cards and these five.' },
  { term: 'Flop', category: 'The deal',
    short: 'The first three community cards, dealt all at once.',
    why: 'The biggest information jump in the hand. Your two cards go from a guess to a real hand.' },
  { term: 'Turn', aliases: ['fourth street'], category: 'The deal',
    short: 'The fourth community card.',
    why: 'Bets usually get bigger here, and there is only one card left to improve.' },
  { term: 'River', aliases: ['fifth street'], category: 'The deal',
    short: 'The fifth and final community card.',
    why: 'No cards left to come, so draws are now worthless. A hand that was "almost there" is now just nothing.' },
  { term: 'Showdown', category: 'The deal',
    short: 'When remaining players turn their cards up and the best hand wins.' },
  { term: 'Muck', category: 'The deal',
    short: 'To throw your hand away face down, or the pile of discarded cards.' },
  { term: 'Preflop', category: 'The deal',
    short: 'Everything that happens before the flop is dealt.' },
  { term: 'Postflop', category: 'The deal',
    short: 'Everything from the flop onward.' },
  { term: 'Street', category: 'The deal',
    short: 'One round of betting. Preflop, flop, turn and river are the four streets.' },

  // ---------- Position ----------
  { term: 'Button', aliases: ['the button', 'dealer button'], category: 'Position',
    short: 'The seat that acts last after the flop. The best seat at the table.',
    why: 'Acting last means you see what everyone does before you decide. It is worth real money - the button is the most profitable seat in poker by a wide margin.' },
  { term: 'Small blind', category: 'Position',
    short: 'A forced bet posted before cards are dealt, half the size of the big blind.' },
  { term: 'Big blind', aliases: ['bb'], category: 'Position',
    short: 'The larger forced bet, and the unit everything else is measured in.',
    why: 'Stacks and results are always quoted in big blinds so they mean the same thing at any stake.' },
  { term: 'In position', aliases: ['ip'], category: 'Position',
    short: 'Acting after your opponent on every remaining street.' },
  { term: 'Out of position', aliases: ['oop'], category: 'Position',
    short: 'Having to act before your opponent. Harder, and worth less money.' },
  { term: 'Under the gun', aliases: ['utg'], category: 'Position',
    short: 'First to act before the flop. The worst seat, so play tighter here.' },
  { term: 'Cutoff', category: 'Position',
    short: 'The seat directly to the right of the button. Second-best position.' },

  // ---------- Actions ----------
  { term: 'Check', category: 'Actions',
    short: 'Pass the action without betting, keeping your hand. Only possible if nobody has bet.' },
  { term: 'Call', category: 'Actions', short: 'Match the current bet to stay in the hand.' },
  { term: 'Raise', category: 'Actions', short: 'Increase the bet, forcing others to pay more to continue.' },
  { term: 'Fold', category: 'Actions', short: 'Give up your hand and any money already in the pot.' },
  { term: 'Limp', category: 'Actions',
    short: 'Just calling the big blind before the flop instead of raising.',
    why: 'Usually weak. You give up the chance to win it immediately and you tell everyone your hand is mediocre.' },
  { term: '3-bet', aliases: ['three-bet', '3bet'], category: 'Actions',
    short: 'The second raise. The blind is the first bet, a raise is the second, a re-raise is the third.',
    why: 'A 3-bet is a strong signal. Against most players it means a genuinely good hand.' },
  { term: '4-bet', aliases: ['four-bet'], category: 'Actions',
    short: 'Re-raising a 3-bet. Almost always aces, kings, or a deliberate bluff.' },
  { term: 'Continuation bet', aliases: ['c-bet', 'cbet'], category: 'Actions',
    short: 'Betting the flop after you were the one who raised before it.',
    why: 'You claimed strength preflop, so keeping up the story wins a lot of pots outright - whether or not the flop helped you.' },
  { term: 'Check-raise', category: 'Actions',
    short: 'Checking, letting your opponent bet, then raising them.',
    why: 'One of the strongest moves in poker, and it works both as a trap with a big hand and as a bluff.' },
  { term: 'Donk bet', category: 'Actions',
    short: 'Betting into the player who raised before the flop, out of position.' },
  { term: 'All in', aliases: ['shove', 'jam', 'ship it'], category: 'Actions',
    short: 'Betting every chip you have left.' },
  { term: 'Slow play', aliases: ['trap'], category: 'Actions',
    short: 'Deliberately playing a huge hand weakly to keep your opponent betting.' },

  // ---------- Hands ----------
  { term: 'The nuts', aliases: ['nuts', 'nut'], category: 'Hands',
    short: 'The best possible hand given the board. Literally cannot be beaten.',
    why: 'Knowing whether you hold the nuts - and whether someone else could - is the single most important read on any board.',
    example: 'On 7-8-9-J-Q, holding 10-K is the nuts: the highest possible straight.' },
  { term: 'Full house', aliases: ['boat', 'full boat', 'the boat', 'flop the boat'], category: 'Hands',
    short: 'Three of one rank plus a pair. "Kings full of fours" means three kings and two fours.',
    why: 'Beats a flush and a straight. "Flopping the boat" means making it immediately on the flop, which is rare and very strong.' },
  { term: 'Flush', aliases: ['the flush'], category: 'Hands',
    short: 'Five cards of the same suit.',
    why: 'Beats a straight, loses to a full house. Watch whether yours is the high one - second-best flushes lose enormous pots.' },
  { term: 'Straight', category: 'Hands',
    short: 'Five cards in a row, any suits. Aces play high or low.' },
  { term: 'Set', category: 'Hands',
    short: 'Three of a kind made with a pocket pair plus one matching card on the board.',
    why: 'The most profitable hand shape in poker - completely hidden, so opponents pay you off. Distinct from trips.' },
  { term: 'Trips', category: 'Hands',
    short: 'Three of a kind made with one card in your hand and a pair on the board.',
    why: 'Weaker than a set, because everyone can see the pair and will slow down.' },
  { term: 'Quads', aliases: ['four of a kind'], category: 'Hands', short: 'All four cards of the same rank.' },
  { term: 'Kicker', category: 'Hands',
    short: 'Your unmatched side card, used to break ties.',
    why: 'Where beginners lose the most money. Ace-four and ace-king both make a pair of aces - and the four loses every time.' },
  { term: 'Top pair', category: 'Hands', short: 'Pairing the highest card on the board.' },
  { term: 'Overpair', category: 'Hands',
    short: 'A pocket pair higher than every card on the board.',
    example: 'Holding queens on a 9-6-2 flop.' },
  { term: 'Pocket pair', category: 'Hands', short: 'Two cards of the same rank dealt to you.' },
  { term: 'Suited connectors', category: 'Hands',
    short: 'Two consecutive cards of the same suit, like 7-8 of hearts.',
    why: 'Rarely win, but win big when they do - they make straights and flushes that opponents cannot see coming.' },
  { term: 'Broadway', category: 'Hands', short: 'A ten-to-ace straight, the highest one. Also any face card.' },
  { term: 'The wheel', aliases: ['wheel', 'bicycle'], category: 'Hands',
    short: 'The straight A-2-3-4-5, where the ace counts as low. The weakest straight.' },
  { term: 'Rags', aliases: ['air'], category: 'Hands', short: 'Worthless cards. "Air" means you have nothing at all.' },

  // ---------- Draws ----------
  { term: 'Outs', aliases: ['out'], category: 'Draws',
    short: 'The specific cards left in the deck that would give you the winning hand.',
    why: 'Counting outs is the first real skill in poker. It turns "I might get there" into a number you can compare against the price.' },
  { term: 'Flush draw', category: 'Draws',
    short: 'Four cards of the same suit, needing one more.',
    why: 'Nine outs. Roughly 35% to complete from the flop, 19% from the turn.' },
  { term: 'Open-ended straight draw', aliases: ['open-ender', 'oesd'], category: 'Draws',
    short: 'Four in a row that can be completed at either end. Eight outs.' },
  { term: 'Gutshot', aliases: ['inside straight draw', 'belly buster'], category: 'Draws',
    short: 'A straight draw missing one card in the middle. Only four outs.',
    why: 'Half as good as an open-ender. Rarely worth calling a big bet on its own.' },
  { term: 'Backdoor', aliases: ['runner-runner', 'running'], category: 'Draws',
    short: 'Needing both the turn AND the river to complete a hand.',
    why: 'About 4% to get there. Nearly worthless on its own, but real when added to another draw.' },
  { term: 'Combo draw', category: 'Draws',
    short: 'A flush draw and a straight draw at once. Sometimes a favourite even against a made hand.' },
  { term: 'Brick', aliases: ['blank'], category: 'Draws',
    short: 'A card that changes nothing and helps nobody.' },
  { term: 'Drawing dead', category: 'Draws',
    short: 'No card can save you - you have already lost, whatever comes.' },

  // ---------- Strategy ----------
  { term: 'Pot odds', category: 'Strategy',
    short: 'The price you are getting: what you must call versus what you stand to win.',
    why: 'If there is $100 in the pot and you must call $50, you are risking 50 to win 150, so you need to win 33% of the time. Compare that to your equity - more, call; less, fold.' },
  { term: 'Equity', category: 'Strategy',
    short: 'Your share of the pot on average - how often you win if the hand played out from here.',
    example: 'A flush draw on the flop has roughly 35% equity against a made pair.' },
  { term: 'Expected value', aliases: ['ev', '+ev', '-ev'], category: 'Strategy',
    short: 'What a decision is worth on average over many repetitions.',
    why: 'The only real measure of whether you played well. A +EV call that loses this time was still correct.' },
  { term: 'Implied odds', category: 'Strategy',
    short: 'The money you expect to win LATER if you hit your draw, not just what is in the pot now.',
    why: 'Justifies calling with draws that pot odds alone would not - if your opponent will pay you off when you get there.' },
  { term: 'Reverse implied odds', category: 'Strategy',
    short: 'The money you will lose later when you make your hand and it is still second best.',
    example: 'Chasing a low flush is dangerous - when it comes in, the higher flush takes your whole stack.' },
  { term: 'Fold equity', category: 'Strategy',
    short: 'The value that comes purely from your opponent folding.',
    why: 'It is why betting beats checking with a weak hand: you have two ways to win instead of one.' },
  { term: 'Range', category: 'Strategy',
    short: 'All the hands a player could have right now, weighted by how likely each is.',
    why: 'The real leap in poker thinking. Stop asking "what does he have" and start asking "what could he have, and how often".' },
  { term: 'Minimum defense frequency', aliases: ['mdf'], category: 'Strategy',
    short: 'How often you must keep playing against a bet so your opponent cannot profit by bluffing everything.',
    why: 'Against a half-pot bet you must continue with about 67% of your hands. Against a pot-sized bet, only 50%. Bigger bets buy the right to bluff more.' },
  { term: 'Value bet', category: 'Strategy',
    short: 'Betting a strong hand hoping to be called by something worse.' },
  { term: 'Bluff', category: 'Strategy',
    short: 'Betting a weak hand hoping a better one folds.' },
  { term: 'Semi-bluff', category: 'Strategy',
    short: 'Betting a draw: you might win right now if they fold, and you still have outs if they call.',
    why: 'The best kind of bluff, because it has two ways to work.' },
  { term: 'Blocker', category: 'Strategy',
    short: 'A card in your hand that makes it less likely your opponent holds something specific.',
    example: 'Holding the ace of spades means they cannot have the nut spade flush.' },
  { term: 'Polarized', category: 'Strategy',
    short: 'A range made of only very strong hands and pure bluffs, with nothing in between.',
    why: 'Big bets and overbets usually mean a polarized range.' },
  { term: 'Stack-to-pot ratio', aliases: ['spr'], category: 'Strategy',
    short: 'Your remaining stack divided by the pot. Low means committed, high means room to manoeuvre.' },
  { term: 'Pot committed', category: 'Strategy',
    short: 'Having so much already in the pot that folding is mathematically wrong.' },
  { term: 'Thin value', category: 'Strategy',
    short: 'Betting a hand that is only just ahead, to squeeze out a little extra.' },
  { term: 'Dry board', category: 'Strategy',
    short: 'A flop with few draws available, like K-7-2 with mixed suits.' },
  { term: 'Wet board', aliases: ['coordinated board'], category: 'Strategy',
    short: 'A flop full of possible straights and flushes, like 9-8-7 all hearts.',
    why: 'Bet bigger on wet boards - you need to charge the draws.' },

  // ---------- Player types ----------
  { term: 'Nit', aliases: ['rock'], category: 'Player types',
    short: 'An extremely tight player who only plays premium hands.',
    why: 'Bluff them relentlessly. But when they finally raise, believe them.' },
  { term: 'Calling station', category: 'Player types',
    short: 'A player who calls far too much and folds almost nothing.',
    why: 'Never bluff them. Just bet your good hands bigger - they will pay.' },
  { term: 'Maniac', category: 'Player types',
    short: 'A wildly aggressive player who raises with anything.',
    why: 'Stop bluffing, start trapping. Let them bet for you and call down lighter than feels comfortable.' },
  { term: 'TAG', aliases: ['tight-aggressive'], category: 'Player types',
    short: 'Tight and aggressive - the standard winning style.' },
  { term: 'LAG', aliases: ['loose-aggressive'], category: 'Player types',
    short: 'Loose and aggressive. Plays many hands and applies constant pressure.' },
  { term: 'Fish', aliases: ['whale', 'donk'], category: 'Player types',
    short: 'A weak player. If you cannot spot the fish at the table, it is you.' },
  { term: 'Shark', aliases: ['reg', 'regular'], category: 'Player types',
    short: 'A strong, experienced winning player.' },

  // ---------- Slang ----------
  { term: 'Bad beat', category: 'Slang',
    short: 'Losing with a strong hand to someone who got lucky.',
    why: 'Happens constantly and means nothing about how well you played. Judge decisions, not results.' },
  { term: 'Cooler', category: 'Slang',
    short: 'A hand where both players had something huge and losing was unavoidable.' },
  { term: 'Tilt', category: 'Slang',
    short: 'Playing badly because you are upset. Loses more money than bad strategy ever will.' },
  { term: 'Suckout', aliases: ['rivered', 'river someone'], category: 'Slang',
    short: 'Hitting a lucky card to beat a hand that was well ahead.' },
  { term: 'Hero call', category: 'Slang',
    short: 'Calling a big bet with a weak hand because you read them for a bluff.' },
  { term: 'Snap call', category: 'Slang', short: 'Calling instantly, with no thought needed.' },
  { term: 'Dead money', category: 'Slang', short: 'Chips in the pot from players who have already folded.' },
  { term: 'Run good', aliases: ['run bad', 'variance'], category: 'Slang',
    short: 'Short-term luck. Real, unavoidable, and no reflection of skill.' },
  { term: 'Bink', category: 'Slang', short: 'To hit a card you needed, usually unexpectedly.' },
  { term: 'Action', category: 'Slang', short: 'Betting and raising. An "action board" produces big pots.' },

  // ---------- Stats ----------
  { term: 'VPIP', category: 'Stats',
    short: 'Voluntarily Put money In Pot - how often a player pays to see a flop.',
    why: 'The quickest read there is. Under 20% is tight, over 40% is loose.' },
  { term: 'PFR', category: 'Stats',
    short: 'PreFlop Raise - how often they raise before the flop.',
    why: 'Compare it to VPIP. A big gap between the two means a passive caller.' },
  { term: 'WTSD', category: 'Stats',
    short: 'Went To ShowDown - how often they see a showdown after seeing a flop.',
    why: 'Above 30% suggests a calling station who will not let go.' },
  { term: 'bb/100', category: 'Stats',
    short: 'Big blinds won per 100 hands - the standard measure of results.',
    why: 'A strong live player makes 5-10 bb/100. Anything above 20 is either a very soft game or a small sample.' },
  { term: 'Aggression factor', aliases: ['af'], category: 'Stats',
    short: 'Bets and raises divided by calls. High means aggressive, near zero means passive.' },
];

/** Fast lookup by term or alias, all lower-cased. */
export const GLOSSARY_INDEX: Map<string, GlossaryEntry> = (() => {
  const map = new Map<string, GlossaryEntry>();
  for (const entry of GLOSSARY) {
    map.set(entry.term.toLowerCase(), entry);
    for (const alias of entry.aliases ?? []) map.set(alias.toLowerCase(), entry);
  }
  return map;
})();

export const CATEGORIES: GlossaryCategory[] = [
  'The deal', 'Position', 'Actions', 'Hands', 'Draws', 'Strategy', 'Player types', 'Slang', 'Stats',
];

export function lookup(term: string): GlossaryEntry | undefined {
  return GLOSSARY_INDEX.get(term.trim().toLowerCase());
}

/**
 * All lookup keys, longest first.
 *
 * Order matters when we scan commentary for terms to highlight: we must match
 * "open-ended straight draw" before "straight", or we'd wrongly tag the inner
 * word and mangle the phrase.
 */
export const GLOSSARY_KEYS: string[] = [...GLOSSARY_INDEX.keys()].sort((a, b) => b.length - a.length);
