"use client";

/**
 * Community reviews backed by Firestore.
 *
 * One review per user per game (the document id is `gameId__uid`), so writing
 * again edits in place rather than creating duplicates. The list is a live
 * snapshot — a new review from another reader appears without a refresh.
 */

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MessagesSquare, Pencil, Star, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import {
  averageRating,
  deleteReview,
  subscribeGameReviews,
  upsertReview,
  type Review,
} from "@/lib/firebase/db";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils/cn";
import type { GameDetail } from "@/lib/games/types";

const RELATIVE = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

function timeAgo(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return RELATIVE.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return RELATIVE.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 2_592_000_000) return RELATIVE.format(Math.round(diff / 86_400_000), "day");
  return RELATIVE.format(Math.round(diff / 2_592_000_000), "month");
}

export function ReviewSection({ game }: { game: GameDetail }) {
  const { user, enabled } = useAuth();
  const { toast } = useToast();
  const [reviews, setReviews] = useState<Review[]>([]);
  // Nothing to load when Firebase is off, so don't start in a loading state.
  const [loading, setLoading] = useState(enabled);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    return subscribeGameReviews(
      game.id,
      (next) => {
        setReviews(next);
        setLoading(false);
      },
      (err) => {
        console.error("[reviews] subscription failed", err);
        setLoading(false);
      },
    );
  }, [game.id, enabled]);

  const mine = useMemo(
    () => (user ? reviews.find((r) => r.uid === user.uid) ?? null : null),
    [reviews, user],
  );
  const average = averageRating(reviews);

  const handleDelete = async () => {
    if (!user) return;
    try {
      await deleteReview(game.id, user.uid);
      toast("Your review was removed", "info");
      setComposing(false);
    } catch {
      toast("Couldn't remove your review.", "error");
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          {/* A sub-heading: this sits inside the page's "What players think" section. */}
          <h3 className="flex items-center gap-2 text-[17px] font-semibold text-text">
            <MessagesSquare size={16} aria-hidden className="text-[var(--game-accent)]" /> Reviews on Arnav Games
          </h3>
          <p className="mt-1 text-[13px] text-muted">
            {/* Neutral while loading, so "No reviews yet" never flashes over a
                list that is about to arrive. */}
            {loading
              ? "Ratings and reviews from players."
              : reviews.length === 0
              ? "No reviews yet — be the first."
              : `${reviews.length} ${reviews.length === 1 ? "review" : "reviews"} from players.`}
          </p>
        </div>

        {average !== null && (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel/50 px-4 py-3">
            <Star size={20} className="fill-gold text-gold" />
            <div>
              <p className="font-display text-2xl font-bold leading-none tabular-nums">
                {average.toFixed(1)}
                <span className="text-sm font-medium text-faint">/10</span>
              </p>
              <p className="mt-0.5 text-[11px] text-faint">Player average</p>
            </div>
          </div>
        )}
      </div>

      {!enabled ? (
        <Notice>
          Reviews need Firebase configured. Add your Firebase web-app keys to enable
          accounts, watchlists and reviews.
        </Notice>
      ) : !user ? (
        <Notice>
          <Link href={`/login?next=${encodeURIComponent(`/game/${game.slug}`)}`} className="font-semibold text-brand-soft underline underline-offset-2">
            Sign in
          </Link>{" "}
          to rate {game.name} and write a review.
        </Notice>
      ) : composing || !mine ? (
        <ReviewComposer
          game={game}
          existing={mine}
          onDone={() => setComposing(false)}
          onCancel={mine ? () => setComposing(false) : undefined}
        />
      ) : (
        <div className="mb-8 flex flex-wrap items-center gap-3 rounded-2xl border border-brand/25 bg-brand/[0.07] px-4 py-3.5">
          <p className="flex-1 text-sm text-muted">
            You rated this <span className="font-semibold text-text">{mine.rating}/10</span>.
          </p>
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-4 text-[13px] font-medium text-muted transition-colors hover:text-text"
          >
            <Pencil size={13} />
            Edit
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-flare/30 px-4 text-[13px] font-medium text-flare transition-colors hover:bg-flare/10"
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="shimmer-bg h-28 rounded-2xl" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        // The heading already says "No reviews yet — be the first" and the
        // compose / sign-in row above is the action; a second dashed "Nothing
        // here yet" box under it only repeated that.
        null
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {reviews.map((review) => (
              <motion.li
                key={review.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  "rounded-2xl border p-4 sm:p-5",
                  review.uid === user?.uid
                    ? "border-brand/30 bg-brand/[0.05]"
                    : "border-line bg-panel/40",
                )}
              >
                <div className="flex items-center gap-3">
                  <Avatar name={review.author} photo={review.photoURL} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {review.author}
                      {review.uid === user?.uid && (
                        <span className="ml-2 text-[11px] font-normal text-brand-soft">You</span>
                      )}
                    </p>
                    <p className="text-[11px] text-faint">{timeAgo(review.updatedAt)}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 rounded-lg bg-gold/12 px-2 py-1 text-sm font-bold text-gold tabular-nums">
                    <Star size={12} className="fill-gold" />
                    {review.rating}
                  </span>
                </div>
                {review.body && (
                  <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-muted">
                    {review.body}
                  </p>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

function ReviewComposer({
  game,
  existing,
  onDone,
  onCancel,
}: {
  game: GameDetail;
  existing: Review | null;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rating, setRating] = useState(existing?.rating ?? 8);
  const [body, setBody] = useState(existing?.body ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await upsertReview({
        gameId: game.id,
        slug: game.slug,
        gameName: game.name,
        uid: user.uid,
        author: user.displayName || user.email?.split("@")[0] || "Player",
        photoURL: user.photoURL,
        rating,
        body,
      });
      toast(existing ? "Review updated" : "Review posted", "success");
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save your review.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-8 rounded-2xl border border-line bg-panel/50 p-4 sm:p-5">
      <label htmlFor="review-rating" className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold">Your score</span>
        <span className="font-display text-2xl font-bold text-gold tabular-nums">
          {rating}
          <span className="text-sm text-faint">/10</span>
        </span>
      </label>

      {/* A range input gives free keyboard support and the native touch target. */}
      <input
        id="review-rating"
        type="range"
        min={1}
        max={10}
        step={1}
        value={rating}
        onChange={(e) => setRating(Number(e.target.value))}
        className="h-11 w-full cursor-pointer accent-[var(--color-gold)]"
      />
      <div className="mb-4 flex justify-between px-0.5 text-[10px] text-faint tabular-nums">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>

      <label htmlFor="review-body" className="mb-2 block text-sm font-semibold">
        Your thoughts <span className="font-normal text-faint">(optional)</span>
      </label>
      <textarea
        id="review-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder={`What did you make of ${game.name}?`}
        className="w-full resize-y rounded-xl border border-line bg-bg/60 p-3.5 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand"
      />

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" loading={saving} size="sm">
          {existing ? "Update review" : "Post review"}
        </Button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-muted transition-colors hover:text-text"
          >
            Cancel
          </button>
        )}
        <span className="ml-auto text-[11px] text-faint tabular-nums">{body.length}/4000</span>
      </div>
    </form>
  );
}

function Avatar({ name, photo }: { name: string; photo: string | null }) {
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />;
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return (
    <span
      aria-hidden
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white"
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 65% 45%), hsl(${(hue + 50) % 360} 65% 30%))`,
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Reveal className="mb-8 rounded-2xl border border-line bg-panel/50 px-4 py-4 text-sm text-muted">
      {children}
    </Reveal>
  );
}
