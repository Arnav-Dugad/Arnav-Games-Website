"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/AuthProvider";

const cache = new Map<string, boolean>();

/**
 * True when the signed-in account has admin rights. Asked once per account
 * per page load (with a forced token refresh, so a newly granted `admin`
 * claim is picked up). Purely for showing admin UI; the server re-checks.
 */
export function useIsAdmin(): boolean {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [admin, setAdmin] = useState(() => (uid ? cache.get(uid) ?? false : false));

  useEffect(() => {
    if (!user || !uid) return;
    const known = cache.get(uid);
    if (known !== undefined) {
      const frame = requestAnimationFrame(() => setAdmin(known));
      return () => cancelAnimationFrame(frame);
    }
    let cancelled = false;
    user
      .getIdToken(true)
      .then((token) => fetch("/api/admin/me", { headers: { Authorization: `Bearer ${token}` } }))
      .then((response) => (response.ok ? response.json() : { admin: false }))
      .then((body: { admin?: boolean }) => {
        cache.set(uid, Boolean(body.admin));
        if (!cancelled) setAdmin(Boolean(body.admin));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, uid]);

  return uid ? admin : false;
}
