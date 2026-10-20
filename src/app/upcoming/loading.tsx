import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Mirrors the calendar: title, filters, then the month header with the week
 * strip (phones) or month grid beside the day panel (desktop).
 */
export default function UpcomingLoading() {
  return (
    <Container className="pt-[calc(var(--chrome-top)+2rem)] lg:pt-32">
      <Skeleton className="h-11 w-72 max-w-full rounded-xl" />
      <Skeleton className="mt-10 h-10 w-64 max-w-full rounded-full" />
      <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:gap-8 xl:gap-10">
        <div>
          <div className="mb-5 flex items-center justify-between">
            <Skeleton className="h-8 w-44 rounded-lg" />
            <Skeleton className="h-11 w-24 rounded-full" />
          </div>
          <div className="grid grid-cols-7 gap-1 sm:hidden">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-[92px] rounded-2xl" />
            ))}
          </div>
          <div className="hidden grid-cols-7 gap-1.5 sm:grid">
            {Array.from({ length: 35 }, (_, i) => (
              <Skeleton key={i} className="h-[112px] rounded-2xl lg:h-[120px]" />
            ))}
          </div>
        </div>
        <div className="mt-6 lg:mt-0">
          <Skeleton className="h-6 w-48 rounded-lg" />
          <Skeleton className="mt-3 h-[200px] w-full rounded-2xl" />
          <Skeleton className="mt-2 h-[170px] w-full rounded-2xl" />
        </div>
      </div>
    </Container>
  );
}
