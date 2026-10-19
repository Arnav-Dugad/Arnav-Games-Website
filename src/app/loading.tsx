import { Container } from "@/components/ui/SectionHeading";
import { GameGridSkeleton, Skeleton } from "@/components/ui/Skeleton";

/** Streams while a route's data resolves, so navigation never shows a blank frame. */
export default function Loading() {
  return (
    <Container className="pt-28 lg:pt-36">
      <Skeleton className="h-4 w-32 rounded-full" />
      <Skeleton className="mt-4 h-12 w-3/4 max-w-xl rounded-xl" />
      <Skeleton className="mt-4 h-4 w-full max-w-lg rounded" />

      <div className="mt-12">
        <GameGridSkeleton count={12} />
      </div>
    </Container>
  );
}
