import type { Metadata } from "next";
import { EntityPage } from "@/components/game/EntityPage";
import { igdbCompany } from "@/lib/games/providers/igdb";

/** Studio records change rarely; a day is plenty. */
export const revalidate = 86400;

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const company = await igdbCompany(slug);
  if (!company) return { title: "Studio not found" };

  return {
    title: company.name,
    description:
      company.description?.slice(0, 160) ??
      `Games developed and published by ${company.name}.`,
  };
}

export default async function StudioPage({ params }: { params: Params }) {
  const { slug } = await params;
  return <EntityPage entity={await igdbCompany(slug)} kind="company" />;
}
