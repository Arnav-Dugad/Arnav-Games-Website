"use client";

/**
 * "Community": what players have made of the game beyond reviews — the tags
 * they gave it on Steam, the fastest runs, and the mods.
 *
 * Every block hides without data, and the whole section hides when none has
 * any, so a console exclusive simply doesn't get one. Loaded with the page's
 * extras as the reader nears "What players think" (the section before it).
 */

import { ArrowUpRight, Download, Pin, Play, Timer } from "lucide-react";
import { Chip } from "@/components/ui/Badge";
import { useNearId } from "@/hooks";
import { cn } from "@/lib/utils/cn";
import { compactNumber } from "@/lib/utils/format";
import type { GameMods, SpeedrunRecords, SteamSpyData } from "@/lib/games/types";
import { DetailSection } from "./DetailSection";
import { useGameExtras } from "./live";

const MAX_TAGS = 14;
const MAX_RECORDS = 4;
const MAX_MODS = 5;

const RUN_DATE = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export default function CommunitySection() {
  const near = useNearId("reviews");
  const extras = useGameExtras(near);
  if (extras?.status !== "ready") return null;

  const { steamSpy, speedrun, mods } = extras.data;
  const tags = steamSpy?.tags.slice(0, MAX_TAGS) ?? [];
  const records = speedrun ? [...speedrun.records.filter((r) => !r.misc), ...speedrun.records.filter((r) => r.misc)].slice(0, MAX_RECORDS) : [];
  const hasMods = Boolean(mods.thunderstore?.top.length || mods.links.steamWorkshop);
  if (tags.length === 0 && records.length === 0 && !hasMods) return null;

  return (
    <DetailSection id="community" title="Community">
      <div className="space-y-4">
        {tags.length > 0 && <Tags tags={tags} />}
        {(records.length > 0 || hasMods) && (
          <div className={records.length > 0 && hasMods ? "grid gap-4 lg:grid-cols-2" : undefined}>
            {records.length > 0 && speedrun && <Records game={speedrun.game} records={records} wide={!hasMods} />}
            {hasMods && <Mods mods={mods} />}
          </div>
        )}
      </div>
    </DetailSection>
  );
}

function Tags({ tags }: { tags: SteamSpyData["tags"] }) {
  return (
    <div>
      <h3 className="sr-only">Steam tags</h3>
      <ul className="flex flex-wrap gap-2" aria-label="Steam tags, most voted first">
        {tags.map((tag) => (
          <li key={tag.name}>
            <Chip href={`/browse?search=${encodeURIComponent(tag.name)}`}>{tag.name}</Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Records({ game, records, wide }: { game: SpeedrunRecords["game"]; records: SpeedrunRecords["records"]; wide: boolean }) {
  return (
    <div className="glass rounded-3xl p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[17px] font-semibold text-text">
          <Timer size={17} aria-hidden className="text-[var(--game-accent)]" />
          World records
        </h3>
        <a href={game.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 text-[13px] font-medium text-muted fine:hover:text-text">
          speedrun.com <ArrowUpRight size={13} aria-hidden />
        </a>
      </div>
      {/* Alone on a wide screen, the records sit in two columns rather than one long, sparse list. */}
      <ul className={cn("mt-2", wide ? "grid grid-cols-[minmax(0,1fr)] gap-x-10 sm:grid-cols-2" : "divide-y divide-line")}>
        {records.map((record, index) => (
          <li key={record.url} className={cn("flex items-center gap-3 py-3", wide && index > 0 && "border-t border-line", wide && index === 1 && "sm:border-t-0")}>
            <div className="min-w-0 flex-1">
              <a href={record.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium text-muted fine:hover:text-text">
                {record.category}
              </a>
              <p className="mt-0.5 flex min-w-0 items-baseline gap-2">
                <a href={record.runUrl} target="_blank" rel="noopener noreferrer" className="font-display text-[22px] font-bold leading-none tabular-nums text-text fine:hover:underline">
                  {record.time}
                </a>
                <span className="truncate text-[13px] text-muted">
                  {record.runners.map((runner) => runner.name).join(", ")}
                  {record.date && <span className="text-faint"> · {RUN_DATE.format(new Date(`${record.date}T00:00:00Z`))}</span>}
                </span>
              </p>
            </div>
            {record.video && (
              <a
                href={record.video}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Watch the ${record.category} record`}
                className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fg/[0.07] text-text transition-colors fine:hover:bg-fg/[0.12] coarse:h-11 coarse:w-11"
              >
                <Play size={15} aria-hidden fill="currentColor" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Mods({ mods }: { mods: GameMods }) {
  const store = mods.thunderstore;
  // Pinned packages are the loaders everything else needs; they lead.
  const top = store ? [...store.top.filter((mod) => mod.pinned), ...store.top.filter((mod) => !mod.pinned)].slice(0, MAX_MODS) : [];
  return (
    <div className="glass rounded-3xl p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[17px] font-semibold text-text">Mods</h3>
        {store && (
          <a href={store.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 text-[13px] font-medium text-muted fine:hover:text-text">
            {store.total.toLocaleString("en-US")} on Thunderstore <ArrowUpRight size={13} aria-hidden />
          </a>
        )}
      </div>
      {top.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {top.map((mod) => (
            <li key={mod.url}>
              <a href={mod.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 py-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-fg/[0.06]">
                  {mod.icon && (
                    // Thunderstore's own icon CDN; small and already sized.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mod.icon} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-medium text-text group-hover:underline">{mod.name.replace(/_/g, " ")}</span>
                    {mod.pinned && <Pin size={12} aria-label="Pinned by the community" className="shrink-0 text-[var(--game-accent)]" />}
                  </span>
                  <span className="block truncate text-[12px] text-faint">{mod.description || mod.owner}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[12px] tabular-nums text-muted">
                  <Download size={12} aria-hidden />
                  {compactNumber(mod.downloads)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <OutLink href={mods.links.nexus}>Nexus Mods</OutLink>
        {mods.links.steamWorkshop && <OutLink href={mods.links.steamWorkshop}>Steam Workshop</OutLink>}
      </div>
    </div>
  );
}

function OutLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="press inline-flex min-h-10 items-center gap-1 rounded-full bg-fg/[0.06] px-3.5 text-[13px] font-semibold text-text transition-colors fine:hover:bg-fg/[0.1] coarse:min-h-11"
    >
      {children}
      <ArrowUpRight size={13} aria-hidden />
    </a>
  );
}
