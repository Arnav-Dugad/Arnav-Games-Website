# Arnav Games design system

The bar is Apple's own apps (App Store, Apple TV, Music, Health): content
first, one clear action per view, calm surfaces, motion that explains. Every
page should feel like part of one product. When in doubt, remove.

## Principles

1. **Content is the interface.** Cover art, logos and numbers carry the page.
   Chrome (borders, labels, icons) is quiet and only appears where it helps.
2. **One hero per view.** Each page has a single focal element above the fold
   (the game's art, the next release, your library's headline number). Do not
   stack competing heroes.
3. **Hierarchy through type and space, not boxes.** Prefer large titles,
   generous spacing and grouping over nested cards. A card inside a card is a
   smell; a grouped list (iOS Settings style) usually is the answer.
4. **Progressive disclosure.** Show the 20% people need; tuck the rest into
   sheets, "See all" pages, collapsibles and detail views. Filters start
   collapsed.
5. **Honest data.** Never fabricate. Missing data hides its tile or shows a
   designed empty state with a next step — never "N/A" or a zero that lies.
6. **Touch and pointer are different targets.** Phones get thumb-reachable
   actions, bottom sheets, swipe; desktop gets hover, popovers, keyboard.
   Use the `fine:` / `coarse:` variants, not just breakpoints.
7. **Motion has a job**: orient (where did this come from), confirm (it
   worked), or delight once. Springs, not linear tweens. Always honour
   reduced motion (`useReducedMotion`, `useRichMotion`, `data-reduce-motion`).

## Tokens (see `src/app/globals.css`)

- Surfaces: `bg` (page), `bg-elev`, `panel` (grouped cell), `panel-2` (raised control).
- Text: `text` (primary), `muted` (secondary), `faint` (tertiary/labels).
- Lines: `line`, `line-strong`. Neutral tints: `fg/[0.04–0.14]` — never
  hard-code `white`/`black` on page surfaces (light theme flips `fg`).
- Accents: `brand` (primary action), `brand-soft` (accent text), `neon`
  (info/live), `mint` (success/owned), `gold` (hype/warning), `flare`
  (destructive/delayed). Use at most one accent per component.
- Materials: `.glass` (grouped panel, no blur), `.material` (floating chrome
  with blur: header, tab bar, sheets, menus), `.material-thin` (controls over
  imagery), `.material-menu` (near-opaque menus in light).
- Always-dark surfaces (heroes over art) set `data-stage="dark"`; use white
  text there and `GameLogo surface="dark"`.
- Radii: `rounded-xl` controls (16px), `rounded-2xl` cards (22px),
  `rounded-3xl` large panels (28px), `rounded-full` pills/buttons.
- Pressed state: `.press`. Focus: the global focus ring — don't remove it.

## Type scale

| Role | Classes |
| --- | --- |
| Page large title | `font-display text-[34px] sm:text-5xl font-bold tracking-[-0.03em]` |
| Section title | `text-[22px] sm:text-[28px] font-bold tracking-[-0.02em]` |
| Card title | `text-[17px] font-semibold` |
| Body | `text-[15px] sm:text-[17px] leading-relaxed text-muted` |
| Caption / label | `text-[13px] text-muted` or `text-[11px] font-semibold uppercase tracking-[0.06em] text-faint` |
| Big number | `font-display tabular-nums font-bold` |

Use `tabular-nums` for all changing numbers. Use sentence case everywhere.

## Layout

- `Container` (max 1400px, 16/24/40px gutters). Rails bleed full-width with
  `.snap-rail .rail-gutter` and are NOT wrapped in `Container`.
- Section rhythm: `py-9 sm:py-12 lg:py-16`; heading → content gap `mt-6 sm:mt-7`.
- Grids: 2 columns on phones for covers, 3–6 on desktop. Bento grids reflow
  2 → 4 columns; tiles span by importance; no holes.
- Page headers: large title + one-line description; actions on the right on
  desktop, below on phones. Sticky in-page navigation (segmented control) for
  long pages.
- Phones: content must clear the floating tab bar (body already pads), every
  tap target ≥ 44px, no horizontal overflow at 320px.

## Components to reuse (don't rebuild)

`Button`, `Chip`/`Badge`, `Sheet`, `Popover`, `Toast`, `Collapsible`,
`ExpandableText`, `ScoreRing`/`ScorePill`, `SectionHeading`, `Container`,
`PageHeader`, `EmptyState`, `Skeleton*`, `GameCard`, `PosterTile`, `GameRail`,
`GameGrid`, `GameLogo`, `GameCover`, `Countdown`, filters
(`src/components/filters`: FilterToolbar, FacetButton, SortMenu,
SegmentedControl, SearchField, LinkSwitch), motion (`Reveal`, `Stagger`,
`CountUp`), interactions (`ContextMenu` via `useGameMenuTarget`, `CoverFlow`,
`haptic()`).

## States

Every data view designs four states: loading (skeleton that matches the final
layout), empty (icon, one sentence, one action), error/unavailable (honest,
with retry when sensible), and populated. Signed-out views explain the value
and offer sign in.

## Writing

Short, specific, human. Titles describe, buttons are verbs ("Follow",
"Show 24 games"). No exclamation marks, no "Oops". Numbers with units and
context ("119 h to finish", "3× delayed since Aug").
