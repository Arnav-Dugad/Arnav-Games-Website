/**
 * Renderers for the IGDB entities behind a game: the studios that made it, the
 * hardware it runs on, its cast, and when it actually shipped where.
 *
 * Grouped in one module because they share a visual language — a mark, a name,
 * a role — and because every one of them has the same failure mode: IGDB has
 * the record but not the image. Each falls back to a typographic treatment
 * rather than a broken frame, so a studio with no logo still reads as a studio.
 */

import Link from "next/link";
import { Building2, CalendarDays, Cpu, Globe2, ShieldAlert, User } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PlatformIcons } from "./PlatformIcons";
import { cn } from "@/lib/utils/cn";
import type {
  AgeRating,
  CharacterRef,
  CompanyRef,
  LogoRef,
  PlatformRef,
  ReleaseEvent,
} from "@/lib/games/types";
import { ResilientMediaImage } from "./ResilientMediaImage";

/* -------------------------------------------------------------------------- */

/**
 * A transparent brand mark on a dark surface.
 *
 * IGDB logos are PNGs with alpha and no consistent padding or colour, so they
 * get a light plate and `object-contain`: a dark wordmark on a dark page is
 * otherwise invisible, and cropping a logo to fill a box mangles it.
 */
function Mark({ src, alt, size = 40 }: { src: string; alt: string; size?: number }) {
  return (
    <span
      className="relative shrink-0 overflow-hidden rounded-xl bg-white/[0.92] p-1.5 ring-1 ring-inset ring-white/10"
      style={{ width: size, height: size }}
    >
      <ResilientMediaImage src={src} alt={alt} sizes={`${size}px`} className="object-contain p-1" />
    </span>
  );
}

function Initial({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-xl border border-line bg-white/[0.04] font-display text-sm font-bold text-muted"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

const ROLE_LABELS: [keyof Pick<CompanyRef, "developer" | "publisher" | "porting" | "supporting">, string][] = [
  ["developer", "Developer"],
  ["publisher", "Publisher"],
  ["porting", "Porting"],
  ["supporting", "Support"],
];

function rolesOf(company: CompanyRef): string {
  const roles = ROLE_LABELS.filter(([key]) => company[key]).map(([, label]) => label);
  return roles.length > 0 ? roles.join(" · ") : "Involved";
}

/** The studios behind a game, with their real marks. */
export function CompanyGrid({ companies }: { companies: CompanyRef[] }) {
  if (companies.length === 0) return null;

  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {companies.map((company) => (
        <li key={`${company.id}-${rolesOf(company)}`}>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel/40 p-3 transition-colors hover:border-line-strong">
            {company.logo ? (
              <Mark src={company.logo} alt={`${company.name} logo`} />
            ) : (
              <Initial name={company.name} />
            )}
            <Link href={`/studio/${company.slug}`} className="min-w-0 flex-1 group/company">
              <p className="truncate text-sm font-semibold transition-colors group-hover/company:text-brand-soft">
                {company.name}
              </p>
              <p className="mt-0.5 truncate text-[11px] uppercase tracking-[0.06em] text-faint">
                {rolesOf(company)}
              </p>
            </Link>
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${company.name} website`}
                className="shrink-0 rounded-lg p-2 text-faint transition-colors hover:bg-white/6 hover:text-text"
              >
                <Globe2 size={15} />
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

/** Engines, with IGDB's mark where it has one. */
export function EngineRow({ engines }: { engines: LogoRef[] }) {
  if (engines.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2">
      {engines.map((engine) => (
        <li
          key={engine.id}
          className="inline-flex items-center gap-2.5 rounded-full border border-line bg-white/[0.04] py-1.5 pl-1.5 pr-4 text-sm text-muted"
        >
          {engine.logo ? (
            <Mark src={engine.logo} alt={`${engine.name} logo`} size={28} />
          ) : (
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/5 text-faint">
              <Cpu size={14} />
            </span>
          )}
          {engine.name}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Every platform IGDB lists, with its own logo.
 *
 * Distinct from the icon row in the hero, which collapses to families ("PC",
 * "PlayStation"). This is the full, specific list — PS4 *and* PS5 — because on
 * a detail page the exact hardware is the answer someone came for.
 */
export function PlatformGrid({ platforms }: { platforms: PlatformRef[] }) {
  if (platforms.length === 0) return null;

  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {platforms.map((platform) => (
        <li
          key={platform.id}
          className="flex items-center gap-2.5 rounded-xl border border-line bg-panel/40 p-2.5"
        >
          {platform.logo ? (
            <Mark src={platform.logo} alt={`${platform.name} logo`} size={32} />
          ) : platform.family ? (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5">
              <PlatformIcons platforms={[{ slug: platform.family }]} size={16} max={1} tinted />
            </span>
          ) : (
            <Initial name={platform.name} size={32} />
          )}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight">{platform.name}</p>
            {(platform.category || platform.generation) && (
              <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.06em] text-faint">
                {[platform.category, platform.generation ? `Gen ${platform.generation}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

/** The named cast, as a horizontal rail of portraits. */
export function CharacterRail({ characters }: { characters: CharacterRef[] }) {
  if (characters.length === 0) return null;

  return (
    <ul className="snap-rail gap-3 pb-2 sm:gap-4">
      {characters.map((character) => (
        <li key={character.id} className="w-[132px] sm:w-[148px]">
          <Link
            href={`/character/${character.slug}`}
            className="group block overflow-hidden rounded-2xl border border-line bg-panel/40 transition-colors hover:border-line-strong"
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-panel-2">
              {character.image ? (
                <ResilientMediaImage
                  src={character.image}
                  alt={character.name}
                  sizes="148px"
                  className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] fine:group-hover:scale-105"
                />
              ) : (
                <span className="grid h-full w-full place-items-center text-faint">
                  <User size={28} />
                </span>
              )}
            </div>
            <div className="p-2.5">
              <p className="truncate text-[13px] font-semibold leading-tight transition-colors group-hover:text-brand-soft">
                {character.name}
              </p>
              {(character.species || character.gender) && (
                <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.06em] text-faint">
                  {[character.species, character.gender].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Per-region release dates.
 *
 * Only worth rendering when there is more than one row — a single worldwide
 * date is already stated in the hero, and repeating it as a one-row table is
 * noise.
 */
export function ReleaseTable({ releases }: { releases: ReleaseEvent[] }) {
  if (releases.length < 2) return null;

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
      {releases.slice(0, 12).map((release, i) => (
        <li
          key={`${release.human}-${release.region}-${release.platform}-${i}`}
          className="flex items-center gap-3 bg-panel/30 px-4 py-3"
        >
          <CalendarDays size={14} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate text-sm">{release.human}</span>
          {release.platform && (
            <span className="hidden shrink-0 truncate text-xs text-muted sm:inline">
              {release.platform}
            </span>
          )}
          {release.region && (
            <Badge tone="neutral">
              <span className="truncate">{release.region}</span>
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Age ratings with the board's own content warnings.
 *
 * The descriptors are the useful half — "Mature 17+" says far less than "Blood
 * and Gore, Intense Violence, Strong Language", and they are exactly what a
 * parent or a cautious buyer is looking for.
 */
export function AgeRatingPanel({ ratings }: { ratings: AgeRating[] }) {
  if (ratings.length === 0) return null;

  return (
    <ul className="space-y-2.5">
      {ratings.map((rating) => (
        <li
          key={`${rating.organization}-${rating.rating}`}
          className="rounded-2xl border border-line bg-panel/40 p-3.5"
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-white/[0.06] font-display text-xs font-bold">
              {rating.rating}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{rating.organization}</p>
              <p className="text-[11px] uppercase tracking-[0.06em] text-faint">Age rating</p>
            </div>
          </div>
          {rating.descriptors.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
              <ShieldAlert size={13} className="mt-0.5 shrink-0 text-flare/80" />
              {rating.descriptors.map((descriptor) => (
                <span key={descriptor} className="text-[11px] leading-relaxed text-muted">
                  {descriptor}
                  <span className="text-faint">{" · "}</span>
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

/** Compact studio credit for the hero — the one line people actually scan. */
export function StudioCredit({
  developers,
  publishers,
  className,
}: {
  developers: { id: number; name: string }[];
  publishers: { id: number; name: string }[];
  className?: string;
}) {
  const dev = developers[0]?.name;
  const pub = publishers[0]?.name;
  if (!dev && !pub) return null;

  return (
    <p className={cn("flex items-center gap-2 text-sm text-muted", className)}>
      <Building2 size={15} className="shrink-0 text-faint" />
      <span className="truncate">
        {dev ?? pub}
        {dev && pub && dev !== pub && <span className="text-faint"> · {pub}</span>}
      </span>
    </p>
  );
}
