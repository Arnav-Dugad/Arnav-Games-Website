"use client";

/**
 * Mounted once (SiteChrome). Listens for `openSessionLog(game)` and
 * `openPurchaseEditor(game)` from anywhere — the long-press game menu,
 * library posters, the ownership picker, the game page — and opens the
 * matching sheet, whose code is only fetched the first time it's asked for.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { EDIT_PURCHASE_EVENT, LOG_SESSION_EVENT, type GameRef } from "@/lib/personal/store";

const SessionSheet = dynamic(() => import("./SessionSheet").then((mod) => mod.SessionSheet), { ssr: false });
const PurchaseSheet = dynamic(() => import("./PurchaseSheet").then((mod) => mod.PurchaseSheet), { ssr: false });

type Kind = "session" | "purchase";

export function SessionLogHost() {
  const { user } = useAuth();
  const router = useRouter();
  const [target, setTarget] = useState<{ kind: Kind; game: GameRef } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const listen = (kind: Kind) => (event: Event) => {
      const detail = (event as CustomEvent<GameRef>).detail;
      if (!detail) return;
      if (!user) {
        router.push(`/login?next=${encodeURIComponent(`/game/${detail.slug}`)}`);
        return;
      }
      setTarget({ kind, game: detail });
      setOpen(true);
    };
    const onLog = listen("session");
    const onPurchase = listen("purchase");
    window.addEventListener(LOG_SESSION_EVENT, onLog);
    window.addEventListener(EDIT_PURCHASE_EVENT, onPurchase);
    return () => {
      window.removeEventListener(LOG_SESSION_EVENT, onLog);
      window.removeEventListener(EDIT_PURCHASE_EVENT, onPurchase);
    };
  }, [user, router]);

  if (!target) return null;
  return target.kind === "session"
    ? <SessionSheet game={target.game} open={open} onClose={() => setOpen(false)} />
    : <PurchaseSheet game={target.game} open={open} onClose={() => setOpen(false)} />;
}
