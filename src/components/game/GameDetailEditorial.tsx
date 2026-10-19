import {
  CalendarDays,
  Eye,
  Gamepad2,
  Languages,
  Layers3,
  MessageSquareQuote,
  Monitor,
  Sparkles,
  Star,
} from "lucide-react";
import { ExpandableText } from "@/components/ui/ExpandableText";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { releaseLabelLong } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { GameDetail } from "@/lib/games/types";

export function GamePulseStrip({ game }: { game: GameDetail }) {
  const connected =
    game.dlcs.length +
    game.expansions.length +
    game.standaloneExpansions.length +
    game.editions.length +
    game.bundles.length +
    game.remakes.length +
    game.remasters.length +
    game.ports.length;
  const score = game.metacritic ?? (game.rating > 0 ? Math.round(game.rating * 20) : null);

  return (
    <div className="relative z-20 -mt-1 sm:-mt-5 lg:-mt-8">
      <Stagger className="glass grid overflow-hidden rounded-3xl sm:grid-cols-2 lg:grid-cols-4" gap={0.04} onMount>
        <PulseStat icon={<CalendarDays size={17} />} label="Release" value={releaseLabelLong(game, "To be announced")} />
        <PulseStat icon={score !== null ? <Star size={17} /> : <Sparkles size={17} />} label={game.metacritic !== null ? "Critic score" : "Player score"} value={score !== null ? `${score}/100` : "Awaiting reviews"} tone="gold" />
        <PulseStat icon={<Monitor size={17} />} label="Platform families" value={game.parentPlatforms.length > 0 ? String(game.parentPlatforms.length) : "Not announced"} tone="neon" />
        <PulseStat icon={<Layers3 size={17} />} label="Connected releases" value={connected > 0 ? String(connected) : "Core game only"} tone="mint" />
      </Stagger>
    </div>
  );
}

function PulseStat({ icon, label, value, tone = "brand" }: { icon: React.ReactNode; label: string; value: string; tone?: "brand" | "gold" | "neon" | "mint" }) {
  return (
    <StaggerItem className="border-b border-line p-4 last:border-b-0 sm:border-r sm:[&:nth-child(2)]:border-r-0 lg:border-b-0 lg:[&:nth-child(2)]:border-r lg:last:border-r-0 sm:p-5">
      <div className="flex items-center gap-3">
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", tone === "gold" ? "bg-gold/10 text-gold" : tone === "neon" ? "bg-neon/10 text-neon" : tone === "mint" ? "bg-mint/10 text-mint" : "bg-brand/10 text-brand-soft")}>{icon}</span>
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-faint">{label}</p><p className="mt-0.5 truncate text-sm font-semibold text-text">{value}</p></div>
      </div>
    </StaggerItem>
  );
}

export function GameEditorialOverview({ game }: { game: GameDetail }) {
  const insights = [
    game.gameModes.length > 0
      ? { icon: <Gamepad2 size={17} />, label: "Play styles", value: game.gameModes.slice(0, 3).map((mode) => mode.name).join(" · ") }
      : null,
    game.playerPerspectives.length > 0
      ? { icon: <Eye size={17} />, label: "Perspective", value: game.playerPerspectives.slice(0, 3).map((item) => item.name).join(" · ") }
      : null,
    game.themes.length > 0
      ? { icon: <Sparkles size={17} />, label: "Themes", value: game.themes.slice(0, 3).map((theme) => theme.name).join(" · ") }
      : null,
    game.languages.length > 0
      ? { icon: <Languages size={17} />, label: "Languages", value: `${game.languages.length} supported` }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <section id="overview" className="scroll-mt-32">
      <Reveal>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-brand-soft">Editorial overview</p>
        <h2 className="text-3xl font-black sm:text-4xl">Inside {game.name}</h2>
      </Reveal>

      <div className={cn("mt-6 grid gap-4", game.storyline && "lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]")}>
        <Reveal className="rounded-3xl border border-line bg-panel/35 p-5 sm:p-7">
          <p className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-faint"><Sparkles size={13} className="text-brand-soft" /> What it is</p>
          <ExpandableText text={game.description} paragraphClassName="text-[15px] leading-[1.85] text-muted sm:text-base" />
        </Reveal>

        {game.storyline && (
          <Reveal delay={0.08} className="relative isolate overflow-hidden rounded-3xl border border-brand/25 bg-[radial-gradient(circle_at_0%_0%,rgba(124,92,255,0.20),transparent_48%),linear-gradient(145deg,rgba(16,16,32,0.9),rgba(7,7,15,0.95))] p-5 sm:p-7">
            <MessageSquareQuote size={56} aria-hidden className="absolute -right-1 top-1 -z-10 text-white/[0.035]" />
            <p className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-brand-soft"><MessageSquareQuote size={13} /> The premise</p>
            <ExpandableText text={game.storyline} collapsedRem={14} paragraphClassName="text-sm leading-[1.8] text-muted" />
          </Reveal>
        )}
      </div>

      {insights.length > 0 && (
        <Stagger className="mt-4 grid gap-3 sm:grid-cols-2" gap={0.04} onMount>
          {insights.map((insight) => (
            <StaggerItem key={insight.label}>
              <div className="flex h-full gap-3 rounded-2xl border border-line bg-white/[0.025] p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-faint">{insight.icon}</span>
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-faint">{insight.label}</p><p className="mt-1 text-sm leading-relaxed text-muted">{insight.value}</p></div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </section>
  );
}
