"use client";

/**
 * Mounted once (SiteChrome). Listens for `openSessionLog(game)` from anywhere
 * — the long-press game menu, library posters, the game page — and opens the
 * session sheet, whose code is only fetched the first time it's asked for.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { LOG_SESSION_EVENT, type GameRef } from "@/lib/personal/store";

const SessionSheet = dynamic(() => import("./SessionSheet").then((mod) => mod.SessionSheet), { ssr: false });

export function SessionLogHost() {
  const { user } = useAuth();
  const router = useRouter();
  const [game, setGame] = useState<GameRef | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onLog = (event: Event) => {
      const detail = (event as CustomEvent<GameRef>).detail;
      if (!detail) return;
      if (!user) {
        router.push(`/login?next=${encodeURIComponent(`/game/${detail.slug}`)}`);
        return;
      }
      setGame(detail);
      setOpen(true);
    };
    window.addEventListener(LOG_SESSION_EVENT, onLog);
    return () => window.removeEventListener(LOG_SESSION_EVENT, onLog);
  }, [user, router]);

  return game ? <SessionSheet game={game} open={open} onClose={() => setOpen(false)} /> : null;
}
