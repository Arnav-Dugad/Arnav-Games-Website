/**
 * Server-side stand-ins for the Firebase web SDK.
 *
 * Firebase never initialises on the server (see ../config.ts), but client
 * components are still compiled for SSR, which used to pull ~560 KB of SDK
 * into the Cloudflare Worker bundle — a fifth of its size limit — for code
 * that can never run there. next.config.ts aliases the `firebase/*` imports
 * to these stubs for the server build only; browsers get the real SDK.
 *
 * Every export throws if actually called, so a server-side call would fail
 * loudly instead of silently doing nothing.
 */
export function browserOnly(name: string): never {
  throw new Error(`firebase: ${name}() is browser-only and was called during server rendering.`);
}
