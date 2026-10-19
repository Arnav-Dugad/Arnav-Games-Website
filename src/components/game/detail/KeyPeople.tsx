"use client";

/**
 * Key people — director, writers, composer, producers, designers — from
 * Wikidata, each opening their own page. Mounted only when "Credits" is
 * opened, so the extras request waits for someone who wants it (or reuses
 * the answer other sections already asked for).
 */

import Link from "next/link";
import { User } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import type { PersonRole } from "@/lib/games/types";
import { useGameExtras } from "./live";

export const ROLE_LABEL: Record<PersonRole, string> = {
  director: "Director",
  designer: "Designer",
  composer: "Composer",
  producer: "Producer",
  writer: "Writer",
};

export default function KeyPeople() {
  const extras = useGameExtras(true);
  if (!extras || extras.status === "missing" || extras.status === "error") return null;
  if (extras.status === "loading") {
    return (
      <div aria-hidden>
        <Skeleton className="mb-3 h-4 w-28 rounded-full" />
        <div className="flex gap-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-[68px] w-[200px] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }
  const people = extras.data.people;
  if (people.length === 0) return null;

  return (
    <div>
      <h4 className="mb-3 text-[15px] font-semibold text-text">Key people</h4>
      <ul className="snap-rail -mx-1 gap-3 px-1 pb-1">
        {people.map((person) => (
          <li key={person.qid} className="w-[208px] shrink-0">
            <Link
              prefetch={false}
              href={`/person/${person.qid}`}
              className="group flex min-h-[68px] items-center gap-3 rounded-2xl border border-line bg-panel/40 p-2.5 pr-3 transition-colors fine:hover:border-line-strong"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-panel-2 text-faint">
                {person.image ? (
                  // Wikimedia Commons thumbnail (already sized); not a configured next/image host.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={person.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <User size={20} aria-hidden />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold leading-tight text-text transition-colors group-hover:text-[var(--game-accent)]">
                  {person.name}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-muted">{person.roles.map((role) => ROLE_LABEL[role]).join(", ")}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
