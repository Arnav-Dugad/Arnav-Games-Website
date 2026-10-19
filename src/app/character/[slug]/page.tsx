import type { Metadata } from "next";
import { EntityPage } from "@/components/game/EntityPage";
import { igdbCharacter } from "@/lib/games/providers/igdb";

export const revalidate = 86400;

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const character = await igdbCharacter(slug);
  if (!character) return { title: "Character not found" };

  return {
    title: character.name,
    description:
      character.description?.slice(0, 160) ??
      `${character.name} — the games they appear in.`,
  };
}

export default async function CharacterPage({ params }: { params: Params }) {
  const { slug } = await params;
  return <EntityPage entity={await igdbCharacter(slug)} kind="character" />;
}
