"use client";

/**
 * "Track record": a compact card per developer in the credits — how many
 * games it has shipped, how critics rated them, and how many of the release
 * dates we watched it kept (`studio-record.ts`). Mounted when "Credits" is
 * opened, so it shares the extras request with Key people instead of adding
 * one; the full story lives on the studio's own page, which it links to.
 */

import Link from "next/link";
import { useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils/cn";
import { scoreColor } from "@/lib/utils/format";
import { usableStudioRecord } from "@/lib/games/release-confidence";
import type { StudioRecord } from "@/lib/games/types";
import { InfoTip } from "./InfoTip";
import { useGameExtras } from "./live";

export default function StudioTrackRecord() {
  const extras = useGameExtras(true);
  if (!extras || extras.status === "missing" || extras.status === "error") return null;
  if (extras.status === "loading") {
    return (
      <div aria-hidden>
        <Skeleton className="mb-3 h-4 w-28 rounded-full" />
        <Skeleton className="h-[132px] w-full rounded-2xl sm:w-[360px]" />
      </div>
    );
  }
  const studios = (extras.data.studios ?? []).filter((studio) => studio.released > 0 || studio.upcoming > 0);
  if (studios.length === 0) return null;

  return (
    <div>
      <h4 className="mb-3 flex items-center gap-1.5 text-[15px] font-semibold text-text">
        Track record <InfoTip topic="studioRecord" />
      </h4>
      <ul className={cn("grid gap-3", studios.length > 1 && "sm:grid-cols-2")}>
        {studios.map((studio) => (
          <li key={studio.id} className="min-w-0">
            <StudioCard studio={studio} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StudioCard({ studio }: { studio: StudioRecord }) {
  // Browser-only (mounted on open), so the clock can't split server and client HTML.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const reliability = studio.reliability;
  const watched = usableStudioRecord(reliability, today);
  const kept = watched ? watched.tracked - watched.delayed : 0;
  return (
    <div className="h-full rounded-2xl border border-line bg-panel/40 p-4 light:bg-panel">
      <Link
        prefetch={false}
        href={`/studio/${studio.slug}`}
        className="block truncate text-[15px] font-semibold text-text transition-colors hover:text-[var(--game-accent)]"
      >
        {studio.name}
      </Link>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        <Tile
          label="Games"
          value={`${studio.released}${studio.truncated ? "+" : ""}`}
          note={studio.upcoming > 0 ? `${studio.upcoming} upcoming` : "released"}
        />
        <Tile
          label="Critics"
          value={studio.avgCritic === null ? "—" : String(studio.avgCritic)}
          colour={studio.avgCritic === null ? undefined : scoreColor(studio.avgCritic)}
          note={studio.scored > 0 ? `${studio.scored} rated` : "too few"}
        />
        <Tile
          label="On time"
          value={watched ? `${kept}/${watched.tracked}` : "—"}
          note={watched ? "dates kept" : reliability?.tracked ? "still tracking" : "no data yet"}
        />
      </dl>
      {studio.best && (
        <p className="mt-3 truncate text-[12px] text-muted">
          Best rated:{" "}
          <Link prefetch={false} href={`/game/${studio.best.slug}`} className="font-medium text-text underline decoration-line-strong underline-offset-2 hover:text-[var(--game-accent)]">
            {studio.best.name}
          </Link>{" "}
          <span className="tabular-nums">({studio.best.score})</span>
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, note, colour }: { label: string; value: string; note: string; colour?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-fg/[0.045] px-2.5 py-2">
      <dt className="truncate text-[11px] font-medium text-muted">{label}</dt>
      <dd className="mt-0.5">
        <span className="flex items-center gap-1.5">
          {colour && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: colour }} />}
          <span className="font-display text-[19px] font-bold leading-none tabular-nums text-text">{value}</span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-faint">{note}</span>
      </dd>
    </div>
  );
}
