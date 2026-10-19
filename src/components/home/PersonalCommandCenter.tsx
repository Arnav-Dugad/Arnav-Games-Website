"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  Gamepad2,
  Library,
  Radar,
  Sparkles,
  Trophy,
} from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { GameRail } from "@/components/game/GameRail";
import { Button } from "@/components/ui/Button";
import { GameRailSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { Container } from "@/components/ui/SectionHeading";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import type { WatchlistEntry } from "@/lib/firebase/db";
import { buildDashboardSnapshot, daysUntilRelease } from "@/lib/games/dashboard";
import { buildTasteProfile, MIN_TASTE_STRENGTH } from "@/lib/games/taste";
import { canonicalEntryHref } from "@/lib/notifications/model";
import { cn } from "@/lib/utils/cn";
import type { GameSummary, Ref } from "@/lib/games/types";

interface RecommendationState {
  key: string;
  results: GameSummary[];
  personalised: boolean;
}

export function PersonalCommandCenter({ genres }: { genres: Ref[] }) {
  const { user, loading: authLoading } = useAuth();
  const { entries, loading: watchlistLoading } = useWatchlist();
  const [recommendations, setRecommendations] = useState<RecommendationState | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(frame);
  }, []);

  const snapshot = useMemo(() => buildDashboardSnapshot(entries, now), [entries, now]);
  const profile = useMemo(() => buildTasteProfile(entries.map((entry) => ({
    gameId: entry.gameId,
    genreIds: entry.genreIds ?? [],
    platformSlugs: entry.platformSlugs ?? [],
    status: entry.status,
    platform: entry.platform ?? null,
    addedAt: entry.addedAt,
    finishedAt: entry.finishedAt ?? null,
  })), { now }), [entries, now]);

  const genreMap = useMemo(() => new Map(genres.map((genre) => [genre.id, genre])), [genres]);
  const tasteGenres = profile.genreIds
    .map((id) => genreMap.get(id))
    .filter((genre): genre is Ref => Boolean(genre));
  const profileUsable = now > 0 && profile.strength >= MIN_TASTE_STRENGTH && profile.genreIds.length > 0;
  const recommendationGenres = profile.genreIds.join(",");
  const recommendationPlatforms = profile.platformSlugs.join(",");
  const recommendationExclude = profile.excludeIds.slice(0, 40).join(",");
  const recommendationKey = profileUsable
    ? [recommendationGenres, recommendationPlatforms, recommendationExclude].join("|")
    : "";

  useEffect(() => {
    if (!user || !recommendationKey) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      genres: recommendationGenres,
      platforms: recommendationPlatforms,
      exclude: recommendationExclude,
      limit: "14",
    });
    fetch(`/api/recommendations?${params}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : { results: [], personalised: false })
      .then((data: { results?: GameSummary[]; personalised?: boolean }) => {
        if (controller.signal.aborted) return;
        setRecommendations({
          key: recommendationKey,
          results: Array.isArray(data.results) ? data.results : [],
          personalised: data.personalised === true,
        });
      })
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError") {
          setRecommendations({ key: recommendationKey, results: [], personalised: false });
        }
    });
    return () => controller.abort();
  }, [user, recommendationKey, recommendationGenres, recommendationPlatforms, recommendationExclude]);

  if (authLoading || !user || now === 0) return null;
  if (watchlistLoading) return <CommandCenterSkeleton />;
  if (entries.length === 0) return <CommandCenterOnboarding name={firstName(user.displayName)} />;

  const currentRecommendations = recommendations?.key === recommendationKey ? recommendations : null;
  const focus = snapshot.focus!;
  const focusLabel = focus.status === "playing"
    ? "Continue your run"
    : focus.status === "want"
      ? "Up next"
      : focus.status === "played"
        ? "Revisit your library"
        : "Recently tracked";

  return (
    <section aria-labelledby="command-center-title" className="relative py-8 sm:py-11 lg:py-14">
      <Container>
        <div className="noise relative isolate overflow-hidden rounded-[2rem] border border-brand/20 bg-[radial-gradient(circle_at_10%_0%,rgba(124,92,255,0.2),transparent_34%),radial-gradient(circle_at_100%_100%,rgba(34,211,238,0.11),transparent_38%),linear-gradient(145deg,rgba(16,16,32,0.94),rgba(5,5,12,0.98))] p-4 shadow-[0_40px_120px_-60px_rgba(124,92,255,0.7)] sm:p-6 lg:p-8">
          <Reveal className="relative z-10 mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.07em] text-brand-soft"><Radar size={13} /> Personalized command center</p>
              <h2 id="command-center-title" className="text-3xl font-black sm:text-4xl">Welcome back, {firstName(user.displayName)}</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">Your library, release radar, progress, and taste profile—synchronized into one live briefing.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/stats" className="group inline-flex w-fit items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-4 py-2.5 text-sm font-semibold text-brand-soft transition-colors hover:border-brand/50 hover:text-white">Open your stats <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></Link>
              <Link href="/library" className="group inline-flex w-fit items-center gap-2 rounded-full border border-line bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-line-strong hover:text-text">Library <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></Link>
            </div>
          </Reveal>

          <div className="relative z-10 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
            <Reveal className="group/focus relative isolate min-h-[360px] overflow-hidden rounded-[1.75rem] border border-white/10 bg-panel sm:min-h-[430px]">
              <GameCover name={focus.name} slug={focus.slug} image={focus.imageFallback ?? focus.image} imageFallback={focus.image} width={1200} sizes="(max-width: 1024px) 100vw, 62vw" rounded="rounded-none" className="object-cover transition-transform duration-1000 fine:group-hover/focus:scale-105" />
              <span className="absolute inset-0 bg-gradient-to-t from-black via-black/42 to-black/5" />
              <span className="absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-neon">{focusLabel}</p>
                <h3 className="mt-2 max-w-2xl font-display text-2xl font-black leading-tight text-white sm:text-4xl">{focus.name}</h3>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/60">
                  <span className="rounded-full border border-white/15 bg-black/30 px-2.5 py-1 backdrop-blur-md">{statusLabel(focus.status)}</span>
                  {focus.platform && <span>Playing on {focus.platform}</span>}
                  {focus.metacritic !== null && <span className="text-gold">{focus.metacritic} critic score</span>}
                </div>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <Button href={canonicalEntryHref(focus)} size="sm">Open game</Button>
                  <Button href="/library" size="sm" variant="secondary">Manage status</Button>
                </div>
              </div>
            </Reveal>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <BriefingCard icon={<CalendarClock size={17} />} eyebrow="Release radar" tone="brand">
                {snapshot.nextRelease ? <ReleaseSignal entry={snapshot.nextRelease} now={now} releasesSoon={snapshot.releasesSoon} /> : <QuietSignal title="No exact tracked dates" body="Your undated and release-window games remain safe in the watchlist." />}
              </BriefingCard>
              <BriefingCard icon={<Trophy size={17} />} eyebrow="Collection pulse" tone="mint">
                <Link href="/stats" className="group flex flex-1 items-start gap-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-mint/10 text-mint"><CheckCircle2 size={15} /></span>
                  <span><span className="block text-sm font-semibold transition-colors group-hover:text-mint">{snapshot.played} completed · {snapshot.owned} owned</span><span className="mt-1 block text-xs leading-relaxed text-muted">Open your personal stats studio for progress, platforms, genres, and collecting patterns.</span></span>
                </Link>
              </BriefingCard>
            </div>
          </div>

          <Stagger className="relative z-10 mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" gap={0.04} onMount>
            <DashboardStat icon={<Gamepad2 size={16} />} value={snapshot.playing} label="Playing now" tone="neon" />
            <DashboardStat icon={<Library size={16} />} value={snapshot.owned} label="Games owned" tone="mint" />
            <DashboardStat icon={<BookOpenCheck size={16} />} value={snapshot.wanted} label="In your backlog" tone="brand" />
            <DashboardStat icon={<Trophy size={16} />} value={snapshot.played} label="Completed" tone="gold" />
          </Stagger>

          <Reveal className="relative z-10 mt-4 flex flex-col gap-4 rounded-2xl border border-line bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.07em] text-faint"><Sparkles size={13} className="text-brand-soft" /> Taste signal</p>
              <p className="mt-1.5 text-sm text-muted">{profileUsable ? `Built from ${entries.length} tracked ${entries.length === 1 ? "game" : "games"}, weighted toward what you finish.` : "Mark games as playing or played to sharpen your recommendations."}</p>
            </div>
            {tasteGenres.length > 0 ? <div className="flex flex-wrap gap-2">{tasteGenres.map((genre) => <Link key={genre.id} href={`/browse?genres=${genre.slug}`} className="rounded-full border border-brand/20 bg-brand/[0.08] px-3 py-1.5 text-xs font-semibold text-brand-soft transition-colors hover:border-brand/40 hover:text-white">{genre.name}</Link>)}</div> : <Button href="/browse" variant="secondary" size="sm">Build your taste profile</Button>}
          </Reveal>
        </div>
      </Container>

      {profileUsable && (
        <div className="mt-10">
          <Container>
            <Reveal className="flex items-end justify-between gap-5">
              <div><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.07em] text-brand-soft">Your next obsession</p><h2 className="text-2xl font-black sm:text-3xl">{!currentRecommendations ? "Calibrating your next picks" : currentRecommendations.personalised ? `Because you play ${tasteGenres.slice(0, 2).map((genre) => genre.name).join(" and ") || "your favorites"}` : "High-quality picks beyond your library"}</h2><p className="mt-2 max-w-xl text-sm text-muted">Everything already tracked is excluded. The recommendation gets stronger as your play history grows.</p></div>
              <Button href="/browse" variant="secondary" size="sm" className="hidden sm:inline-flex">Explore more</Button>
            </Reveal>
          </Container>
          <div className="mt-6">
            {!currentRecommendations ? <Container><GameRailSkeleton count={6} /></Container> : currentRecommendations.results.length > 0 ? <GameRail games={currentRecommendations.results} /> : <Container><div className="rounded-2xl border border-line bg-white/[0.025] p-5 text-sm text-muted">Recommendation data is temporarily quiet. Your command center remains fully available.</div></Container>}
          </div>
        </div>
      )}
    </section>
  );
}

function BriefingCard({ icon, eyebrow, tone, children }: { icon: React.ReactNode; eyebrow: string; tone: "brand" | "mint"; children: React.ReactNode }) {
  return <Reveal className="flex min-h-0 flex-col rounded-[1.5rem] border border-line bg-white/[0.025] p-5"><div className="mb-4 flex items-center gap-2"><span className={cn("grid h-9 w-9 place-items-center rounded-xl", tone === "mint" ? "bg-mint/10 text-mint" : "bg-brand/10 text-brand-soft")}>{icon}</span><p className="text-[10px] font-bold uppercase tracking-[0.07em] text-faint">{eyebrow}</p></div>{children}</Reveal>;
}

function ReleaseSignal({ entry, now, releasesSoon }: { entry: WatchlistEntry; now: number; releasesSoon: number }) {
  const days = daysUntilRelease(entry.released, now);
  return <Link href={canonicalEntryHref(entry)} className="group flex min-h-0 flex-1 items-center gap-3"><span className="relative h-20 w-15 shrink-0 overflow-hidden rounded-xl border border-line"><GameCover name={entry.name} slug={entry.slug} image={entry.image} imageFallback={entry.imageFallback} width={180} sizes="60px" /></span><span className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-[0.07em] text-brand-soft">{days === 0 ? "Releases today" : days === 1 ? "Tomorrow" : `In ${days} days`}</span><span className="mt-1 block line-clamp-2 font-display text-base font-bold leading-snug transition-colors group-hover:text-brand-soft">{entry.name}</span><span className="mt-1 block text-xs text-faint">{formatDate(entry.released)}{releasesSoon > 1 ? ` · ${releasesSoon} due in 30 days` : ""}</span></span></Link>;
}

function QuietSignal({ title, body, success = false }: { title: string; body: string; success?: boolean }) {
  return <div className="flex flex-1 items-start gap-3"><span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", success ? "bg-mint/10 text-mint" : "bg-white/[0.05] text-faint")}>{success ? <CheckCircle2 size={15} /> : <Radar size={15} />}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-relaxed text-muted">{body}</p></div></div>;
}

function DashboardStat({ icon, value, label, tone }: { icon: React.ReactNode; value: number; label: string; tone: "brand" | "mint" | "neon" | "gold" }) {
  const tones = { brand: "bg-brand/10 text-brand-soft", mint: "bg-mint/10 text-mint", neon: "bg-neon/10 text-neon", gold: "bg-gold/10 text-gold" };
  return <StaggerItem><div className="flex h-full items-center gap-3 rounded-2xl border border-line bg-black/20 p-4"><span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", tones[tone])}>{icon}</span><div><p className="font-display text-xl font-black tabular-nums">{value}</p><p className="text-[11px] text-muted">{label}</p></div></div></StaggerItem>;
}

function CommandCenterSkeleton() {
  return <section className="py-8 sm:py-11"><Container><div className="rounded-[2rem] border border-line bg-panel/35 p-5 sm:p-7"><Skeleton className="h-4 w-40" /><Skeleton className="mt-3 h-9 w-72 max-w-full" /><div className="mt-6 grid gap-4 lg:grid-cols-[1.35fr_0.65fr]"><Skeleton className="h-[380px] rounded-[1.75rem]" /><div className="grid gap-4"><Skeleton className="h-[182px] rounded-[1.5rem]" /><Skeleton className="h-[182px] rounded-[1.5rem]" /></div></div></div></Container></section>;
}

function CommandCenterOnboarding({ name }: { name: string }) {
  const steps = [
    { icon: <Library size={17} />, title: "Build your library", body: "Track what you own and where you own it." },
    { icon: <Gamepad2 size={17} />, title: "Set your status", body: "Playing and completed games shape your taste." },
    { icon: <Sparkles size={17} />, title: "Unlock your briefing", body: "Get release, progress, and recommendation signals." },
  ];
  return <section className="py-8 sm:py-11"><Container><Reveal className="relative overflow-hidden rounded-[2rem] border border-brand/20 bg-[radial-gradient(circle_at_0%_0%,rgba(124,92,255,0.2),transparent_45%),rgba(16,16,32,0.72)] p-5 sm:p-8"><p className="text-[10px] font-bold uppercase tracking-[0.07em] text-brand-soft">Your command center</p><h2 className="mt-2 text-3xl font-black">Let&apos;s make Arnav Games yours, {name}</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">Track one game to activate a personal homepage. Nothing is guessed and no placeholder activity is invented.</p><Stagger className="mt-7 grid gap-3 sm:grid-cols-3" gap={0.05} onMount>{steps.map((step) => <StaggerItem key={step.title}><div className="h-full rounded-2xl border border-line bg-black/20 p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-brand-soft">{step.icon}</span><h3 className="mt-3 text-sm font-bold">{step.title}</h3><p className="mt-1 text-xs leading-relaxed text-muted">{step.body}</p></div></StaggerItem>)}</Stagger><div className="mt-6 flex flex-wrap gap-3"><Button href="/browse">Find your first game</Button><Button href="/upcoming" variant="secondary">Explore upcoming releases</Button></div></Reveal></Container></section>;
}

function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || "Player";
}

/**
 * `"none"` needs its own wording.
 *
 * It previously fell through to the "Want to play" default, so a game the
 * reader had merely followed showed a "Want to play" chip directly beneath a
 * "Recently tracked" eyebrow — two labels contradicting each other on one card.
 */
function statusLabel(status: WatchlistEntry["status"]): string {
  switch (status) {
    case "playing":
      return "Currently playing";
    case "played":
      return "Completed";
    case "want":
      return "Want to play";
    default:
      return "Following";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "Date to be announced";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(Date.parse(`${value}T00:00:00Z`));
}
