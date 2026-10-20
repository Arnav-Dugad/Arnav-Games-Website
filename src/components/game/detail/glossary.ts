/**
 * Plain-language explanations for every number on the game page (and the
 * compare table), shown by the ⓘ buttons.
 *
 * One table rather than strings scattered through components, so a metric is
 * explained the same way wherever it appears, and so the explanations can be
 * checked against the code that computes them (`hype.ts`, `market-rules.ts`).
 * Each one says what the number is, its scale, and where it comes from — no
 * jargon the reader has to look up somewhere else.
 */

export interface Help {
  title: string;
  body: string;
  source?: string;
}

export const HELP = {
  critic: {
    title: "Critic score",
    body: "The average of published critic reviews, from 0 to 100. 90+ is exceptional, 75–89 is good, under 60 is weak.",
    source: "IGDB’s critic aggregate (Metacritic for Steam-only records)",
  },
  steamReviews: {
    title: "Steam reviews",
    body: "The share of people who bought the game on Steam and recommend it. Steam’s labels run from “Overwhelmingly Negative” to “Overwhelmingly Positive”.",
    source: "Steam, updated every few minutes",
  },
  playerRating: {
    title: "Player rating",
    body: "The average score players gave the game, out of 5.",
    source: "IGDB member ratings",
  },
  hype: {
    title: "Hype index",
    body: "How much attention an unreleased game gets, from 0 to 100. It blends how many people want to play it, visit its page and follow it. The year’s biggest releases sit near 100.",
    source: "Computed by Arnav Games from IGDB wants, visits and follows",
  },
  timeToBeat: {
    title: "Time to beat",
    body: "How long players said it took them. Main story: just the story. Main + extras: the story plus side content. Completionist: everything, to 100%.",
    source: "Player submissions on IGDB",
  },
  valuePerHour: {
    title: "Cost per hour",
    body: "The price divided by the hours it takes to finish the main story. A rough guide to how much play you get for the money — not a measure of how good it is.",
  },
  playingNow: {
    title: "Playing now",
    body: "People in the game on Steam right now. Players on consoles and other PC stores aren’t counted, so the real number is higher.",
    source: "Steam, sampled every hour by Arnav Games",
  },
  peak: {
    title: "Peaks",
    body: "The most people in the game at the same moment on Steam: in the last 24 hours, and since we started recording. Steam’s all-time peak may be higher.",
  },
  twitch: {
    title: "Twitch viewers",
    body: "People watching live streams of the game on Twitch when we checked, across the most-watched streams.",
    source: "Twitch, sampled by Arnav Games",
  },
  reviewsPerDay: {
    title: "Reviews per day",
    body: "New Steam reviews posted per day, averaged over the last week we recorded. A jump usually means a sale, a big update or renewed buzz.",
    source: "Steam review totals, recorded by Arnav Games",
  },
  first72h: {
    title: "First 3 days",
    body: "Steam reviews posted in the first 72 hours after launch, and how many were positive. Launch problems tend to show up here first.",
  },
  scoreTimeline: {
    title: "Critic score over time",
    body: "How the critic average moved as more reviews were published after launch. Early scores often shift by a few points.",
    source: "IGDB, recorded daily by Arnav Games",
  },
  verdict: {
    title: "Buy or wait",
    body: "Our call from the prices we’ve recorded. Buy: it’s at or near the lowest we’ve seen, or 60%+ off. Wait: it was 25%+ off in the last four months. We need two weeks of history before judging a full price.",
  },
  regional: {
    title: "Prices around the world",
    body: "Steam’s price in other countries, converted to your currency at today’s exchange rate, and how much more or less that is than your price. For comparison only — stores charge your own region’s price.",
    source: "Steam storefronts (refreshed daily), ECB exchange rates via Frankfurter",
  },
  buyingTip: {
    title: "Should I wait?",
    body: "A tip, not a forecast. We weigh today’s discount against the deepest one ever recorded, our own price history, the next Steam seasonal sale, the game’s age and its publisher’s known habits. Confidence is high only when several of those agree.",
    source: "CheapShark (US, all stores), Arnav Games price history, Steam’s sale calendar",
  },
  scoreSpread: {
    title: "Critics vs players",
    body: "Where the critic average sits against what players say. Steam’s figure is the share of positive reviews, not an average score, so a gap with Steam is only called “far” past 15 points. Individual critic scores aren’t available, so there is no range among critics.",
    source: "IGDB (critics and members), Steam reviews",
  },
  releaseConfidence: {
    title: "Will the date hold?",
    body: "Our estimate, 0–100, that the announced date holds: an exact day scores higher than a month or a year, close dates higher than far ones, and past delays — the game’s and its studio’s — count against it. A rule of thumb from public signals, not inside knowledge.",
    source: "IGDB dates, Arnav Games delay history",
  },
  studioRecord: {
    title: "Studio track record",
    body: "The developer’s released games (no DLC or re-releases): their average critic score where at least two critics reviewed them, and how many of the dates we watched were kept.",
    source: "IGDB, Arnav Games delay history",
  },
  deck: {
    title: "Steam Deck",
    body: "Valve’s own test. Verified: runs great out of the box. Playable: works, may need a tweak. Unsupported: doesn’t run.",
    source: "Valve",
  },
  proton: {
    title: "Linux (ProtonDB)",
    body: "How well the Windows version runs on Linux, from player reports. Platinum: perfect. Gold: fine after tweaks. Silver and Bronze: playable with problems. Borked: doesn’t run.",
    source: "ProtonDB",
  },
  achievements: {
    title: "Achievement rarity",
    body: "Achievements grouped by the share of players who unlocked them: common (50%+), uncommon (10–50%), rare (1–10%) and ultra rare (under 1%).",
    source: "Steam global achievement stats",
  },
  willItRun: {
    title: "Will it run?",
    body: "We compare your graphics card, processor, memory and drive with the game’s Steam requirements, and estimate each resolution from how far your card is above the recommended one. Laptop chips are judged at a typical power limit. A rough guide: drivers and updates matter too.",
    source: "Steam’s published PC requirements",
  },
} satisfies Record<string, Help>;

export type HelpTopic = keyof typeof HELP;
