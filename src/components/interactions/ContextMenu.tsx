"use client";

/**
 * The game context menu: long-press on touch, right-click / ContextMenu key /
 * Shift+F10 on desktop.
 *
 * One host, mounted once in SiteChrome, owns every listener (see
 * `game-menu-targets.ts` for why cards carry none). It renders in three
 * presentations, because the gesture tells us where the reader's attention is:
 *
 *  - `lift` (touch long-press): the card's poster rises out of the page over
 *    a dimmed, blurred backdrop — iOS's preview — with the menu below it.
 *  - `point` (right-click): a compact menu at the cursor, macOS-style, no dim.
 *  - `anchor` (keyboard): the same menu, attached to the focused card.
 *
 * Shift+right-click deliberately falls through to the browser's own menu, so
 * "Copy link address" and friends stay one modifier away.
 */

import { AnimatePresence, motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  BellPlus,
  BellRing,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  ExternalLink,
  EyeOff,
  Gamepad2,
  Library,
  Loader2,
  Plus,
  Share,
  ThumbsUp,
  Trophy,
} from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { compareHref } from "@/components/compare/types";
import { useToast } from "@/components/ui/Toast";
import { useLockBodyScroll, usePointerFine } from "@/hooks";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { useWatchlist } from "@/lib/firebase/WatchlistProvider";
import { OWNERSHIP_PLATFORMS } from "@/lib/games/stores-catalog";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils/cn";
import { isUnreleased, releaseLabel } from "@/lib/utils/format";
import type { WatchStatus } from "@/lib/firebase/db";
import { GAME_MENU_PREVIEW_SELECTOR, resolveGameMenuTarget, type GameMenuTarget } from "./game-menu-targets";
import { useCalmMotion } from "./motion-prefs";

/** Long enough not to fire on a slow tap, short enough to feel responsive. */
const LONG_PRESS_MS = 420;
/** A finger drifting further than this is scrolling, not pressing. */
const MOVE_TOLERANCE = 8;
const EDGE = 12;
const GAP = 12;

type Mode = "lift" | "point" | "anchor";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface MenuState {
  id: number;
  target: GameMenuTarget;
  mode: Mode;
  /** The lifted / anchoring element's viewport rect at open time. */
  rect: Rect;
  point: { x: number; y: number } | null;
  /** Detached clone of the poster, for the lifted preview. */
  preview: HTMLElement | null;
  returnFocus: HTMLElement | null;
}

interface Layout {
  menuTop: number;
  menuLeft: number;
  origin: string;
  /** Lift only: transform taking the preview from its rect to its raised spot. */
  lift: { x: number; y: number; scale: number } | null;
}

function toRect(rect: DOMRect): Rect {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function clonePreview(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.removeAttribute("id");
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("tabindex", "-1");
  clone.inert = true;
  // The clone is laid out by its new container, not by the card's grid slot.
  clone.style.width = "100%";
  clone.style.height = "100%";
  clone.style.margin = "0";
  clone.style.transform = "none";
  clone.style.pointerEvents = "none";
  for (const node of clone.querySelectorAll<HTMLElement>("[id]")) node.removeAttribute("id");
  return clone;
}

let nextMenuId = 1;

export function ContextMenuHost() {
  const [state, setState] = useState<MenuState | null>(null);
  const stateRef = useRef<MenuState | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const close = useCallback(() => setState(null), []);

  // A navigation (including "Open") retires the menu.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    if (state) setState(null);
  }

  useEffect(() => {
    let press: {
      pointerId: number;
      x: number;
      y: number;
      timer: ReturnType<typeof setTimeout>;
      element: HTMLElement;
      target: GameMenuTarget;
    } | null = null;
    /** Swallows the click a long-press would otherwise turn into a navigation. */
    let suppressClick = false;
    let keyboardAt = 0;

    const open = (element: HTMLElement, target: GameMenuTarget, mode: Mode, point: { x: number; y: number } | null) => {
      if (stateRef.current) return;
      const previewSource = element.querySelector<HTMLElement>(GAME_MENU_PREVIEW_SELECTOR) ?? element;
      const rect = toRect(previewSource.getBoundingClientRect());
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const next: MenuState = {
        id: nextMenuId++,
        target,
        mode,
        rect,
        point,
        preview: mode === "lift" ? clonePreview(previewSource) : null,
        returnFocus: active && element.contains(active) ? active : element.querySelector<HTMLElement>("a[href]"),
      };
      stateRef.current = next;
      setState(next);
      if (mode === "lift") haptic("medium");
    };

    const cancelPress = () => {
      if (!press) return;
      clearTimeout(press.timer);
      press = null;
    };

    const onPointerDown = (event: PointerEvent) => {
      // A fresh touch means any earlier long-press click has come and gone.
      suppressClick = false;
      if (event.pointerType !== "touch" || !event.isPrimary || stateRef.current) return;
      const hit = resolveGameMenuTarget(event.target);
      if (!hit) return;
      cancelPress();
      press = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        element: hit.element,
        target: hit.target,
        timer: setTimeout(() => {
          const fired = press;
          press = null;
          if (!fired || !fired.element.isConnected) return;
          suppressClick = true;
          open(fired.element, fired.target, "lift", null);
        }, LONG_PRESS_MS),
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.pointerId) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (press && event.pointerId === press.pointerId) cancelPress();
    };

    const onClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const onContextMenu = (event: MouseEvent) => {
      const hit = resolveGameMenuTarget(event.target);
      if (!hit) return;
      // Escape hatch to the browser's own menu ("Open in new window", etc.).
      if (event.shiftKey && performance.now() - keyboardAt > 250) return;
      event.preventDefault();
      if (stateRef.current) return;
      const pointerType = (event as PointerEvent).pointerType;
      const fromKeyboard = performance.now() - keyboardAt < 250 || (event.button === 0 && event.clientX === 0 && event.clientY === 0);
      if (pointerType === "touch") {
        // Android's own long-press can beat our timer if the finger wobbled.
        cancelPress();
        suppressClick = true;
        open(hit.element, hit.target, "lift", null);
      } else if (fromKeyboard) {
        open(hit.element, hit.target, "anchor", null);
      } else {
        open(hit.element, hit.target, "point", { x: event.clientX, y: event.clientY });
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      const hit = resolveGameMenuTarget(document.activeElement);
      if (!hit) return;
      event.preventDefault();
      keyboardAt = performance.now();
      open(hit.element, hit.target, "anchor", null);
    };

    // While a lifted menu is up, the page underneath must not scroll — iOS
    // ignores `overflow: hidden` on <body> for touch scrolling. The menu's own
    // scrolling list opts back in.
    const onTouchMove = (event: TouchEvent) => {
      if (stateRef.current?.mode !== "lift") return;
      if (event.target instanceof Element && event.target.closest("[data-menu-scroll]")) return;
      if (event.cancelable) event.preventDefault();
    };

    const passive = { passive: true, capture: true } as const;
    document.addEventListener("pointerdown", onPointerDown, passive);
    document.addEventListener("pointermove", onPointerMove, passive);
    document.addEventListener("pointerup", onPointerEnd, passive);
    document.addEventListener("pointercancel", onPointerEnd, passive);
    document.addEventListener("scroll", cancelPress, passive);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    // Window capture runs before React's root listeners, so the swallowed
    // click never reaches the card's <Link>.
    window.addEventListener("click", onClick, true);
    return () => {
      cancelPress();
      document.removeEventListener("pointerdown", onPointerDown, passive);
      document.removeEventListener("pointermove", onPointerMove, passive);
      document.removeEventListener("pointerup", onPointerEnd, passive);
      document.removeEventListener("pointercancel", onPointerEnd, passive);
      document.removeEventListener("scroll", cancelPress, passive);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  useLockBodyScroll(state?.mode === "lift");

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {state && <MenuLayer key={state.id} state={state} onClose={close} />}
    </AnimatePresence>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */

function MenuLayer({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const calm = useCalmMotion();
  const { mode, rect, point } = state;

  // Measure, then place — before paint, so nothing is drawn in the wrong spot.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const vw = document.documentElement.clientWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const menuW = menu.offsetWidth;
    const menuH = menu.offsetHeight;
    const clampX = (x: number) => Math.max(EDGE, Math.min(x, vw - EDGE - menuW));
    const clampY = (y: number) => Math.max(EDGE, Math.min(y, vh - EDGE - menuH));

    let next: Layout;
    if (mode === "lift") {
      // Raise slightly, but shrink if the poster and menu can't both fit.
      let scale = 1.05;
      const room = vh - EDGE * 2 - GAP - menuH;
      if (rect.height * scale > room) scale = Math.max(0.45, room / rect.height);
      const width = rect.width * scale;
      const height = rect.height * scale;
      const left = Math.max(EDGE, Math.min(rect.left + (rect.width - width) / 2, vw - EDGE - width));
      let top = rect.top + (rect.height - height) / 2;
      if (top + height + GAP + menuH > vh - EDGE) top = vh - EDGE - menuH - GAP - height;
      if (top < EDGE) top = EDGE;
      const alignLeft = left + width / 2 < vw / 2;
      const menuLeft = clampX(alignLeft ? left : left + width - menuW);
      next = {
        menuTop: top + height + GAP,
        menuLeft,
        origin: alignLeft ? "top left" : "top right",
        lift: {
          x: left + width / 2 - (rect.left + rect.width / 2),
          y: top + height / 2 - (rect.top + rect.height / 2),
          scale,
        },
      };
    } else if (mode === "point" && point) {
      const flipX = point.x + menuW > vw - EDGE;
      const flipY = point.y + menuH > vh - EDGE;
      next = {
        menuLeft: clampX(flipX ? point.x - menuW : point.x),
        menuTop: clampY(flipY ? point.y - menuH : point.y),
        origin: `${flipY ? "bottom" : "top"} ${flipX ? "right" : "left"}`,
        lift: null,
      };
    } else {
      const below = rect.top + rect.height + 8;
      const fitsBelow = below + menuH <= vh - EDGE;
      next = {
        menuLeft: clampX(rect.left),
        menuTop: clampY(fitsBelow ? below : rect.top - 8 - menuH),
        origin: fitsBelow ? "top left" : "bottom left",
        lift: null,
      };
    }
    setLayout(next);
  }, [mode, rect, point]);

  // The clone is a detached DOM subtree; it is adopted imperatively.
  useLayoutEffect(() => {
    const host = previewRef.current;
    if (host && state.preview && !host.contains(state.preview)) host.appendChild(state.preview);
  }, [state.preview]);

  // Pointer menus close on scroll/resize like native ones; the lifted menu
  // has the page locked instead.
  useEffect(() => {
    if (mode === "lift") return;
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, { passive: true, capture: true });
    return () => {
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, { capture: true });
    };
  }, [mode, onClose]);

  const spring = calm ? { duration: 0 } : { type: "spring" as const, stiffness: 460, damping: 34, mass: 0.8 };
  const lifted = mode === "lift";

  return (
    <div className="fixed inset-0 z-(--z-menu)" data-context-menu-layer>
      <motion.div
        aria-hidden
        className={cn("absolute inset-0", lifted ? "bg-black/45 backdrop-blur-md light:bg-black/20" : "bg-transparent")}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: calm ? 0 : 0.22 }}
        onPointerDown={(event) => {
          // Right-clicking the backdrop just closes; it must not then open
          // the browser's menu on top.
          event.preventDefault();
          onClose();
        }}
        onContextMenu={(event) => event.preventDefault()}
      />

      {lifted && (
        <motion.div
          ref={previewRef}
          aria-hidden
          className="menu-lift-shadow pointer-events-none fixed overflow-hidden rounded-2xl will-change-transform"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          initial={{ x: 0, y: 0, scale: 1 }}
          animate={layout?.lift ?? { x: 0, y: 0, scale: 1 }}
          exit={{ x: 0, y: 0, scale: 1, opacity: 0, transition: { duration: calm ? 0 : 0.24 } }}
          transition={spring}
        />
      )}

      <motion.div
        style={{
          top: layout?.menuTop ?? 0,
          left: layout?.menuLeft ?? 0,
          transformOrigin: layout?.origin ?? "top left",
          visibility: layout ? "visible" : "hidden",
        }}
        className="fixed"
        initial={{ opacity: 0, scale: lifted ? 0.6 : 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: lifted ? 0.7 : 0.96, transition: { duration: calm ? 0 : 0.14 } }}
        transition={lifted ? spring : { duration: calm ? 0 : 0.14, ease: [0.16, 1, 0.3, 1] }}
      >
        <GameMenu ref={menuRef} state={state} onClose={onClose} ready={layout !== null} />
      </motion.div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const STATUS_ITEMS: { value: Exclude<WatchStatus, "none">; label: string; icon: typeof Bookmark }[] = [
  { value: "want", label: "Want to play", icon: Bookmark },
  { value: "playing", label: "Playing", icon: Gamepad2 },
  { value: "played", label: "Played", icon: Trophy },
];

const ITEM_SELECTOR = "[role^='menuitem']:not([disabled])";

function GameMenu({
  ref,
  state,
  onClose,
  ready,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  state: MenuState;
  onClose: () => void;
  ready: boolean;
}) {
  const { game, claimCover, recommendation } = state.target;
  const { user, enabled } = useAuth();
  const { isFollowed, toggleFollow, statusOf, setStatus, ensure, ownershipOf, setOwnership } = useWatchlist();
  const { toast } = useToast();
  const router = useRouter();
  const fine = usePointerFine();
  const [panel, setPanel] = useState<"main" | "own">("main");
  const [pendingOwned, setPendingOwned] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const href = `/game/${game.slug}`;
  const followed = isFollowed(game.id);
  const status = statusOf(game.id);
  const owned = pendingOwned ?? ownershipOf(game.id);
  const statuses = isUnreleased(game) ? STATUS_ITEMS.filter((item) => item.value === "want") : STATUS_ITEMS;

  // Focus the first item once placed; restore focus to the card on close.
  useEffect(() => {
    if (!ready) return;
    const first = ref.current?.querySelector<HTMLElement>(ITEM_SELECTOR);
    first?.focus({ preventScroll: true });
  }, [ready, panel, ref]);

  useEffect(() => {
    const returnTo = state.returnFocus;
    const mode = state.mode;
    return () => {
      // Touch users never had keyboard focus on the card; moving it there
      // would only draw a stray focus ring.
      if (mode !== "lift" && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [state.returnFocus, state.mode]);

  // Escape is handled at the document, not on the menu element: on touch the
  // menu may never have held focus, and a hardware keyboard must still close
  // it. In the ownership panel it steps back first, like a nested iOS menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (panel === "own") setPanel("main");
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel, onClose]);

  /** Signed-out and unconfigured paths mirror WatchButton / StatusPicker. */
  const requireAccount = (): boolean => {
    if (!enabled) {
      toast("Sign-in isn't configured for this deployment yet.", "info");
      onClose();
      return false;
    }
    if (!user) {
      onClose();
      router.push(`/login?next=${encodeURIComponent(href)}`);
      return false;
    }
    return true;
  };

  const openGame = () => {
    claimCover?.();
    onClose();
    router.push(href);
  };

  const follow = async () => {
    if (!requireAccount()) return;
    onClose();
    try {
      const now = await toggleFollow(game);
      haptic("success");
      toast(now ? `Following ${game.name} — release and DLC alerts are on` : `Unfollowed ${game.name}`, now ? "success" : "info");
    } catch (err) {
      haptic("warning");
      toast(err instanceof Error ? err.message : "Couldn't update your watchlist.", "error");
    }
  };

  const chooseStatus = async (value: WatchStatus) => {
    if (!requireAccount()) return;
    // Choosing the current status again clears it — a menu has no separate
    // "No status" row to reach for.
    const next: WatchStatus = status === value ? "none" : value;
    onClose();
    try {
      await ensure(game);
      await setStatus(game.id, next);
      haptic("success");
      toast(
        next === "none"
          ? "Play status cleared"
          : `Marked as ${STATUS_ITEMS.find((item) => item.value === next)?.label.toLowerCase()}`,
        "success",
      );
    } catch (err) {
      haptic("warning");
      toast(err instanceof Error ? err.message : "Couldn't save that.", "error");
    }
  };

  const toggleOwned = async (slug: string) => {
    if (busy || !requireAccount()) return;
    const next = owned.includes(slug) ? owned.filter((entry) => entry !== slug) : [...owned, slug];
    setPendingOwned(next);
    setBusy(true);
    haptic("selection");
    try {
      // Ownership lives on the library record, which has to exist first.
      await ensure(game);
      await setOwnership(game.id, next);
    } catch (err) {
      setPendingOwned(null);
      haptic("warning");
      toast(err instanceof Error ? err.message : "Couldn't save that.", "error");
    } finally {
      setBusy(false);
    }
  };

  // Opens the compare page with this game in the first column and the
  // picker already up, so the next tap is choosing what to compare it with.
  const compare = () => {
    onClose();
    haptic("selection");
    router.push(compareHref([game.slug], true));
  };

  const share = async () => {
    const url = new URL(href, window.location.origin).toString();
    onClose();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: game.name, url });
        return;
      } catch (err) {
        // Dismissing the share sheet is a choice, not a failure.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied to the clipboard", "success");
    } catch {
      toast("Couldn't copy the link — your browser blocked clipboard access.", "error");
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(items.length - 1);
        break;
      case "Tab":
        // Focus stays inside the menu until it is dismissed.
        event.preventDefault();
        focusAt(index + (event.shiftKey ? -1 : 1));
        break;
      case "ArrowLeft":
        if (panel === "own") {
          event.preventDefault();
          setPanel("main");
        }
        break;
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${game.name}`}
      onKeyDown={onKeyDown}
      className="material material-menu w-[min(16.5rem,calc(100vw-1.5rem))] overflow-hidden rounded-[20px] p-1.5 fine:w-60 fine:rounded-[14px] fine:p-1"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {panel === "main" ? (
          <motion.div
            key="main"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="px-3 pb-2 pt-2 fine:px-2.5 fine:pb-1.5 fine:pt-1.5" aria-hidden>
              <p className="truncate text-[13px] font-semibold leading-tight text-text">{game.name}</p>
              <p className="mt-0.5 truncate text-[11px] text-faint">{releaseLabel(game)}</p>
            </div>
            <Separator />
            <MenuItem icon={<ArrowUpRight size={17} />} onSelect={openGame}>
              Open
            </MenuItem>
            {fine && (
              <MenuItem
                icon={<ExternalLink size={16} />}
                onSelect={() => {
                  onClose();
                  window.open(href, "_blank", "noopener");
                }}
              >
                Open in new tab
              </MenuItem>
            )}
            {recommendation && (
              <>
                <Separator />
                <div role="group" aria-label="Tune your picks">
                  <MenuItem
                    role="menuitemcheckbox"
                    checked={recommendation.current === "up"}
                    icon={<ThumbsUp size={16} />}
                    onSelect={() => {
                      onClose();
                      recommendation.onFeedback("up");
                    }}
                  >
                    More like this
                  </MenuItem>
                  <MenuItem
                    icon={<EyeOff size={16} />}
                    onSelect={() => {
                      onClose();
                      recommendation.onFeedback("not-interested");
                    }}
                  >
                    Not interested
                  </MenuItem>
                </div>
              </>
            )}
            <Separator />
            <MenuItem icon={followed ? <BellRing size={17} /> : <BellPlus size={17} />} onSelect={follow}>
              {followed ? "Unfollow" : "Follow"}
            </MenuItem>
            <Separator />
            <div role="group" aria-label="Play status">
              {statuses.map((item) => {
                const Icon = item.icon;
                const checked = status === item.value;
                return (
                  <MenuItem
                    key={item.value}
                    role="menuitemcheckbox"
                    checked={checked}
                    icon={<Icon size={17} />}
                    onSelect={() => chooseStatus(item.value)}
                  >
                    {item.label}
                  </MenuItem>
                );
              })}
            </div>
            <Separator />
            <MenuItem
              icon={<Library size={17} />}
              trailing={
                <span className="flex items-center gap-1 text-faint">
                  {owned.length > 0 && <span className="text-[12px] tabular-nums text-mint">{owned.length}</span>}
                  <ChevronRight size={15} />
                </span>
              }
              aria-haspopup="menu"
              onSelect={() => {
                if (!requireAccount()) return;
                setPanel("own");
              }}
            >
              I own this…
            </MenuItem>
            <MenuItem icon={<Columns3 size={16} />} onSelect={compare}>
              Compare with…
            </MenuItem>
            <MenuItem icon={<Share size={16} />} onSelect={share}>
              Share
            </MenuItem>
          </motion.div>
        ) : (
          <motion.div
            key="own"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <MenuItem icon={<ChevronLeft size={17} />} onSelect={() => setPanel("main")}>
              <span className="font-semibold">Where do you own it?</span>
            </MenuItem>
            <Separator />
            <div
              role="group"
              aria-label="Owned on"
              data-menu-scroll
              className="max-h-[min(50dvh,20rem)] overflow-y-auto overscroll-contain"
            >
              {OWNERSHIP_PLATFORMS.map((platform) => (
                <MenuItem
                  key={platform.slug}
                  role="menuitemcheckbox"
                  checked={owned.includes(platform.slug)}
                  icon={
                    platform.icon ? (
                      <BrandIcon name={platform.icon} size={15} title={null} tinted={owned.includes(platform.slug)} />
                    ) : (
                      <Plus size={15} />
                    )
                  }
                  onSelect={() => toggleOwned(platform.slug)}
                >
                  {platform.name}
                </MenuItem>
              ))}
            </div>
            {busy && (
              <p className="flex items-center gap-2 px-3 py-2 text-[11px] text-faint" role="status">
                <Loader2 size={12} className="animate-spin" /> Saving…
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Separator() {
  return <div role="separator" className="mx-2 my-1 h-px bg-fg/10 fine:mx-1.5" />;
}

function MenuItem({
  children,
  icon,
  trailing,
  onSelect,
  role = "menuitem",
  checked,
  ...rest
}: {
  children: ReactNode;
  icon?: ReactNode;
  trailing?: ReactNode;
  onSelect: () => void;
  role?: "menuitem" | "menuitemcheckbox";
  checked?: boolean;
  "aria-haspopup"?: "menu";
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "menuitemcheckbox" ? Boolean(checked) : undefined}
      tabIndex={-1}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors duration-150",
        "min-h-11 text-[15px] fine:min-h-8 fine:rounded-[9px] fine:px-2.5 fine:text-[13.5px]",
        "text-text active:bg-fg/[0.12] focus-visible:bg-fg/[0.1] fine:hover:bg-brand fine:hover:text-white fine:focus-visible:bg-brand fine:focus-visible:text-white",
        "group/item",
      )}
      {...rest}
    >
      <span className="grid w-5 shrink-0 place-items-center text-muted group-hover/item:text-current group-focus-visible/item:text-current">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked && <Check size={15} className="shrink-0 text-brand-soft group-hover/item:text-current" aria-hidden />}
      {trailing}
    </button>
  );
}
