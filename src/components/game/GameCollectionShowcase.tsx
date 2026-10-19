import Link from "next/link";
import {
  ArrowUpRight,
  Box,
  Boxes,
  Layers3,
  PackageOpen,
  Puzzle,
  RefreshCcw,
  Repeat2,
  Sparkles,
} from "lucide-react";
import { GameCover } from "./GameCover";
import { DARK_STAGE_STYLE } from "./detail/theme";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { Badge } from "@/components/ui/Badge";
import { ScorePill } from "@/components/ui/ScoreRing";
import { releaseLabel } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { GameDetail, GameSummary, Ref } from "@/lib/games/types";

type Tone = "brand" | "mint" | "gold" | "neon" | "flare";

interface RelationGroup {
  eyebrow: string;
  title: string;
  description: string;
  label: string;
  requirement: string;
  games: GameSummary[];
  icon: typeof Puzzle;
  tone: Tone;
}

export function GameCollectionShowcase({ game }: { game: GameDetail }) {
  const allGroups: RelationGroup[] = [
    {
      eyebrow: "Playable add-ons",
      title: "Downloadable content",
      description: "Optional releases built to extend the base game with new stories, systems, or items.",
      label: "DLC",
      requirement: "Requires the base game",
      games: dedupeGames(game.dlcs),
      icon: Puzzle,
      tone: "mint",
    },
    {
      eyebrow: "Major add-ons",
      title: "Expansions",
      description: "Substantial new chapters that remain attached to the original game.",
      label: "Expansion",
      requirement: "Requires the base game",
      games: dedupeGames(game.expansions),
      icon: Layers3,
      tone: "brand",
    },
    {
      eyebrow: "Independent adventures",
      title: "Standalone expansions",
      description: "Expansion-sized experiences that can be bought and played on their own.",
      label: "Standalone",
      requirement: "Playable independently",
      games: dedupeGames(game.standaloneExpansions),
      icon: Sparkles,
      tone: "neon",
    },
    {
      eyebrow: "Alternate packages",
      title: "Editions",
      description: "Different releases of this same game—not DLC and not separate adventures.",
      label: "Edition",
      requirement: "Version of the base game",
      games: dedupeGames(game.editions),
      icon: Box,
      tone: "gold",
    },
    {
      eyebrow: "Store collections",
      title: "Bundles",
      description: "Packages combining this title with other games or downloadable content.",
      label: "Bundle",
      requirement: "Multi-item package",
      games: dedupeGames(game.bundles),
      icon: Boxes,
      tone: "flare",
    },
    {
      eyebrow: "Reimagined",
      title: "Remakes",
      description: "New productions that rebuild the original experience for another era.",
      label: "Remake",
      requirement: "New production",
      games: dedupeGames(game.remakes),
      icon: RefreshCcw,
      tone: "brand",
    },
    {
      eyebrow: "Restored",
      title: "Remasters",
      description: "Modernised releases built from the original production.",
      label: "Remaster",
      requirement: "Modernised release",
      games: dedupeGames(game.remasters),
      icon: Sparkles,
      tone: "neon",
    },
    {
      eyebrow: "Platform versions",
      title: "Ports",
      description: "Adaptations made for another platform, device, or hardware generation.",
      label: "Port",
      requirement: "Platform adaptation",
      games: dedupeGames(game.ports),
      icon: Repeat2,
      tone: "gold",
    },
  ];
  const groups = allGroups.filter((group) => group.games.length > 0);

  const hasUniverse = game.series.length > 0 || game.franchises.length > 0;
  if (!hasUniverse && groups.length === 0 && !game.parentGame) return null;

  return (
    // Headed by the page's "More from this series" section; no title of its own.
    <div id="collection" className="scroll-mt-36 space-y-10 sm:space-y-12">
      {hasUniverse && <UniverseShowcase game={game} />}

      {(groups.length > 0 || game.parentGame) && (
        <div>
          {game.parentGame && (
            <Reveal className="mb-9 rounded-3xl border border-gold/25 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--color-gold)_12%,transparent),color-mix(in_oklab,var(--color-panel)_70%,transparent))] p-4 sm:p-5">
              <div className="flex items-center gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-gold/20 bg-gold/10 text-gold">
                  <PackageOpen size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-gold">Base-game relationship</p>
                  <Link href={`/game/${game.parentGame.slug}`} className="mt-1 block truncate font-display text-lg font-bold transition-colors hover:text-gold">
                    {game.parentGame.name}
                  </Link>
                  <p className="mt-1 text-xs text-muted">This release depends on or extends the game above.</p>
                </div>
                <Link href={`/game/${game.parentGame.slug}`} aria-label={`Open ${game.parentGame.name}`} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors hover:border-gold/35 hover:text-gold">
                  <ArrowUpRight size={16} />
                </Link>
              </div>
            </Reveal>
          )}

          <div className="space-y-11">
            {groups.map((group) => <RelationShelf key={group.title} group={group} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function UniverseShowcase({ game }: { game: GameDetail }) {
  const backdrop = game.artworks[1] ?? game.artworks[0] ?? game.screenshots[0] ?? game.image;
  const franchises = game.franchises.length > 0 ? game.franchises : game.series;
  const cards = franchises.map((entry) => ({
    entry,
    kind: "Franchise" as const,
    href: `/franchise/${entry.slug}`,
  }));

  return (
    <div id="universe">
      <h3 className="mb-4 text-[17px] font-semibold text-text">{cards.length > 1 ? "Franchises" : "Franchise"}</h3>

      <Stagger className={cn("grid gap-3.5", cards.length > 1 && "lg:grid-cols-2")} gap={0.06} onMount>
        {cards.map(({ entry, kind, href }, index) => (
          <StaggerItem key={`${kind}-${entry.id}`}>
            <UniverseCard entry={entry} kind={kind} href={href} backdrop={backdrop} index={index} />
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}

function UniverseCard({ entry, kind, href, backdrop, index }: { entry: Ref; kind: "Franchise"; href: string; backdrop: string | null; index: number }) {
  return (
    <Link
      href={href}
      // Art-led card: stays a dark surface in the light theme too, so its
      // white type keeps contrast over the key art.
      data-stage="dark"
      style={DARK_STAGE_STYLE}
      className="group relative isolate flex min-h-64 overflow-hidden rounded-[1.75rem] border border-brand/20 bg-panel p-6 shadow-[0_28px_80px_-45px_rgba(124,92,255,0.85)] transition-[transform,border-color,box-shadow] duration-500 fine:hover:-translate-y-1 fine:hover:border-brand/45 fine:hover:shadow-[0_34px_90px_-38px_rgba(124,92,255,0.85)] sm:min-h-72 sm:p-8"
    >
      <span className="absolute inset-0 -z-20">
        <GameCover name={entry.name} slug={entry.slug} image={backdrop} width={1100} sizes="(max-width: 1024px) 100vw, 50vw" rounded="rounded-none" className={cn("object-cover opacity-45 transition-transform duration-1000 fine:group-hover:scale-105", index % 2 === 1 && "object-right")} />
      </span>
      <span className="absolute inset-0 -z-10 bg-gradient-to-t from-bg via-bg/78 to-bg/25" />
      <span className="absolute inset-0 -z-10 bg-gradient-to-r from-bg/85 via-transparent to-transparent" />
      <span className="mt-auto max-w-xl">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-brand-soft backdrop-blur-md">
          <Layers3 size={12} /> {kind}
        </span>
        <span className="mt-3 block font-display text-2xl font-black leading-tight text-white sm:text-3xl">{entry.name}</span>
        <span className="mt-3 flex items-center gap-2 text-sm font-semibold text-white/70 transition-colors group-hover:text-white">
          Enter the franchise
          <ArrowUpRight size={15} className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" />
        </span>
      </span>
    </Link>
  );
}

function RelationShelf({ group }: { group: RelationGroup }) {
  const Icon = group.icon;
  return (
    <div>
      <Reveal className="mb-5 flex items-end justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className={cn("mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border", toneClasses(group.tone))}><Icon size={17} /></span>
          <div>
            <h3 className="text-[17px] font-semibold text-text sm:text-[20px]">{group.title}</h3>
            <p className="mt-1 max-w-xl text-[13px] leading-snug text-muted sm:text-sm">{group.description}</p>
          </div>
        </div>
        <span className="hidden rounded-full border border-line bg-fg/[0.03] px-3 py-1.5 text-xs text-faint sm:inline-flex">{group.games.length} {group.games.length === 1 ? "release" : "releases"}</span>
      </Reveal>

      <Stagger as="ul" className="snap-rail -mx-1 gap-3 overflow-x-auto px-1 pb-3 sm:gap-4" gap={0.035} onMount>
        {group.games.map((game) => (
          <StaggerItem as="li" key={game.id} className="w-[44vw] max-w-[220px] shrink-0 sm:w-48 lg:w-52">
            <RelationPoster game={game} label={group.label} requirement={group.requirement} tone={group.tone} />
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}

function RelationPoster({ game, label, requirement, tone }: { game: GameSummary; label: string; requirement: string; tone: Tone }) {
  return (
    <article className="group h-full">
      <Link href={`/game/${game.slug}`} className="block">
        <span className="relative block aspect-[3/4] overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_22px_55px_-30px_rgba(0,0,0,0.95)] light:shadow-[0_18px_40px_-26px_rgba(0,0,0,0.4)] transition-[transform,border-color,box-shadow] duration-500 fine:group-hover:-translate-y-1.5 fine:group-hover:border-brand/40 fine:group-hover:shadow-[0_28px_70px_-30px_rgba(124,92,255,0.6)]">
          <GameCover name={game.name} slug={game.slug} image={game.image} imageFallback={game.imageFallback} width={520} sizes="(max-width: 640px) 44vw, 208px" className="transition-transform duration-700 fine:group-hover:scale-105" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/5 to-black/20" />
          {/* The chips sit on cover art, so they take the dark-theme tokens in
              either theme (the light accents are tuned for white paper). */}
          <span data-stage="dark" style={DARK_STAGE_STYLE} className="contents">
            <Badge tone="neutral" className={cn("absolute left-2.5 top-2.5 border backdrop-blur-md", toneClasses(tone))}>{label}</Badge>
            {game.metacritic !== null && <ScorePill score={game.metacritic} className="absolute right-2.5 top-2.5" />}
          </span>
          <span className="absolute inset-x-0 bottom-0 p-3.5">
            <span className="line-clamp-2 font-display text-sm font-bold leading-snug text-white">{game.name}</span>
            <span className="mt-1.5 block text-[11px] text-white/60">{releaseLabel(game)}</span>
          </span>
        </span>
        <span className="mt-2.5 block truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">{requirement}</span>
      </Link>
    </article>
  );
}

function toneClasses(tone: Tone): string {
  if (tone === "mint") return "border-mint/25 bg-mint/10 text-mint";
  if (tone === "gold") return "border-gold/25 bg-gold/10 text-gold";
  if (tone === "neon") return "border-neon/25 bg-neon/10 text-neon";
  if (tone === "flare") return "border-flare/25 bg-flare/10 text-flare";
  return "border-brand/25 bg-brand/10 text-brand-soft";
}

function dedupeGames(games: GameSummary[]): GameSummary[] {
  const seen = new Set<number>();
  return games.filter((game) => {
    if (seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  });
}
