"use client";

/**
 * Player tags: how readers describe a game ("Cozy", "Great co-op"), counted
 * across everyone, plus the reader's own picks.
 *
 * Reads go straight to Firestore from the browser — the public counts doc
 * (`communityTags/{gameId}`) and, signed in, the reader's own record — so
 * showing tags costs no Worker request. Saving goes through `POST /api/tags`,
 * the only writer of the counts (see that route for why).
 */

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { Check, Lock, Plus, Tag, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { getDb } from "@/lib/firebase/config";
import {
  MAX_CUSTOM_TAGS,
  MAX_PLAYER_TAGS,
  PLAYER_TAGS,
  cleanCustomTag,
  isPlayerTag,
  topPlayerTags,
  type MyTags,
  type PlayerTag,
} from "@/lib/games/community-tags";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import { useRouter } from "next/navigation";

interface Loaded {
  counts: Record<string, number>;
  mine: MyTags;
}

export function PlayerTags({ gameId, gameName, slug }: { gameId: number; gameName: string; slug: string }) {
  const { user, enabled } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [open, setOpen] = useState(false);
  const uid = user?.uid ?? null;

  useEffect(() => {
    const db = getDb();
    if (!db) return;
    let live = true;
    void Promise.all([
      getDoc(doc(db, "communityTags", String(gameId))).catch(() => null),
      uid ? getDoc(doc(db, "users", uid, "gameTags", String(gameId))).catch(() => null) : Promise.resolve(null),
    ]).then(([community, own]) => {
      if (!live) return;
      const counts = (community?.data()?.counts ?? {}) as Record<string, number>;
      const mineRaw = own?.data() as { tags?: unknown[]; custom?: unknown[] } | undefined;
      setData({
        counts,
        mine: {
          tags: (mineRaw?.tags ?? []).filter(isPlayerTag),
          custom: (mineRaw?.custom ?? []).filter((tag): tag is string => typeof tag === "string"),
        },
      });
    });
    return () => {
      live = false;
    };
  }, [gameId, uid]);

  if (!enabled || !data) return null;
  const top = topPlayerTags(data.counts);
  const mine = new Set(data.mine.tags);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-text">Player tags</h3>
        <button
          type="button"
          onClick={() => {
            if (!uid) return router.push(`/login?next=${encodeURIComponent(`/game/${slug}`)}`);
            haptic("selection");
            setOpen(true);
          }}
          className="press inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[color-mix(in_oklab,var(--game-accent,var(--color-brand-soft))_72%,var(--color-text))] fine:hover:bg-fg/[0.06] coarse:min-h-11"
        >
          <Tag size={14} aria-hidden /> {mine.size || data.mine.custom.length ? "Edit your tags" : "Tag this game"}
        </button>
      </div>
      {top.length > 0 || data.mine.custom.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Player tags, most used first">
          {top.map(({ tag, count }) => (
            <li
              key={tag}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium",
                mine.has(tag) ? "border-[var(--game-accent,var(--color-brand))]/50 bg-[var(--game-accent,var(--color-brand))]/12 text-text" : "border-line bg-fg/[0.04] text-text",
              )}
            >
              {PLAYER_TAGS[tag]}
              <span className="tabular-nums text-faint">{count}</span>
            </li>
          ))}
          {data.mine.custom.map((tag) => (
            <li key={`custom-${tag}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-dashed border-line px-3 text-[13px] text-muted">
              <Lock size={11} aria-label="Only you see this" />
              {tag}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-muted">No player tags yet.</p>
      )}

      {uid && (
        <TagSheet
          open={open}
          onClose={() => setOpen(false)}
          gameId={gameId}
          gameName={gameName}
          initial={data.mine}
          onSaved={(next) =>
            setData((current) => {
              if (!current) return current;
              // Move the visible counts by this reader's change, as the server did.
              const counts = { ...current.counts };
              for (const tag of next.tags) if (!current.mine.tags.includes(tag)) counts[tag] = (counts[tag] ?? 0) + 1;
              for (const tag of current.mine.tags) if (!next.tags.includes(tag)) counts[tag] = Math.max(0, (counts[tag] ?? 0) - 1);
              return { counts, mine: next };
            })
          }
        />
      )}
    </div>
  );
}

function TagSheet({
  open,
  onClose,
  gameId,
  gameName,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  gameId: number;
  gameName: string;
  initial: MyTags;
  onSaved: (tags: MyTags) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Your tags" description={gameName}>
      {open && <TagForm gameId={gameId} initial={initial} onDone={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function TagForm({ gameId, initial, onDone, onSaved }: { gameId: number; initial: MyTags; onDone: () => void; onSaved: (tags: MyTags) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tags, setTags] = useState<PlayerTag[]>(initial.tags);
  const [custom, setCustom] = useState<string[]>(initial.custom);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const full = tags.length >= MAX_PLAYER_TAGS;

  const addCustom = () => {
    const tag = cleanCustomTag(draft);
    if (!tag || custom.length >= MAX_CUSTOM_TAGS || custom.includes(tag)) return;
    haptic("selection");
    setCustom([...custom, tag]);
    setDraft("");
  };

  return (
    <form
      className="space-y-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!user || saving) return;
        setSaving(true);
        try {
          const res = await fetch("/api/tags", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
            body: JSON.stringify({ gameId, tags, custom }),
          });
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) throw new Error(json.error ?? "Couldn't save your tags.");
          haptic("success");
          onSaved({ tags, custom });
          onDone();
        } catch (error) {
          haptic("warning");
          toast(error instanceof Error ? error.message : "Couldn't save your tags.", "error");
          setSaving(false);
        }
      }}
    >
      <fieldset>
        <legend className="flex w-full items-baseline justify-between text-[13px] font-semibold text-text">
          Pick up to {MAX_PLAYER_TAGS}
          <span className="text-[12px] font-normal tabular-nums text-muted">{tags.length} of {MAX_PLAYER_TAGS}</span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(Object.keys(PLAYER_TAGS) as PlayerTag[]).map((tag) => {
            const on = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => {
                  haptic("selection");
                  setTags(on ? tags.filter((item) => item !== tag) : [...tags, tag]);
                }}
                className={cn(
                  "press inline-flex min-h-10 items-center gap-1 rounded-full border px-3 text-[13px] font-semibold transition-colors disabled:opacity-40 coarse:min-h-11",
                  on ? "border-transparent bg-brand text-white" : "border-line bg-fg/[0.04] text-text fine:hover:border-line-strong",
                )}
              >
                {on && <Check size={13} aria-hidden />}
                {PLAYER_TAGS[tag]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="custom-tag" className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <Lock size={13} aria-hidden className="text-faint" /> Your own tags <span className="font-normal text-faint">(only you see these)</span>
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="custom-tag"
            value={draft}
            maxLength={32}
            disabled={custom.length >= MAX_CUSTOM_TAGS}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustom();
              }
            }}
            placeholder={custom.length >= MAX_CUSTOM_TAGS ? `Up to ${MAX_CUSTOM_TAGS}` : "e.g. Play with Sam"}
            className="block min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-fg/[0.04] px-4 text-[16px] text-text placeholder:text-faint focus:border-line-strong focus:outline-none disabled:opacity-50"
          />
          <button type="button" aria-label="Add tag" onClick={addCustom} disabled={!cleanCustomTag(draft) || custom.length >= MAX_CUSTOM_TAGS} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-fg/[0.06] text-text disabled:opacity-40">
            <Plus size={16} />
          </button>
        </div>
        {custom.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {custom.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => setCustom(custom.filter((item) => item !== tag))}
                  aria-label={`Remove ${tag}`}
                  className="press inline-flex min-h-10 items-center gap-1 rounded-full border border-dashed border-line px-3 text-[13px] text-text coarse:min-h-11"
                >
                  {tag} <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="submit"
        disabled={saving}
        className="press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brand px-6 text-[15px] font-semibold text-white transition-opacity disabled:opacity-45"
      >
        <Check size={16} aria-hidden /> Save
      </button>
    </form>
  );
}
