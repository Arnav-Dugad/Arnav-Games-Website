import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarRange, Gamepad2, LibraryBig } from "lucide-react";
import { GameCover } from "@/components/game/GameCover";
import { EntityGameExplorer } from "@/components/game/EntityGameExplorer";
import { Container } from "@/components/ui/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import { ExpandableText } from "@/components/ui/ExpandableText";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils/cn";
import { isIgdbImage } from "@/lib/games/image";
import type { IgdbEntity } from "@/lib/games/providers/igdb";

export function EntityPage({
  entity,
  kind,
  eyebrow,
}: {
  entity: IgdbEntity | null;
  kind: "company" | "character" | "franchise";
  eyebrow: string;
}) {
  if (!entity) notFound();

  const hasMark = Boolean(entity.image);
  const datedGames = entity.games
    .filter((game) => game.released)
    .sort((a, b) => a.released!.localeCompare(b.released!));
  const firstYear = datedGames.at(0)?.released?.slice(0, 4) ?? null;
  const latestYear = datedGames.at(-1)?.released?.slice(0, 4) ?? null;
  const directoryHref = kind === "company" ? "/studios" : kind === "franchise" ? "/franchises" : "/browse";
  const directoryLabel = kind === "company" ? "All studios" : kind === "franchise" ? "All franchises" : "Browse games";
  const collectionPage = kind === "franchise";

  return (
    <>
      <header className="noise relative isolate overflow-hidden border-b border-line">
        {collectionPage && entity.image && (
          <div className="absolute inset-0 -z-20">
            <Image src={entity.image} alt="" fill priority sizes="100vw" unoptimized={isIgdbImage(entity.image)} className="scale-110 object-cover opacity-35 blur-[2px]" />
          </div>
        )}
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_80%_at_75%_20%,rgba(124,92,255,0.2),transparent_65%)]" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-bg via-bg/88 to-bg/55" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-bg via-bg/80 to-transparent" />

        <Container className="pb-10 pt-24 lg:pb-16 lg:pt-32">
          <Reveal>
            <Link
              href={directoryHref}
              className="mb-8 inline-flex items-center gap-2 rounded-full border border-line bg-black/20 px-3.5 py-2 text-xs font-medium text-muted backdrop-blur-md transition-colors hover:border-line-strong hover:text-text"
            >
              <ArrowLeft size={14} />
              {directoryLabel}
            </Link>
          </Reveal>

          <div className={cn("grid items-end gap-8", collectionPage && "lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14")}>
            <div className="flex min-w-0 flex-col gap-7 sm:flex-row sm:items-end sm:gap-8">
              {hasMark && !collectionPage && (
                <Reveal
                  direction="right"
                  className={cn(
                    "relative shrink-0 overflow-hidden rounded-3xl border border-line-strong shadow-[0_35px_90px_-34px_rgba(0,0,0,0.95)]",
                    kind === "company"
                      ? "grid h-32 w-32 place-items-center bg-white/[0.96] p-4 sm:h-40 sm:w-40"
                      : "aspect-[3/4] w-32 sm:w-44",
                  )}
                >
                  {/*
                    `fill` for both kinds. A company logo previously rendered at
                    its intrinsic 180px inside a 128/160px `overflow-hidden` box,
                    so every studio mark was cropped; `fill` + `object-contain`
                    scales it to the box instead.
                  */}
                  <Image
                    src={entity.image!}
                    alt={entity.name}
                    fill
                    sizes="176px"
                    unoptimized={isIgdbImage(entity.image)}
                    className={kind === "company" ? "object-contain p-1" : "object-cover"}
                  />
                </Reveal>
              )}

              <div className="min-w-0 flex-1">
                <Reveal>
                  <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-brand-soft">
                    <span aria-hidden className="h-px w-6 bg-gradient-to-r from-brand to-transparent" />
                    {eyebrow}
                  </p>
                  <h1 className="max-w-4xl font-display text-[clamp(2.4rem,7vw,5.5rem)] font-black leading-[0.96] tracking-[-0.055em] text-white">
                    {entity.name}
                  </h1>
                </Reveal>

                <Reveal delay={0.1} className="mt-5 flex flex-wrap items-center gap-2">
                  {entity.detail && <Badge tone="neutral">{entity.detail}</Badge>}
                  <Badge tone="brand">
                    {entity.games.length} {entity.games.length === 1 ? "game" : "games"}
                  </Badge>
                  {firstYear && latestYear && (
                    <Badge>{firstYear === latestYear ? firstYear : `${firstYear}—${latestYear}`}</Badge>
                  )}
                </Reveal>
              </div>
            </div>

            {collectionPage && <FranchisePosterStack games={entity.games} />}
          </div>

          {entity.description && (
            <Reveal delay={0.14} className="mt-8 max-w-3xl">
              <ExpandableText
                text={entity.description}
                paragraphClassName="text-[15px] leading-[1.8] text-muted"
              />
            </Reveal>
          )}

          <Reveal delay={0.18} className="mt-9 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
            <EntityStat icon={<LibraryBig size={17} />} value={String(entity.games.length)} label="Catalogue entries" />
            <EntityStat icon={<CalendarRange size={17} />} value={firstYear ?? "—"} label="First release" />
            <EntityStat icon={<Gamepad2 size={17} />} value={latestYear ?? "—"} label="Latest release" className="col-span-2 sm:col-span-1" />
          </Reveal>
        </Container>
      </header>

      <Container className="py-10 lg:py-16">
        <div className="mb-7">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-brand-soft">
            {collectionPage ? "Complete collection" : kind === "company" ? "Studio catalogue" : "Gameography"}
          </p>
          <h2 className="text-2xl font-bold sm:text-3xl">
            {kind === "character" ? "Appears in" : collectionPage ? `Explore ${entity.name}` : "Games"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Search the collection or arrange it by release date to find exactly what you want.
          </p>
        </div>

        {entity.games.length > 0 ? (
          <EntityGameExplorer games={entity.games} kind={kind} />
        ) : (
          <p className="rounded-2xl border border-dashed border-line py-16 text-center text-sm text-muted">
            IGDB has no games linked to this entry yet.
          </p>
        )}
      </Container>
    </>
  );
}

function EntityStat({
  icon,
  value,
  label,
  className,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("glass rounded-2xl p-4", className)}>
      <span className="mb-3 grid h-8 w-8 place-items-center rounded-xl bg-brand/12 text-brand-soft">{icon}</span>
      <p className="font-display text-lg font-bold text-text">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-[0.06em] text-faint">{label}</p>
    </div>
  );
}

function FranchisePosterStack({ games }: { games: IgdbEntity["games"] }) {
  const posters = games.filter((game) => game.image).slice(0, 3);
  if (posters.length === 0) return null;

  return (
    <Reveal direction="left" delay={0.08} className="relative hidden h-72 lg:block">
      {posters.map((game, index) => (
        <div
          key={game.id}
          className="absolute bottom-0 aspect-[3/4] w-40"
          style={{
            left: `${index * 92}px`,
            zIndex: index + 1,
            transform: `rotate(${(index - 1) * 4}deg) translateY(${Math.abs(index - 1) * 12}px)`,
          }}
        >
          <Link
            href={`/game/${game.slug}`}
            aria-label={game.name}
            className="relative block h-full w-full overflow-hidden rounded-2xl border border-white/20 bg-panel shadow-[0_35px_70px_-25px_rgba(0,0,0,0.95)] transition-transform duration-500 hover:-translate-y-2 hover:scale-[1.02]"
          >
            <GameCover
              name={game.name}
              slug={game.slug}
              image={game.image}
              imageFallback={game.imageFallback}
              width={420}
              sizes="160px"
            />
            <span className="absolute inset-0 ring-1 ring-inset ring-white/10" />
          </Link>
        </div>
      ))}
    </Reveal>
  );
}
