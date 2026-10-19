import { Container } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";

/** Mirrors the calendar: title, the this-week rail, controls, then a day group. */
export default function UpcomingLoading() {
  return (
    <>
      <Container className="pt-24 lg:pt-36">
        <Skeleton className="h-4 w-24 rounded-full" />
        <Skeleton className="mt-4 h-11 w-80 max-w-full rounded-xl" />
        <Skeleton className="mt-4 h-5 w-[32rem] max-w-full rounded-lg" />
        <Skeleton className="mt-12 h-7 w-36 rounded-lg" />
      </Container>
      <div className="rail-gutter mt-4 flex gap-3 overflow-hidden">
        <Skeleton className="h-[176px] w-[min(82vw,520px)] shrink-0 rounded-[22px] sm:h-[219px]" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[176px] w-[132px] shrink-0 rounded-[18px] sm:h-[219px] sm:w-[164px]" />
        ))}
      </div>
      <Container className="pt-10">
        <Skeleton className="h-11 w-56 rounded-full" />
        <Skeleton className="mt-5 h-9 w-full max-w-md rounded-full" />
        <Skeleton className="mt-12 h-8 w-48 rounded-lg" />
        <Skeleton className="mt-6 h-11 w-64 rounded-xl" />
        <Skeleton className="mt-3 h-[300px] w-full rounded-2xl" />
      </Container>
    </>
  );
}
