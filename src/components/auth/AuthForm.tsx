"use client";

/**
 * Combined sign-in / sign-up form.
 *
 * One component covers both modes because they share almost everything —
 * validation, Google sign-in, error surfacing and the post-auth redirect. The
 * `next` search param is honoured so users return to whatever they were doing
 * when they hit the auth wall.
 *
 * Shaped after Apple ID's sign-in: Google first (one tap for most people),
 * then the fields as one inset group with labels that float inside each
 * field, and errors that name the field they belong to. Validation runs on
 * submit, not per keystroke — nobody needs to be told their email is invalid
 * while they're still typing it.
 */

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/firebase/AuthProvider";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { track } from "@/lib/analytics/client";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

type Mode = "login" | "signup";
type FieldName = "name" | "email" | "password";

/** Only checks shape — the server is the real authority on deliverability. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 6;

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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Someone already signed in has no business on this page.
  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  const validate = (): Partial<Record<FieldName, string>> => {
    const problems: Partial<Record<FieldName, string>> = {};
    if (mode === "signup" && name.trim().length < 2) problems.name = "Enter your name.";
    if (!EMAIL_RE.test(email.trim())) problems.email = "Enter a valid email address.";
    // Signing in, the length rule is the server's business — an existing
    // password is simply right or wrong. Only an empty field is ours to flag.
    if (mode === "login" ? password.length === 0 : password.length < MIN_PASSWORD) {
      problems.password = mode === "login" ? "Enter your password." : `Use at least ${MIN_PASSWORD} characters.`;
    }
    return problems;
  };

  // Editing a field clears its own complaint; the others stay until resubmit.
  const edit = (field: FieldName, setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problems = validate();
    setFieldErrors(problems);
    const firstBad = (["name", "email", "password"] as const).find((field) => problems[field]);
    if (firstBad) {
      setError(null);
      document.getElementById(firstBad)?.focus();
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
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
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
      setError(err instanceof Error ? err.message : "Google sign-in didn't finish. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setFieldErrors({ email: "Enter your email, then tap “Forgot password?” again." });
      document.getElementById("email")?.focus();
      return;
    }
    try {
      await resetPassword(email);
      toast("Check your email for a reset link", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the reset email.");
    }
  };

  const fieldErrorList = (["name", "email", "password"] as const).filter((field) => fieldErrors[field]);

  return (
    <div className="w-full max-w-[400px]">
      <h1 className="text-center font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[40px]">
        {mode === "login" ? "Sign in" : "Create account"}
      </h1>

      {!enabled && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-gold/25 bg-gold/[0.06] px-4 py-3 text-[13px] leading-relaxed text-muted">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-gold" aria-hidden />
          <p>Accounts aren&rsquo;t set up on this site yet. Everything else works without one.</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleGoogle}
        disabled={busy || !enabled}
        className="press mt-8 flex min-h-[52px] w-full items-center justify-center gap-3 rounded-full border border-line-strong bg-panel text-[16px] font-semibold transition-colors fine:hover:bg-fg/[0.06] disabled:pointer-events-none disabled:opacity-50"
      >
        <GoogleMark />
        Continue with Google
      </button>

      <div className="my-6 flex items-center gap-4" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-[13px] text-faint">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {/* One inset group, iOS style; the field with a problem gets a red edge. */}
        <div className="overflow-hidden rounded-2xl border border-line bg-panel/70 light:bg-panel [&>*+*]:border-t [&>*+*]:border-line">
          {mode === "signup" && (
            <FloatingField
              id="name"
              label="Name"
              value={name}
              onChange={edit("name", setName)}
              autoComplete="name"
              error={fieldErrors.name}
            />
          )}
          <FloatingField
            id="email"
            label="Email"
            type="email"
            inputMode="email"
            value={email}
            onChange={edit("email", setEmail)}
            autoComplete={mode === "login" ? "username" : "email"}
            error={fieldErrors.email}
          />
          <FloatingField
            id="password"
            label="Password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={edit("password", setPassword)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            error={fieldErrors.password}
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="grid h-11 w-11 place-items-center rounded-full text-muted transition-colors hover:text-text"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            }
          />
        </div>

        {mode === "signup" && !fieldErrors.password && (
          <p className="mt-2 px-4 text-[13px] text-muted">At least {MIN_PASSWORD} characters.</p>
        )}

        <AnimatePresence initial={false}>
          {(fieldErrorList.length > 0 || error) && (
            <motion.ul
              key="errors"
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              className="overflow-hidden"
            >
              {fieldErrorList.map((field) => (
                <li key={field} id={`${field}-error`} className="mt-2 flex items-start gap-2 px-4 text-[13px] text-flare">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  {fieldErrors[field]}
                </li>
              ))}
              {error && (
                <li className="mt-2 flex items-start gap-2 px-4 text-[13px] text-flare">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  {error}
                </li>
              )}
            </motion.ul>
          )}
        </AnimatePresence>

        {mode === "login" && (
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={handleReset}
              className="min-h-11 px-4 text-[14px] font-medium text-brand-soft transition-colors hover:text-text"
            >
              Forgot password?
            </button>
          </div>
        )}

        <Button type="submit" size="lg" fullWidth loading={busy} disabled={!enabled} className={mode === "login" ? "mt-2" : "mt-6"}>
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="mt-8 text-center text-[15px] text-muted">
        {mode === "login" ? "New here? " : "Have an account? "}
        <Link
          href={`/${mode === "login" ? "signup" : "login"}?next=${encodeURIComponent(next)}`}
          className="font-semibold text-brand-soft underline-offset-2 hover:underline"
        >
          {mode === "login" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </div>
  );
}

function FloatingField({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
  error,
  trailing,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: "email" | "text";
  error?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className={cn("relative flex items-center", error && "bg-flare/[0.06] shadow-[inset_3px_0_0_var(--color-flare)]")}>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        // A blank placeholder lets CSS know when the field is empty, so the
        // label can sit inside it and float up once there's text.
        placeholder=" "
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        spellCheck={false}
        autoCapitalize={id === "name" ? "words" : "none"}
        className={cn(
          // 16px+ stops iOS Safari zooming the viewport on focus.
          "peer h-[58px] w-full bg-transparent px-4 pb-1.5 pt-5 text-[17px] text-text outline-none",
          trailing ? "pr-14" : null,
        )}
      />
      <label
        htmlFor={id}
        className={cn(
          "pointer-events-none absolute left-4 top-2 text-[12px] font-medium text-muted transition-all duration-200 ease-[var(--ease-apple)]",
          "peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-[17px] peer-placeholder-shown:font-normal",
          "peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-[12px] peer-focus:font-medium peer-focus:text-brand-soft",
          error && "text-flare peer-focus:text-flare",
        )}
      >
        {label}
      </label>
      {trailing && <span className="absolute right-1.5">{trailing}</span>}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden focusable="false">
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
