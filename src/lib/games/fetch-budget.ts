/**
 * A ceiling on outbound requests for one invocation.
 *
 * Workers Free allows 50 subrequests per invocation (D1/R2 binding calls
 * don't count). The crons plan their work to fit, and every fetch site also
 * asks the budget first, so a planning mistake degrades to "less work done"
 * rather than to a run Cloudflare kills halfway through its writes.
 *
 * Counted conservatively: a fetch that turns out to be a data-cache hit is
 * still charged.
 */
export class FetchBudget {
  used = 0;

  constructor(readonly limit: number) {}

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  /** Reserves `n` requests; false (and nothing reserved) when they don't fit. */
  take(n = 1): boolean {
    if (this.used + n > this.limit) return false;
    this.used += n;
    return true;
  }
}
