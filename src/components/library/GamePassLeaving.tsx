import { getGamePassLeavingSoon } from "@/lib/games/source";
import { GamePassLeavingNotice } from "./GamePassLeavingNotice";

/**
 * Server half of the leaving-soon warning: fetches the (cached) public shelf
 * and hands the minimal card data to the client, which intersects it with the
 * reader's own games. Meant to sit inside a <Suspense> so a cold catalogue
 * lookup never holds up the page.
 */
export async function GamePassLeaving() {
  const { data } = await getGamePassLeavingSoon().catch(() => ({ data: [] }));
  if (data.length === 0) return null;

  return (
    <GamePassLeavingNotice
      leaving={data.map(({ id, slug, name, image, imageFallback }) => ({ id, slug, name, image, imageFallback }))}
    />
  );
}
