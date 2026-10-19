"use client";

/**
 * The game page's own loading state.
 *
 * It exists for the shared-element cover morph. The route streams, so on a
 * first click the page itself isn't ready when the view transition snapshots
 * — without this file the root loading skeleton would show instead and the
 * card's cover would have nothing to morph into. Here the poster is already in
 * place (the claimed card hands over the URL it was showing), named as the
 * transition target, so the cover flies to its spot immediately and the rest
 * of the page resolves around it.
 *
 * The layout mirrors `GameHero` closely enough that the real page lands
 * without a jump: same dark stage, same poster sizes and position.
 */

import { useParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { CoverTransition } from "@/components/interactions/CoverTransition";
import { getCoverClaim, subscribeCoverClaim } from "@/components/interactions/view-transition";
import { DARK_STAGE_STYLE } from "@/components/game/detail/theme";
import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";

export default function GameLoading() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const claim = useSyncExternalStore(subscribeCoverClaim, getCoverClaim, () => null);
  const image = claim?.slug === slug ? claim.image : null;

  return (
    <div aria-busy="true" aria-label="Loading game">
      <header data-stage="dark" style={DARK_STAGE_STYLE} className="relative isolate overflow-hidden bg-bg text-text">
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- the card's already-loaded poster, blurred into a backdrop; next/image would re-request it.
          <img src={image} alt="" aria-hidden className="absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-30 blur-3xl" />
        )}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-bg via-bg/80 to-bg/40" />
        <Container className="flex min-h-[680px] flex-col justify-end pb-9 pt-24 sm:min-h-[740px] lg:min-h-[800px] lg:pb-14 lg:pt-32">
          <Skeleton className="mb-7 h-9 w-24 rounded-full" />
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-9 lg:gap-12">
            <div className="relative w-36 shrink-0 sm:w-48 lg:w-64">
              <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/20 bg-panel shadow-[0_35px_90px_-30px_rgba(0,0,0,0.95)]">
                {slug && (
                  <CoverTransition slug={slug} role="target">
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- must be the exact bitmap the card showed for the morph to read as one object.
                      <img src={image} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="skeleton-glass block h-full w-full" />
                    )}
                  </CoverTransition>
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex gap-2">
                <Skeleton className="h-9 w-28 rounded-full" />
                <Skeleton className="h-9 w-24 rounded-full" />
              </div>
              <Skeleton className="h-16 w-4/5 max-w-lg rounded-2xl sm:h-24" />
              <Skeleton className="h-4 w-56 rounded-full" />
              <Skeleton className="h-4 w-72 max-w-full rounded-full" />
            </div>
          </div>
          <div className="mt-7 grid grid-cols-2 gap-2.5 sm:flex sm:gap-3">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-full sm:w-36" />
            ))}
          </div>
        </Container>
      </header>
      <Container className="grid grid-cols-2 gap-3 pt-8 sm:gap-4 lg:grid-cols-4">
        <Skeleton className="col-span-2 h-[148px] rounded-3xl" />
        <Skeleton className="h-[148px] rounded-3xl" />
        <Skeleton className="h-[148px] rounded-3xl" />
        <Skeleton className="col-span-2 h-[148px] rounded-3xl" />
        <Skeleton className="h-[148px] rounded-3xl" />
        <Skeleton className="h-[148px] rounded-3xl" />
      </Container>
    </div>
  );
}
