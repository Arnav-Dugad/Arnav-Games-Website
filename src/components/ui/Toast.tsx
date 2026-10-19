"use client";

/**
 * Toast notifications.
 *
 * Positioned bottom-centre above the floating mobile tab bar, and bottom-right on
 * desktop where there's nothing to collide with. Uses a layout animation so
 * stacked toasts slide rather than jump when one dismisses.
 */

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils/cn";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastTone, ReactNode> = {
  success: <Check size={16} className="text-mint" />,
  error: <AlertTriangle size={16} className="text-flare" />,
  info: <Info size={16} className="text-neon" />,
};

const ACCENT: Record<ToastTone, string> = {
  success: "bg-mint/15",
  error: "bg-flare/15",
  info: "bg-neon/15",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-2), { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 4200),
      );
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className={cn(
          "pointer-events-none fixed z-(--z-toast) flex flex-col items-center gap-2",
          // Clears the tab bar wherever it renders — touch tablets included,
          // where a corner toast used to sit on top of the bar's right end.
          "inset-x-4 bottom-(--float-bottom)",
          "sm:inset-x-auto sm:right-6 sm:items-end",
        )}
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="material pointer-events-auto relative flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-[22px] py-2.5 pl-2.5 pr-2"
            >
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", ACCENT[item.tone])}>
                {ICONS[item.tone]}
              </span>
              <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{item.message}</p>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-fg/8 hover:text-text coarse:h-11 coarse:w-11"
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>.");
  return ctx;
}
