import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";

/** Matches `RecRail`'s geometry, so nothing jumps when picks arrive. Kept apart so loaders don't pull the cards in. */
export function RecRailSkeleton({ variant = "poster", className }: { variant?: "poster" | "feature"; className?: string }) {
  return (
    <div aria-hidden className={className}>
      <Container>
        <Skeleton className="h-7 w-44 rounded-lg" />
      </Container>
      <div className="rail-gutter mt-6 flex gap-3 overflow-hidden sm:mt-7 sm:gap-4">
        {Array.from({ length: variant === "feature" ? 3 : 7 }, (_, index) =>
          variant === "feature" ? (
            <Skeleton key={index} className="h-[172px] w-[86vw] max-w-[400px] shrink-0 rounded-[22px] sm:w-[380px]" />
          ) : (
            <div key={index} className="w-[40vw] max-w-[184px] shrink-0 sm:w-[176px]">
              <Skeleton className="aspect-[3/4] w-full rounded-2xl" />
              <Skeleton className="mt-2.5 h-3.5 w-3/4 rounded-full" />
              <Skeleton className="mt-1.5 h-3 w-1/2 rounded-full" />
            </div>
          ),
        )}
      </div>
    </div>
  );
}
