import { Container } from "@/components/ui/SectionHeading";
import { GameGridSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * Streams while a route's data resolves, so navigation never shows a blank
 * frame. Sized to the shared PageHeader (same top offset and title scale,
 * no eyebrow), so the real title lands where the placeholder was.
 */
export default function Loading() {
  return (
    <Container className="pt-24 lg:pt-32">
      <Skeleton className="h-10 w-56 max-w-full rounded-xl sm:h-12 sm:w-72" />
      <div className="mt-8 lg:mt-12">
        <GameGridSkeleton count={12} />
      </div>
    </Container>
  );
}
