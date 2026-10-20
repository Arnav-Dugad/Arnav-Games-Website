"use client";

/**
 * "What you paid": one purchase per game — amount, currency, store and date
 * — for the spending tracker on /stats. Opened from the ownership picker,
 * the long-press game menu and the game page's "Your play".
 *
 * The currency defaults to the reader's price region's and can be anything
 * the ECB publishes (and a few it doesn't — those are stored and simply left
 * out of converted totals, which say so). "Free" is one tap, because claimed
 * giveaways are a real part of most libraries and count as purchases at 0.
 */

import { useId, useMemo, useState } from "react";
import { Check, Gift, Trash2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { haptic } from "@/lib/haptics";
import { OWNERSHIP_PLATFORMS } from "@/lib/games/stores-catalog";
import { setPurchase, usePersonal, type GameRef } from "@/lib/personal/store";
import {
  atToDateInput,
  currencyChoices,
  currencyForRegion,
  dateInputToAt,
  moneyInputValue,
  parseMoney,
} from "@/lib/personal/spend";
import { usePriceRegion } from "@/lib/preferences/region";
import { cn } from "@/lib/utils/cn";

export function PurchaseSheet({ game, open, onClose }: { game: GameRef | null; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="What you paid" description={game?.name}>
      {open && game && <PurchaseForm key={game.id} game={game} onDone={onClose} />}
    </Sheet>
  );
}

/** Today's local date as an input value (the sheet only ever renders in the browser). */
function todayInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const fieldClass =
  "mt-2 block h-12 w-full rounded-xl border border-line bg-fg/[0.04] px-4 text-[16px] text-text focus:border-line-strong focus:outline-none";

function PurchaseForm({ game, onDone }: { game: GameRef; onDone: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { purchases } = usePersonal();
  const { ownershipOf } = useWatchlist();
  const [region] = usePriceRegion();
  const existing = purchases[game.id] ?? null;
  const owned = ownershipOf(game.id);
  const ids = { amount: useId(), currency: useId(), store: useId(), date: useId() };

  const [currency, setCurrency] = useState(existing?.currency ?? currencyForRegion(region));
  const [amount, setAmount] = useState(existing ? moneyInputValue(existing.amount, existing.currency) : "");
  const [store, setStore] = useState(existing?.store ?? owned[0] ?? "other");
  const [date, setDate] = useState(existing ? atToDateInput(existing.at) : todayInput());
  const [saving, setSaving] = useState(false);

  const minor = parseMoney(amount, currency);
  const at = dateInputToAt(date);
  // The date input caps at today (`max`); comparing input strings keeps render pure.
  const valid = minor !== null && at !== null && date <= todayInput();
  const stores = useMemo(() => {
    const mine = OWNERSHIP_PLATFORMS.filter((platform) => owned.includes(platform.slug));
    const rest = OWNERSHIP_PLATFORMS.filter((platform) => !owned.includes(platform.slug) && platform.group !== "Legacy choices");
    return [...mine, ...rest];
  }, [owned]);

  const save = async (value: { amount: number } | null) => {
    if (!user || saving) return;
    setSaving(true);
    try {
      await setPurchase(user.uid, game.id, value && at !== null ? { amount: value.amount, currency, store, at } : null);
      haptic("success");
      toast(value ? "Saved what you paid" : "Removed the price", "success");
      onDone();
    } catch (error) {
      haptic("warning");
      toast(error instanceof Error && /permission/i.test(error.message) ? "Saving prices isn't available yet. Try again later." : "Couldn't save that.", "error");
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) void save({ amount: minor! });
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <div>
          <label htmlFor={ids.amount} className="text-[13px] font-semibold text-text">Price</label>
          <input
            id={ids.amount}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            aria-invalid={amount !== "" && minor === null}
            className={cn(fieldClass, "font-display text-[20px] font-bold tabular-nums")}
          />
        </div>
        <div>
          <label htmlFor={ids.currency} className="text-[13px] font-semibold text-text">Currency</label>
          <select id={ids.currency} value={currency} onChange={(event) => setCurrency(event.target.value)} className={fieldClass}>
            {currencyChoices(currencyForRegion(region)).concat(existing && !currencyChoices(currencyForRegion(region)).includes(existing.currency) ? [existing.currency] : []).map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          haptic("selection");
          setAmount("0");
        }}
        aria-pressed={minor === 0}
        className={cn(
          "press inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors",
          minor === 0 ? "border-transparent bg-mint/15 text-text" : "border-line text-muted fine:hover:text-text",
        )}
      >
        <Gift size={15} aria-hidden /> It was free (a giveaway or bundle claim)
      </button>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={ids.store} className="text-[13px] font-semibold text-text">Where</label>
          <select id={ids.store} value={store} onChange={(event) => setStore(event.target.value)} className={fieldClass}>
            {stores.map((platform) => (
              <option key={platform.slug} value={platform.slug}>{platform.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.date} className="text-[13px] font-semibold text-text">When</label>
          <input id={ids.date} type="date" value={date} max={todayInput()} onChange={(event) => setDate(event.target.value)} className={fieldClass} />
        </div>
      </div>

      <p className="text-[12px] leading-relaxed text-faint">
        Private to you. Stats add up your purchases in your own currency and compare them with the lowest prices we&apos;ve seen.
      </p>

      <div className="flex gap-3">
        {existing && (
          <button
            type="button"
            onClick={() => void save(null)}
            disabled={saving}
            aria-label="Remove what you paid"
            className="press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-fg/[0.06] text-muted transition-colors fine:hover:text-flare disabled:opacity-45"
          >
            <Trash2 size={17} />
          </button>
        )}
        <button
          type="submit"
          disabled={!valid || saving}
          className="press inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-brand px-6 text-[15px] font-semibold text-white transition-opacity disabled:opacity-45"
        >
          <Check size={16} aria-hidden /> Save
        </button>
      </div>
    </form>
  );
}
