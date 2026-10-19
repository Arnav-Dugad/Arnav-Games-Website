"use client";

/**
 * Combined sign-in / sign-up form.
 *
 * One component covers both modes because they share almost everything —
 * validation, Google sign-in, error surfacing and the post-auth redirect. The
 * `next` search param is honoured so users return to whatever they were doing
 * when they hit the auth wall.
 */

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircle, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { track } from "@/lib/analytics/client";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

type Mode = "login" | "signup";

/** Only checks shape — the server is the real authority on deliverability. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function AuthForm({ mode }: { mode: Mode }) {
  const { user, loading, enabled, signIn, signUp, signInWithGoogle, resetPassword } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();

  const next = params.get("next") || "/";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Someone already signed in has no business on this page.
  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  const validate = (): string | null => {
    if (mode === "signup" && name.trim().length < 2) return "Enter your name.";
    if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
    if (password.length < 6) return "Passwords need to be at least 6 characters.";
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        await signUp(name, email, password);
        track("signup");
        toast("Welcome to Arnav Games", "success");
      } else {
        await signIn(email, password);
        toast("Signed in", "success");
      }
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      // Google sign-in creates the account on first use. A brand-new account
      // has its creation and last sign-in stamped together.
      const meta = getFirebaseAuth()?.currentUser?.metadata;
      if (meta?.creationTime && meta.lastSignInTime
        && Math.abs(Date.parse(meta.lastSignInTime) - Date.parse(meta.creationTime)) < 10_000) {
        track("signup");
      }
      toast("Signed in", "success");
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter your email address first, then tap reset.");
      return;
    }
    try {
      await resetPassword(email);
      toast("Password reset email sent", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the reset email.");
    }
  };

  return (
    <div className="w-full max-w-md">
      <h1 className="font-display text-3xl font-black tracking-[-0.03em] sm:text-4xl">
        {mode === "login" ? "Welcome back" : "Create your account"}
      </h1>
      <p className="mt-2.5 text-[15px] text-muted">
        {mode === "login"
          ? "Sign in to reach your watchlist and reviews."
          : "Track releases, build a watchlist and rate what you play."}
      </p>

      {!enabled && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-gold/25 bg-gold/[0.06] px-4 py-3 text-[13px] leading-relaxed text-muted">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-gold" />
          <p>
            <span className="font-semibold text-gold">Firebase isn&rsquo;t configured.</span> Add
            your Firebase web-app keys to <code className="rounded bg-white/8 px-1 font-mono text-[11px]">.env.local</code>{" "}
            to enable accounts. Everything else on the site works without it.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
        {mode === "signup" && (
          <Field
            id="name"
            label="Name"
            icon={<User size={15} />}
            value={name}
            onChange={setName}
            autoComplete="name"
            placeholder="Alex Rivera"
          />
        )}

        <Field
          id="email"
          label="Email"
          type="email"
          icon={<Mail size={15} />}
          value={email}
          onChange={setEmail}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
        />

        <Field
          id="password"
          label="Password"
          type={showPassword ? "text" : "password"}
          icon={<Lock size={15} />}
          value={password}
          onChange={setPassword}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="grid h-9 w-9 place-items-center rounded-lg text-faint transition-colors hover:text-text"
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          }
        />

        <AnimatePresence>
          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-2 overflow-hidden text-[13px] text-flare"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <Button type="submit" size="lg" fullWidth loading={busy} disabled={!enabled}>
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>

        {mode === "login" && (
          <button
            type="button"
            onClick={handleReset}
            className="w-full text-center text-[13px] text-muted transition-colors hover:text-text"
          >
            Forgot your password?
          </button>
        )}
      </form>

      <div className="my-6 flex items-center gap-4">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] uppercase tracking-[0.07em] text-faint">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={busy || !enabled}
        className={cn(
          "flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-line-strong bg-white/[0.04] text-sm font-semibold transition-colors",
          "hover:bg-white/[0.08] disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <GoogleMark />
        Continue with Google
      </button>

      <p className="mt-7 text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link
              href={`/signup?next=${encodeURIComponent(next)}`}
              className="font-semibold text-brand-soft underline-offset-2 hover:underline"
            >
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="font-semibold text-brand-soft underline-offset-2 hover:underline"
            >
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function Field({
  id,
  label,
  icon,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  inputMode,
  trailing,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  inputMode?: "email" | "text";
  trailing?: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-muted">
        {label}
      </label>
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-3.5 text-faint">{icon}</span>
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          inputMode={inputMode}
          placeholder={placeholder}
          className={cn(
            // 16px minimum stops iOS Safari zooming the viewport on focus.
            "min-h-12 w-full rounded-xl border border-line bg-white/[0.03] pl-10 text-base outline-none transition-colors",
            "placeholder:text-faint focus:border-brand focus:bg-white/[0.05]",
            trailing ? "pr-12" : "pr-4",
          )}
        />
        {trailing && <span className="absolute right-1.5">{trailing}</span>}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}
