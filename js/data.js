// PrimeStake static content: hero slides, games catalogue and marketing
// copy. All live data (matches, odds, bets, wallet) comes from the API.

const GAMES = [
  { name: 'Aviator', tag: 'HOT', cls: 'tile-aviator', note: 'Crash game' },
  { name: 'Plinko X', tag: '', cls: 'tile-plinko', note: 'Instant game' },
  { name: 'Lucky Dice', tag: '', cls: 'tile-dice', note: 'Instant game' },
  { name: 'Penalty Shootout', tag: '', cls: 'tile-penalty', note: 'Instant game' },
  { name: 'Coin Flip', tag: '', cls: 'tile-coin', note: 'Instant game' },
  { name: 'Football Penalty', tag: '', cls: 'tile-footpen', note: 'Instant game' },
];

const HERO_SLIDES = [
  {
    kicker: 'PRIMESTAKE — THE NEXT GENERATION',
    title: 'Back your future star.',
    sub: 'Every match. Every moment.',
    cta: 'Bet now',
    img: 'assets/hero-striker.jpg',
  },
  {
    kicker: 'AVIATOR — FLY HIGHER',
    title: 'Cash out before it flies away.',
    sub: 'The crash game everyone is playing, coming to the Games lobby.',
    cta: 'See Games',
    img: 'assets/hero-plane.jpg',
  },
  {
    kicker: 'LIVE BETTING',
    title: 'Every second counts.',
    sub: 'Live odds and live drama — follow it as it happens.',
    cta: 'Bet Live',
    img: 'assets/hero-keeper.jpg',
  },
];

const PROMOS = [
  { title: 'Welcome Bonus', tag: 'NEW PLAYERS', body: 'New accounts get a welcome bonus on their first confirmed deposit. Bonus terms, wagering requirements and expiry are shown in the Wallet when the offer is active on your account.' },
  { title: 'Acca Boost', tag: 'FOOTBALL', body: 'Winning accumulators earn a boost on top of the ticket odds — the more legs on your slip, the bigger the boost. Applies to pre-match football accumulators.' },
  { title: 'MoMo Deposit Days', tag: 'WALLET', body: 'Deposit with MTN MoMo on promo days and earn free-bet credit on confirmed deposits. Watch this page and the Wallet for the next deposit day.' },
];

const FAQS = [
  { q: 'How do I deposit?', a: 'Open Wallet and choose Manual Deposit. Send the amount by MTN MoMo to the number shown, check the name on the confirmation screen matches before you enter your PIN, then submit the confirmation form with your transaction ID. Your balance is credited once the payment is confirmed.' },
  { q: 'When can I withdraw?', a: 'Withdrawal requests are reviewed and paid to your mobile money account. If a withdrawal is not available on your account yet, contact support and the team will help you.' },
  { q: 'How long do withdrawals take?', a: 'Requests are reviewed in the order they arrive. Once approved, mobile money payouts are sent to the number on your account.' },
  { q: 'What is a slip code?', a: 'A code that recreates a set of selections on another device or account. Generate one from your betslip, or load a code someone shared with you.' },
  { q: 'How do I verify a bet?', a: 'Open Verify Bet, enter the bet code from your ticket (for example PB-XXXXXX) and the selections and status are shown.' },
];
