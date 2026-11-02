# PrimeStake — Architecture

Original PrimeStake sportsbook front-end, built 2026-11-01 following the
page/feature inventory of a modern sportsbook app. Static single-page
app: no build step, no backend. Demo data only — see README.

## Files

- `index.html` — app shell: header, nav, hero, filters, views, betslip
  drawer, auth modal, aviator panel, toast. Loads the CSS and JS below.
- `css/styles.css` — all styling. Every colour/font is a `:root` token.
- `js/data.js` — demo data: matches (live/upcoming/finished), games,
  winners ticker entries, hero slides.
- `js/app.js` — view routing, rendering, filters, search, betslip state,
  modals, ticker, carousel, loaders, toasts.
- `assets/hero-stadium.jpg` — generated hero artwork (generic stadium,
  no real player's likeness).
- `DESIGN.md` — design contract (tokens + usage prose).
- `README.md` — run instructions + non-functioning backend list.

## Components (all reusable, rendered from js/app.js)

- Header — logo, primary nav, Login/Register actions.
- NavTabs — Home, Live, Sports, Games, Virtual, ME Profile views.
- HeroCarousel — 2-slide auto-advance hero; first screen states the
  product: online sports betting and casino.
- QuickActions — Soccer, Today, Aviator, Basketball, Verify Bet,
  Booking Codes, All.
- FilterBar — sport chips, market chips, date chips, SearchBox.
- WinnersTicker — scrolling demo winners strip.
- MatchGroup / MatchRow — league, teams, minute/score or kick-off,
  1/X/2 OddsButtons, "+N markets" tag.
- OddsButton — toggles a selection in the betslip.
- GamesGrid / GameTile — Aviator, Plinko X, Lucky Dice, Penalty
  Shootout, Coin Flip, Football Penalty.
- AviatorPanel — mock game overlay: multiplier history strip, bet panel;
  play is gated behind the auth modal.
- BetslipDrawer — selections, remove/clear, stake input, total odds,
  potential win, Place Bet (demo toast).
- AuthModal — Login/Register tabs, phone + password (Ghana format),
  "Forgot Password?" link. Gates: ME Profile, Verify Bet, Booking
  Codes, Aviator play.
- Toast — demo notices (e.g. "Demo build — no backend connected").
- SkeletonLoader — brief shimmer while a view "loads" on tab switch.

## Features

- Views: Home (live + upcoming combined), Live, Sports (upcoming by
  date), Games, Virtual (V-Soccer filter on the match list), ME Profile
  (auth-gated).
- Filtering: sport, market (1X2, Over/Under, Double Chance, GG/NG,
  BTTS), date (All/Today/Live/Tomorrow/Finished), text search on teams
  and leagues. Match counts update live.
- Betslip: multi-select odds, count badge on the floating button,
  stake math (total odds, potential return), clear all.
- Auth: front-end only. Any phone + password "logs in" locally and
  unlocks the gated entries with a demo profile header state; nothing
  is sent anywhere.
- Games: tiles render; Aviator opens its mock panel; all play actions
  route to the auth modal or a demo toast.

## User flow

LANDING (Home) → hero states the product → browse ticker + matches →
filter by sport/market/date or search → click odds → BetslipDrawer →
enter stake → Place Bet → demo toast (no backend).
Any gated action (ME Profile, Verify Bet, Booking Codes, Aviator
play) → AuthModal → local demo login → back to the action.

## Admin / backend (in mind, not built)

Roles on the real product would be User and Admin (odds management,
user management, settlements). None of that exists in a static clone;
it is listed in README as non-functioning rather than faked. Caching,
rate limiting and load balancing are server concerns and are likewise
out of scope for this front-end export.
