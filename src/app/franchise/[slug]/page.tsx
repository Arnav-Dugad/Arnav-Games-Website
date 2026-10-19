import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EntityPage } from "@/components/game/EntityPage";
import { igdbFranchise } from "@/lib/games/providers/igdb";

export const revalidate = 86400;

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const franchise = await igdbFranchise(slug);
  if (!franchise) notFound();
  return {
    title: `${franchise.name} franchise`,
    description: `Explore every IGDB game connected to the ${franchise.name} franchise.`,
  };
}

export default async function FranchisePage({ params }: { params: Params }) {
  const { slug } = await params;
  return <EntityPage entity={await igdbFranchise(slug)} kind="franchise" />;
}
