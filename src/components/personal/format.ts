/** Shared formatting for the reader's own play records. Pure. */

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const SHORT_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "62 h", "1.5 h", "45 min". */
export function formatHours(hours: number): string {
  if (hours > 0 && hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} h`;
}

/** "Today", "Yesterday", "Oct 19", or "Oct 19, 2025" for another year — in the reader's own zone. */
export function journalDate(at: number, now = Date.now()): string {
  const day = (time: number) => {
    const date = new Date(time);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  };
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(at).getFullYear() === new Date(now).getFullYear() ? SHORT.format(at) : SHORT_YEAR.format(at);
}
