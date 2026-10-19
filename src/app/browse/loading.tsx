import { Container } from "@/components/ui/SectionHeading";
import { GameGridSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * Shown while a browse query resolves on arrival from another route.
 * (Filter changes within /browse keep the page and dim the grid instead.)
 *
 * Mirrors the real layout — title, search well, suggestion rail, toolbar,
 * grid — so nothing jumps when the content lands.
 */
export default function BrowseLoading() {
  return (
    <Container className="pt-24 lg:pt-32">
      <Skeleton className="h-10 w-40 rounded-xl sm:h-12" />
      <Skeleton className="mt-6 h-12 w-full rounded-full sm:mt-8 lg:mt-10" />
      <div className="mt-3 flex gap-2 overflow-hidden">
        {["w-28", "w-24", "w-32", "w-[104px]", "w-[116px]"].map((width) => (
          <Skeleton key={width} className={`h-11 shrink-0 rounded-full sm:h-9 ${width}`} />
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between gap-4">
        <Skeleton className="h-5 w-28 rounded" />
        <Skeleton className="h-11 w-40 rounded-full" />
      </div>
      <div className="mt-3 flex gap-2 overflow-hidden">
        {["w-[92px]", "w-[84px]", "w-[100px]", "w-28"].map((width) => (
          <Skeleton key={width} className={`h-11 shrink-0 rounded-full sm:h-9 ${width}`} />
        ))}
      </div>
      <div className="mt-6 sm:mt-8">
        <GameGridSkeleton count={12} />
      </div>
    </Container>
  );
}
