---
colors:
  bg: "#f4f4f2"
  surface: "#ffffff"
  ink: "#141414"
  header-bg: "#0b0b0b"
  header-ink: "#f5f5f5"
  card-dark: "#1c1c1e"
  accent: "#f5c518"
  accent-ink: "#141414"
  live: "#d8232a"
  win: "#1e9e57"
  muted: "#6f6f6f"
  line: "#e3e3df"
  odds-bg: "#efefec"
  odds-selected-bg: "#f5c518"
typography:
  font-family: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
  hero-size: "34px"
  h-size: "15px"
  body-size: "14px"
  small-size: "12px"
spacing:
  page-pad: "16px"
  gap: "10px"
radii:
  card: "10px"
  chip: "999px"
  button: "8px"
---

# Design

## Overview

A dark-and-gold sportsbook. The header is black, the body is light,
match cards are white with dark text, and gold is the single accent:
register, calls to action, selected filters, selected odds. Red is
reserved for live play only. The first screen says what the product
is — online sports betting and casino — in the hero headline.

## Colors

Gold (`accent`) means "act here": Register, Bet now, the selected
chip, the selected odd. Red (`live`) means "happening now" and is
never decorative. Dark cards (`card-dark`) carry the ticker and the
games area so the light match list stays the reading surface.

## Typography

One system sans stack everywhere; weight and size carry hierarchy.
Match rows are compact (14px) so long fixture lists stay scannable;
the hero headline is the only display-size text.

## Layout

Single centered column, max 1180px, no sidebars — matching the
source site. The betslip is a floating button that opens a right
drawer; it never takes layout space until asked for.

## Elevation & Depth

Flat by default. The drawer, modals and the Aviator panel sit on a
dimmed overlay; cards use a 1px line instead of shadows.

## Shapes

Chips are pills, buttons and cards are softly rounded (8–10px).
Odds are three equal buttons grouped as one control.

## Components

OddsButton has three states: default (pale), hover, selected (gold).
MatchRow keeps league, fixture and odds on one line on desktop and
stacks on mobile. GameTile is a gradient panel with the game name;
no external artwork is used.

## Do's and Don'ts

- Do keep gold scarce so selection state stays readable.
- Do keep live red only on live groups and live indicators.
- Don't invent promotions, partners or licence lines; the source
  site shows none publicly, so the clone shows none.
- Don't fake working backends; demo actions end in a toast that
  says so.
