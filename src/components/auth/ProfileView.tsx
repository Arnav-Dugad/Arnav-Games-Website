"use client";

/**
 * The signed-in profile, in the spirit of an Apple Account / Game Center
 * page: who you are, the handful of numbers that describe you as a player,
 * a showcase, milestones you've actually earned, what you did recently, and
 * where you play — then the doors out to library, stats and settings.
 *
 * Everything shown is derived from the reader's own records. Milestones are
 * thresholds over real counts (games owned, finished, reviewed…), with the
 * progress to the next level shown honestly rather than padded.
 *
 * Split in two: `ProfileView` loads data for the signed-in reader, and
 * `ProfileScreen` renders from plain props — which is what lets the dev-only
 * `/profile/preview` route show the signed-in design without an account.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  Compass,
  Gamepad2,
  Gem,
  Layers3,
  Library,
  LogOut,
  MessageSquare,
  Pencil,
  Settings,
  Sparkles,
  Star,
  Trophy,
} from "lucide-react";
import { OwnedLibrary } from "./OwnedLibrary";
import { PlayHistory } from "./PlayHistory";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { getUserProfile, getUserReviews, updateUserProfile, type Review, type WatchlistEntry } from "@/lib/firebase/db";
import { releaseState } from "@/lib/games/release-state";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { CountUp } from "@/components/motion/text";
import { GameCover } from "@/components/game/GameCover";
import { cn } from "@/lib/utils/cn";
import { OWNERSHIP_PLATFORMS } from "@/lib/games/stores-catalog";
import { SUBSCRIPTION_SERVICES } from "@/components/game/SubscriptionAccessPicker";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { JournalTimeline } from "@/components/personal/JournalTimeline";
import { usePersonal, type JournalEntry } from "@/lib/personal/store";
import { STORAGE_PREFIX } from "@/lib/utils/storage-keys";
import { SectionMiniMap } from "@/components/interactions/SectionMiniMap";

// The physics shelf is a toy: opt-in, browser-only, never in the first paint.
const PhysicsShelf = dynamic(() => import("@/components/shelf/PhysicsShelf"), {
  ssr: false,
  loading: () => <Skeleton className="h-[420px] rounded-3xl" />,
});
const SHELF_KEY = `${STORAGE_PREFIX}profile-shelf`;
const SHELF_LIMIT = 40;

type PlayStyle = "casual" | "balanced" | "dedicated" | "competitive" | null;

export interface ProfileDraft {
  name: string;
  bio: string;
  gamerTag: string;
  ownedPlatforms: string[];
  activeSubscriptions: string[];
  playStyle: PlayStyle;
}

export interface ProfileData {
  uid: string;
  email: string | null;
  photo: string | null;
  /** Epoch ms the account was created, when known. */
  memberSince: number | null;
  draft: ProfileDraft;
  /** Null while loading. */
  reviews: Review[] | null;
  entries: WatchlistEntry[];
  /** The play journal, newest first; null while loading. */
  journal?: JournalEntry[] | null;
}

const EMPTY_DRAFT: ProfileDraft = { name: "", bio: "", gamerTag: "", ownedPlatforms: [], activeSubscriptions: [], playStyle: null };

/* -------------------------------------------------------------------------- */
/* Live data                                                                  */
/* -------------------------------------------------------------------------- */

export function ProfileView() {
  const { user, signOut, setDisplayName } = useAuth();
  const { entries } = useWatchlist();
  const personal = usePersonal();
  const { toast } = useToast();
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(() => ({ ...EMPTY_DRAFT, name: user?.displayName ?? "" }));
  const [createdAt, setCreatedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getUserReviews(user.uid)
      .then((list) => !cancelled && setReviews(list))
      .catch(() => !cancelled && setReviews([]));
    getUserProfile(user.uid)
      .then((profile) => {
        if (cancelled || !profile) return;
        setCreatedAt(profile.createdAt || null);
        setDraft({
          name: profile.displayName || user.displayName || "",
          bio: profile.bio ?? "",
          gamerTag: profile.gamerTag ?? "",
          ownedPlatforms: profile.ownedPlatforms ?? [],
          activeSubscriptions: profile.activeSubscriptions ?? [],
          playStyle: profile.playStyle ?? null,
        });
      })
      .catch(() => {
        /* the profile doc is optional — the page works without it */
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  const fallbackName = user.displayName || user.email?.split("@")[0] || "Player";
  const authCreated = user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : NaN;

  return (
    <ProfileScreen
      data={{
        uid: user.uid,
        email: user.email,
        photo: user.photoURL,
        memberSince: createdAt ?? (Number.isFinite(authCreated) ? authCreated : null),
        draft: { ...draft, name: draft.name || fallbackName },
        reviews,
        entries,
        journal: personal.ready ? personal.journal : null,
      }}
      onSave={async (next) => {
        const name = next.name.trim() || fallbackName;
        if (name !== user.displayName) await setDisplayName(name);
        await updateUserProfile(user.uid, {
          displayName: name,
          bio: next.bio,
          gamerTag: next.gamerTag.trim(),
          ownedPlatforms: next.ownedPlatforms,
          activeSubscriptions: next.activeSubscriptions,
          playStyle: next.playStyle,
        });
        setDraft({ ...next, name, gamerTag: next.gamerTag.trim() });
        toast("Profile updated", "success");
      }}
      onSignOut={async () => {
        await signOut();
        toast("Signed out", "info");
        router.push("/");
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

const noop = () => () => {};
/** Hour-granular "now", client only, so relative dates never hydrate stale. */
function useNow(): number | null {
  return useSyncExternalStore(noop, () => Math.floor(Date.now() / 3_600_000) * 3_600_000, () => null);
}

const MEMBER_SINCE = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

export function ProfileScreen({
  data,
  onSave,
  onSignOut,
}: {
  data: ProfileData;
  onSave: (draft: ProfileDraft) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const { entries, reviews, draft } = data;
  const now = useNow();
  const [editing, setEditing] = useState(false);

  const stats = useMemo(() => {
    const owned = entries.filter((entry) => (entry.ownedOn ?? []).length > 0);
    return {
      tracked: entries.length,
      owned: owned.length,
      finished: entries.filter((entry) => entry.status === "played").length,
      playing: entries.filter((entry) => entry.status === "playing").length,
      saved: entries.filter((entry) => entry.watchlisted).length,
      stores: new Set(owned.flatMap((entry) => entry.ownedOn ?? [])).size,
    };
  }, [entries]);

  const averageGiven = reviews && reviews.length ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10 : null;

  return (
    <Container className="pb-12 lg:pb-16">
      <div className="grid gap-8 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-12">
        {/* Identity + navigation: a sticky column on desktop. */}
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <IdentityCard data={data} onEdit={() => setEditing(true)} />
          {/* Desktop keeps the doors out beside the identity; phones get them
              at the end, after the content people came to the profile for. */}
          <div className="hidden lg:block">
            <NavGroup stats={stats} onSignOut={onSignOut} />
          </div>
        </aside>

        <div className="min-w-0 space-y-10">
          <section aria-label="At a glance">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat icon={<Layers3 size={15} />} label="Owned" value={stats.owned} note={`on ${stats.stores} ${stats.stores === 1 ? "store" : "stores"}`} />
              <Stat icon={<Trophy size={15} />} label="Finished" value={stats.finished} note={stats.playing ? `${stats.playing} in progress` : "nothing in progress"} />
              <Stat icon={<Bookmark size={15} />} label="Saved" value={stats.saved} note="on your watchlist" />
              {reviews === null ? (
                <div className="rounded-2xl bg-fg/[0.045] p-3.5"><Skeleton className="h-3 w-14 rounded" /><Skeleton className="mt-2.5 h-7 w-10 rounded" /></div>
              ) : (
                <Stat icon={<Star size={15} />} label="Reviews" value={reviews.length} note={averageGiven !== null ? `average ${averageGiven}/10` : "none written yet"} />
              )}
            </dl>
          </section>

          <Showcase entries={entries} reviews={reviews} />

          <ProfileSection id="profile-milestones" title="Milestones">
            <Milestones entries={entries} reviews={reviews ?? []} />
          </ProfileSection>

          <ProfileSection id="profile-activity" title="Recent activity">
            {now === null || reviews === null ? (
              <Skeleton className="h-64 rounded-2xl" />
            ) : (
              <PlayHistory entries={entries} reviews={reviews} now={now} />
            )}
          </ProfileSection>

          {data.journal && data.journal.length > 0 && now !== null && (
            <ProfileSection id="profile-journal" title="Play journal" subtitle="Only you can see this">
              <JournalTimeline entries={data.journal} now={now} />
            </ProfileSection>
          )}

          <ShelfSection entries={entries} />

          <ProfileSection id="profile-platforms" title="Where you play" action={<button type="button" onClick={() => setEditing(true)} className="press min-h-11 text-[15px] font-medium text-brand-soft">Edit</button>}>
            <OwnedLibrary entries={entries} declared={draft.ownedPlatforms} />
            {draft.activeSubscriptions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {draft.activeSubscriptions.map((slug) => {
                  const service = SUBSCRIPTION_SERVICES.find((item) => item.slug === slug);
                  return (
                    <span key={slug} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-fg/[0.06] px-3 text-[13px] text-muted">
                      {service?.icon ? <BrandIcon name={service.icon} size={13} title={null} /> : <Sparkles size={13} aria-hidden />}
                      {service?.name ?? slug}
                    </span>
                  );
                })}
              </div>
            )}
          </ProfileSection>

          <Reviews reviews={reviews} />
          {/* Wide desktop: a rail of the sections that rendered (late ones join as they arrive). */}
          <SectionMiniMap sections={PROFILE_SECTIONS} />
          <div className="lg:hidden">
            <NavGroup stats={stats} onSignOut={onSignOut} />
          </div>
        </div>
      </div>

      <EditProfileSheet open={editing} onClose={() => setEditing(false)} draft={draft} onSave={onSave} />
    </Container>
  );
}

/**
 * Your covers as a pile of real objects to pick up and throw. Opt-in (the
 * choice is remembered on this device), because it's a toy, it costs a
 * little battery, and a profile should open calmly.
 */
function ShelfSection({ entries }: { entries: WatchlistEntry[] }) {
  const owned = useMemo(
    () => entries.filter((entry) => (entry.ownedOn ?? []).length > 0 || entry.status === "played").sort((a, b) => b.addedAt - a.addedAt).slice(0, SHELF_LIMIT),
    [entries],
  );
  const stored = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(SHELF_KEY, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(SHELF_KEY, onChange);
      };
    },
    () => {
      try {
        return window.localStorage.getItem(SHELF_KEY) === "on";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const toggle = () => {
    try {
      window.localStorage.setItem(SHELF_KEY, stored ? "off" : "on");
    } catch {
      /* storage blocked: nothing to remember */
    }
    window.dispatchEvent(new Event(SHELF_KEY));
  };
  if (owned.length < 4) return null;

  return (
    <ProfileSection
      id="profile-shelf"
      title="Your shelf"
      subtitle={stored ? "Grab a cover and throw it. Tap one to open it." : undefined}
      action={
        <button type="button" onClick={toggle} aria-pressed={stored} className="press min-h-11 text-[15px] font-medium text-brand-soft">
          {stored ? "Put away" : "Open shelf"}
        </button>
      }
    >
      {stored ? (
        <PhysicsShelf entries={owned} />
      ) : (
        <button
          type="button"
          onClick={toggle}
          className="press group relative flex h-36 w-full items-end justify-center overflow-hidden rounded-3xl bg-fg/[0.04] pb-0 ring-1 ring-inset ring-line"
          aria-label="Open your interactive shelf"
        >
          {owned.slice(0, 7).map((entry, index, list) => {
            const middle = (list.length - 1) / 2;
            return (
              <span
                key={entry.gameId}
                aria-hidden
                className="relative -mx-2 h-[104px] w-[78px] shrink-0 overflow-hidden rounded-lg shadow-[0_10px_24px_-12px_rgba(0,0,0,0.7)] ring-1 ring-inset ring-fg/15"
                style={{ transform: `rotate(${(index - middle) * 6}deg) translateY(${Math.abs(index - middle) * 9 + 16}px)`, zIndex: list.length - Math.abs(Math.round(index - middle)) }}
              >
                <GameCover name={entry.name} slug={entry.slug} image={entry.image} imageFallback={entry.imageFallback} width={160} sizes="78px" />
              </span>
            );
          })}
        </button>
      )}
    </ProfileSection>
  );
}

/** The rail's order; sections that don't render for this reader are skipped. */
const PROFILE_SECTIONS = [
  { id: "profile-favourites", label: "Favourites" },
  { id: "profile-milestones", label: "Milestones" },
  { id: "profile-activity", label: "Recent activity" },
  { id: "profile-journal", label: "Play journal" },
  { id: "profile-shelf", label: "Your shelf" },
  { id: "profile-platforms", label: "Where you play" },
  { id: "profile-reviews", label: "Your reviews" },
];

function ProfileSection({ id, title, subtitle, action, children }: { id?: string; title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-28">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[22px] font-bold tracking-[-0.02em]">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

const PLAY_STYLE: Record<Exclude<PlayStyle, null>, string> = {
  casual: "Casual player",
  balanced: "Balanced player",
  dedicated: "Dedicated player",
  competitive: "Competitive player",
};

function IdentityCard({ data, onEdit }: { data: ProfileData; onEdit: () => void }) {
  const { draft } = data;
  return (
    <section aria-label="Your account" className="glass relative isolate overflow-hidden rounded-3xl px-5 pb-5 pt-7 text-center lg:text-left">
      <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-56 w-56 -translate-x-1/2 rounded-full bg-brand/25 blur-3xl lg:left-10 lg:translate-x-0" />
      <ProfileAvatar name={draft.name} photo={data.photo} uid={data.uid} />
      <h2 className="mt-4 break-words font-display text-[26px] font-bold leading-tight tracking-[-0.02em]">{draft.name}</h2>
      {draft.gamerTag && <p className="mt-0.5 text-[15px] font-medium text-brand-soft">@{draft.gamerTag}</p>}
      {data.email && <p className="mt-1 truncate text-[13px] text-muted">{data.email}</p>}

      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 lg:justify-start">
        {draft.playStyle && <span className="inline-flex min-h-7 items-center rounded-full bg-fg/[0.07] px-2.5 text-[12px] font-medium text-muted">{PLAY_STYLE[draft.playStyle]}</span>}
        {data.memberSince && (
          <span className="inline-flex min-h-7 items-center rounded-full bg-fg/[0.07] px-2.5 text-[12px] font-medium text-muted">
            Member since {MEMBER_SINCE.format(new Date(data.memberSince))}
          </span>
        )}
      </div>

      {draft.bio && <p className="mt-4 text-[15px] leading-relaxed text-muted">{draft.bio}</p>}

      <Button onClick={onEdit} variant="secondary" size="sm" icon={<Pencil size={14} />} className="mt-5">
        Edit profile
      </Button>
    </section>
  );
}

function ProfileAvatar({ name, photo, uid }: { name: string; photo: string | null; uid: string }) {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash << 5) - hash + uid.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return (
    <div
      className="mx-auto grid h-24 w-24 place-items-center overflow-hidden rounded-full shadow-[0_18px_40px_-18px_rgba(0,0,0,0.8)] ring-4 ring-bg lg:mx-0"
      style={{ background: photo ? undefined : `linear-gradient(140deg, hsl(${hue} 68% 54%), hsl(${(hue + 50) % 360} 68% 32%))` }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- third-party avatar URL, tiny, not worth the optimiser
        <img src={photo} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden className="font-display text-[38px] font-bold text-white">{name.slice(0, 1).toUpperCase()}</span>
      )}
    </div>
  );
}

function NavGroup({ stats, onSignOut }: { stats: { owned: number; saved: number }; onSignOut: () => Promise<void> }) {
  const row = "press flex min-h-[50px] items-center gap-3 px-4 transition-colors fine:hover:bg-fg/[0.04]";
  const icon = (node: ReactNode, tone: string) => <span aria-hidden className={cn("grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] text-white", tone)}>{node}</span>;
  const links = [
    { href: "/library", label: "Library", value: String(stats.owned), icon: icon(<Library size={16} />, "bg-brand") },
    { href: "/watchlist", label: "Watchlist", value: String(stats.saved), icon: icon(<Bookmark size={16} />, "bg-[#ff9f0a]") },
    { href: "/stats", label: "Your stats", value: "", icon: icon(<BarChart3 size={16} />, "bg-mint") },
    { href: "/settings", label: "Settings", value: "", icon: icon(<Settings size={16} />, "bg-[#8e8e93]") },
  ];
  return (
    <div className="space-y-4">
      <nav aria-label="Your pages" className="overflow-hidden rounded-2xl border border-line bg-panel/55 light:bg-panel [&>*+*]:border-t [&>*+*]:border-line">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={row}>
            {link.icon}
            <span className="min-w-0 flex-1 truncate text-[15px]">{link.label}</span>
            {link.value && <span className="text-[15px] tabular-nums text-muted">{link.value}</span>}
            <ChevronRight size={17} aria-hidden className="text-faint" />
          </Link>
        ))}
      </nav>
      <button
        type="button"
        onClick={() => void onSignOut()}
        className="press flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl border border-line bg-panel/55 text-[15px] font-medium text-flare transition-colors light:bg-panel fine:hover:bg-flare/[0.06]"
      >
        <LogOut size={15} aria-hidden />
        Sign out
      </button>
    </div>
  );
}

function Stat({ icon, label, value, note }: { icon: ReactNode; label: string; value: number; note: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-fg/[0.045] p-3.5">
      <dt className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        <span aria-hidden className="text-brand-soft">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1.5">
        <CountUp value={value} className="font-display text-[28px] font-bold leading-none tabular-nums" />
        <span className="mt-1 block truncate text-[11px] text-faint">{note}</span>
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Showcase                                                                   */
/* -------------------------------------------------------------------------- */

interface ShowcaseItem {
  slug: string;
  name: string;
  image: string | null;
  imageFallback: string | null;
  caption: string;
}

/**
 * Favourites, honestly sourced: the reader's own highest ratings when they
 * have written reviews, otherwise the best-reviewed games they've finished —
 * and the heading says which it is.
 */
function Showcase({ entries, reviews }: { entries: WatchlistEntry[]; reviews: Review[] | null }) {
  const art = new Map(entries.map((entry) => [entry.slug, entry]));
  const loved = (reviews ?? []).filter((review) => review.rating >= 8).sort((a, b) => b.rating - a.rating || b.updatedAt - a.updatedAt);
  let title = "Favourites";
  let subtitle: string | undefined;
  let items: ShowcaseItem[] = loved.slice(0, 6).map((review) => ({
    slug: review.slug,
    name: review.gameName,
    image: art.get(review.slug)?.image ?? null,
    imageFallback: art.get(review.slug)?.imageFallback ?? null,
    caption: `You rated it ${review.rating}/10`,
  }));
  if (items.length < 3) {
    const finished = entries.filter((entry) => entry.status === "played" && entry.metacritic !== null).sort((a, b) => (b.metacritic ?? 0) - (a.metacritic ?? 0));
    if (finished.length >= 3) {
      title = "Best of what you've finished";
      subtitle = "Rate games 8 or above to pick your own.";
      items = finished.slice(0, 6).map((entry) => ({ slug: entry.slug, name: entry.name, image: entry.image, imageFallback: entry.imageFallback, caption: `Critics: ${entry.metacritic}` }));
    }
  }
  if (items.length === 0) return null;

  return (
    <ProfileSection id="profile-favourites" title={title} subtitle={subtitle}>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {items.map((item) => (
          <li key={item.slug}>
            <Link prefetch={false} href={`/game/${item.slug}`} className="press group block">
              <span className="relative block aspect-[3/4] overflow-hidden rounded-xl shadow-[0_14px_30px_-18px_rgba(0,0,0,0.8)] ring-1 ring-inset ring-fg/10">
                <GameCover name={item.name} slug={item.slug} image={item.image} imageFallback={item.imageFallback} width={240} sizes="(max-width: 640px) 30vw, 120px" />
              </span>
              <span className="mt-1.5 block truncate text-[13px] font-semibold fine:group-hover:text-brand-soft">{item.name}</span>
              <span className="block truncate text-[11px] text-faint">{item.caption}</span>
            </Link>
          </li>
        ))}
      </ul>
    </ProfileSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Milestones                                                                 */
/* -------------------------------------------------------------------------- */

interface MilestoneDef {
  id: string;
  title: string;
  unit: [string, string];
  icon: typeof Trophy;
  tiers: number[];
  value: number;
  tone: string;
}

function Milestones({ entries, reviews }: { entries: WatchlistEntry[]; reviews: Review[] }) {
  const defs = useMemo<MilestoneDef[]>(() => {
    const owned = entries.filter((entry) => (entry.ownedOn ?? []).length > 0);
    const finished = entries.filter((entry) => entry.status === "played");
    const genres = new Set(entries.flatMap((entry) => (entry.genres ?? []).map((genre) => genre.id)));
    const decades = new Set(finished.flatMap((entry) => (entry.released ? [entry.released.slice(0, 3)] : [])));
    const stores = new Set(owned.flatMap((entry) => entry.ownedOn ?? []));
    const early = owned.filter((entry) => releaseState(entry) === "upcoming").length;
    return [
      { id: "collector", title: "Collector", unit: ["game owned", "games owned"], icon: Layers3, tiers: [1, 10, 25, 50, 100, 250], value: owned.length, tone: "from-[#8a72ff] to-[#5a3fe0]" },
      { id: "finisher", title: "Finisher", unit: ["game finished", "games finished"], icon: Trophy, tiers: [1, 5, 10, 25, 50, 100], value: finished.length, tone: "from-[#ffd60a] to-[#ff9f0a]" },
      { id: "critic", title: "Critic", unit: ["review", "reviews"], icon: MessageSquare, tiers: [1, 5, 10, 25, 50], value: reviews.length, tone: "from-[#ff6b86] to-[#ff375f]" },
      { id: "explorer", title: "Explorer", unit: ["genre", "genres"], icon: Compass, tiers: [3, 6, 10, 15], value: genres.size, tone: "from-[#64d2ff] to-[#0a84ff]" },
      { id: "time", title: "Time traveller", unit: ["decade finished", "decades finished"], icon: Clock3, tiers: [2, 3, 4, 5], value: decades.size, tone: "from-[#30d158] to-[#1f9d45]" },
      { id: "hopper", title: "Platform hopper", unit: ["store", "stores"], icon: Gamepad2, tiers: [2, 3, 5, 8], value: stores.size, tone: "from-[#bf5af2] to-[#8944ab]" },
      { id: "early", title: "Early adopter", unit: ["pre-order", "pre-orders"], icon: Gem, tiers: [1, 3, 5], value: early, tone: "from-[#ff9f0a] to-[#ff6b00]" },
    ];
  }, [entries, reviews]);

  const ranked = [...defs].sort((a, b) => levelOf(b) - levelOf(a));
  const earned = defs.filter((def) => levelOf(def) > 0).length;

  return (
    <>
      <p className="-mt-1 mb-3 text-[13px] tabular-nums text-faint">{earned} of {defs.length} earned</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ranked.map((def) => {
          const level = levelOf(def);
          const next = def.tiers[level];
          const prev = level > 0 ? def.tiers[level - 1] : 0;
          const progress = next ? (def.value - prev) / (next - prev) : 1;
          const Icon = def.icon;
          return (
            <li key={def.id} className={cn("flex items-center gap-3 rounded-2xl bg-fg/[0.045] p-3", level === 0 && "opacity-70")}>
              <span
                aria-hidden
                className={cn(
                  "relative grid h-12 w-12 shrink-0 place-items-center rounded-full",
                  level > 0 ? `bg-gradient-to-br ${def.tone} text-white shadow-[0_8px_20px_-10px_rgba(0,0,0,0.8)]` : "bg-fg/[0.08] text-faint",
                )}
              >
                <Icon size={20} />
                {level > 0 && (
                  <span className="absolute -bottom-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-bg px-1 text-[10px] font-bold tabular-nums text-text ring-1 ring-line">
                    {level}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15px] font-semibold">{def.title}</span>
                  <span className="shrink-0 text-[12px] text-faint">{level > 0 ? `Level ${level}` : "Locked"}</span>
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-muted">
                  {def.value} {def.value === 1 ? def.unit[0] : def.unit[1]}
                  {next ? ` · ${next - def.value} to ${level > 0 ? `level ${level + 1}` : "unlock"}` : " · top level"}
                </span>
                <span
                  role="progressbar"
                  aria-label={`${def.title} progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                  className="mt-1.5 block h-1 overflow-hidden rounded-full bg-fg/[0.08]"
                >
                  <span className={cn("block h-full rounded-full bg-gradient-to-r", def.tone)} style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function levelOf(def: MilestoneDef): number {
  return def.tiers.filter((tier) => def.value >= tier).length;
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                    */
/* -------------------------------------------------------------------------- */

function Reviews({ reviews }: { reviews: Review[] | null }) {
  const [all, setAll] = useState(false);
  if (reviews === null) {
    return (
      <ProfileSection id="profile-reviews" title="Your reviews">
        <Skeleton className="h-40 rounded-2xl" />
      </ProfileSection>
    );
  }
  if (reviews.length === 0) {
    return (
      <ProfileSection id="profile-reviews" title="Your reviews">
        <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center">
          <MessageSquare size={20} aria-hidden className="mx-auto text-faint" />
          <p className="mx-auto mt-2 max-w-xs text-[14px] text-muted">Rate a game you&apos;ve played and your review appears here.</p>
          <Button href="/browse" variant="secondary" size="sm" className="mt-4">Find something to rate</Button>
        </div>
      </ProfileSection>
    );
  }
  const shown = all ? reviews : reviews.slice(0, 3);
  return (
    <ProfileSection
      id="profile-reviews"
      title="Your reviews"
      action={reviews.length > 3 ? <button type="button" onClick={() => setAll((value) => !value)} className="press min-h-11 text-[15px] font-medium text-brand-soft">{all ? "Show fewer" : `See all ${reviews.length}`}</button> : undefined}
    >
      <ul className="overflow-hidden rounded-2xl border border-line bg-panel/55 light:bg-panel [&>*+*]:border-t [&>*+*]:border-line">
        {shown.map((review) => (
          <li key={review.id}>
            <Link prefetch={false} href={`/game/${review.slug}`} className="press block px-4 py-3.5 transition-colors fine:hover:bg-fg/[0.04]">
              <span className="flex items-start justify-between gap-4">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{review.gameName}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[14px] font-bold tabular-nums text-gold">
                  <Star size={13} className="fill-gold" aria-hidden />
                  {review.rating}
                  <span className="sr-only"> out of 10</span>
                </span>
              </span>
              {review.body && <span className="mt-1 line-clamp-2 block text-[14px] leading-relaxed text-muted">{review.body}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </ProfileSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Edit                                                                       */
/* -------------------------------------------------------------------------- */

function EditProfileSheet({ open, onClose, draft, onSave }: { open: boolean; onClose: () => void; draft: ProfileDraft; onSave: (draft: ProfileDraft) => Promise<void> }) {
  const { toast } = useToast();
  const [form, setForm] = useState(draft);
  const [saving, setSaving] = useState(false);
  // Re-seed from the saved profile each time the sheet opens, so a
  // cancelled edit never lingers into the next one.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setForm(draft);
  }
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => setForm((current) => ({ ...current, [key]: value }));
  const input = "min-h-12 w-full rounded-xl border border-line bg-fg/[0.04] px-4 text-base outline-none transition-colors focus:border-brand";

  const save = async () => {
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't save your profile.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Edit profile">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-muted">Display name</span>
          <input value={form.name} onChange={(event) => set("name", event.target.value)} maxLength={40} className={input} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-muted">Gaming handle <span className="font-normal text-faint">(optional)</span></span>
          <input
            value={form.gamerTag}
            onChange={(event) => set("gamerTag", event.target.value.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 32))}
            placeholder="Your handle across games"
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-muted">Bio <span className="font-normal text-faint">(optional)</span></span>
          <textarea
            value={form.bio}
            onChange={(event) => set("bio", event.target.value.slice(0, 280))}
            rows={3}
            placeholder="Tell people what you play."
            className="w-full resize-y rounded-xl border border-line bg-fg/[0.04] p-3.5 text-base outline-none transition-colors placeholder:text-faint focus:border-brand"
          />
          <span className="mt-1 block text-right text-[11px] tabular-nums text-faint">{form.bio.length}/280</span>
        </label>

        <ChoiceGroup
          title="Platforms and stores"
          options={OWNERSHIP_PLATFORMS.filter((platform) => platform.group !== "Legacy choices").map((platform) => ({ slug: platform.slug, name: platform.name, icon: platform.icon }))}
          selected={form.ownedPlatforms}
          onToggle={(slug) => set("ownedPlatforms", toggle(form.ownedPlatforms, slug))}
        />
        <ChoiceGroup
          title="Subscriptions"
          options={SUBSCRIPTION_SERVICES.map((service) => ({ slug: service.slug, name: service.name, icon: service.icon }))}
          selected={form.activeSubscriptions}
          onToggle={(slug) => set("activeSubscriptions", toggle(form.activeSubscriptions, slug))}
        />
        <fieldset>
          <legend className="text-[13px] font-medium text-muted">Play style</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["casual", "balanced", "dedicated", "competitive"] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => set("playStyle", form.playStyle === style ? null : style)}
                aria-pressed={form.playStyle === style}
                className={cn("min-h-11 rounded-full border px-4 text-[13px] font-semibold capitalize transition-colors", form.playStyle === style ? "border-brand/45 bg-brand/15 text-text" : "border-line bg-fg/[0.03] text-muted fine:hover:text-text")}
              >
                {style}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={save} loading={saving} icon={<Check size={15} />}>Save</Button>
          <Button onClick={onClose} variant="ghost">Cancel</Button>
        </div>
      </div>
    </Sheet>
  );
}

function toggle(values: string[], slug: string): string[] {
  return values.includes(slug) ? values.filter((value) => value !== slug) : [...values, slug];
}

function ChoiceGroup({ title, options, selected, onToggle }: { title: string; options: Array<{ slug: string; name: string; icon: string | null }>; selected: string[]; onToggle: (slug: string) => void }) {
  return (
    <fieldset>
      <legend className="text-[13px] font-medium text-muted">{title}</legend>
      <div className="mt-2 flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-2xl bg-fg/[0.03] p-2.5">
        {options.map((option) => {
          const active = selected.includes(option.slug);
          return (
            <button
              key={option.slug}
              type="button"
              onClick={() => onToggle(option.slug)}
              aria-pressed={active}
              className={cn("inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors", active ? "border-mint/40 bg-mint/12 text-text" : "border-line bg-fg/[0.025] text-muted fine:hover:text-text")}
            >
              {option.icon ? <BrandIcon name={option.icon} size={13} title={null} tinted={active} /> : <Gamepad2 size={13} aria-hidden />}
              <span className="truncate">{option.name}</span>
              {active && <Check size={12} aria-hidden className="shrink-0 text-mint" />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
