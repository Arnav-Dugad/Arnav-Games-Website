import { Eye, Gamepad2, Languages, MessageSquareQuote, Sparkles } from "lucide-react";
import { ExpandableText } from "@/components/ui/ExpandableText";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils/cn";
import type { GameDetail } from "@/lib/games/types";

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
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--game-accent)]">Editorial overview</p>
        <h2 className="text-3xl font-black sm:text-4xl">Inside {game.name}</h2>
      </Reveal>

      <div className={cn("mt-6 grid gap-4", game.storyline && "lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]")}>
        <Reveal className="rounded-3xl border border-line bg-panel/35 p-5 sm:p-7">
          <p className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-faint"><Sparkles size={13} className="text-[var(--game-accent)]" /> What it is</p>
          <ExpandableText text={game.description} paragraphClassName="text-[15px] leading-[1.85] text-muted sm:text-base" />
        </Reveal>

        {game.storyline && (
          <Reveal delay={0.08} className="relative isolate overflow-hidden rounded-3xl border border-[color-mix(in_oklab,var(--game-accent)_28%,transparent)] bg-[radial-gradient(circle_at_0%_0%,var(--game-glow),transparent_55%),linear-gradient(145deg,color-mix(in_oklab,var(--color-panel)_90%,transparent),var(--color-bg-elev))] p-5 sm:p-7">
            <MessageSquareQuote size={56} aria-hidden className="absolute -right-1 top-1 -z-10 text-fg/[0.05]" />
            <p className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--game-accent)]"><MessageSquareQuote size={13} /> The premise</p>
            <ExpandableText text={game.storyline} collapsedRem={14} paragraphClassName="text-sm leading-[1.8] text-muted" />
          </Reveal>
        )}
      </div>

      {insights.length > 0 && (
        <Stagger className="mt-4 grid gap-3 sm:grid-cols-2" gap={0.04} onMount>
          {insights.map((insight) => (
            <StaggerItem key={insight.label}>
              <div className="flex h-full gap-3 rounded-2xl border border-line bg-fg/[0.025] p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fg/[0.05] text-faint">{insight.icon}</span>
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-faint">{insight.label}</p><p className="mt-1 text-sm leading-relaxed text-muted">{insight.value}</p></div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </section>
  );
}
