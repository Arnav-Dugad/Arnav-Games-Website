import { ImageResponse } from "next/og";
import { getGame } from "@/lib/games/source";
import { sizedImage } from "@/lib/games/image";
import { initials, releaseLabel } from "@/lib/utils/format";

/**
 * Per-game social card.
 *
 * Rendered on demand and cached, so a shared link previews with the game's own
 * artwork, score and release date instead of a bare title.
 *
 * Two constraints shape the markup. Satori (which backs `ImageResponse`)
 * supports only a flexbox subset — no grid, no `gap` shorthand quirks, and
 * every element with more than one child needs an explicit `display: flex`.
 * And no custom font is loaded: fetching one at render time is an extra network
 * hop that can fail, and the built-in face is perfectly legible at this size.
 */

export const alt = "Game details on Arnav Games";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#04040a";
const BRAND = "#7c5cff";
const MUTED = "#9494ac";

function scoreColour(score: number | null): string {
  if (score === null) return MUTED;
  if (score >= 75) return "#4ade80";
  if (score >= 50) return "#ffc857";
  return "#ff3d8b";
}

/** Deterministic hue, matching the generated cover art used in the app. */
function hueFrom(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let name = "Game not found";
  let meta = "";
  let metacritic: number | null = null;
  let cover: string | null = null;
  let genres = "";

  try {
    const result = await getGame(slug);
    if (result) {
      const game = result.data;
      name = game.name;
      metacritic = game.metacritic;
      meta = releaseLabel(game, "Release date to be announced");
      genres = game.genres.slice(0, 3).map((genre) => genre.name).join("  ·  ");
      cover = sizedImage(game.image, 600);
    }
  } catch {
    // Fall through to the text-only card rather than failing the request —
    // a plain preview beats no preview.
  }

  const hue = hueFrom(slug);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: BG,
          color: "#f1f1f7",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Ambient colour wash, keyed to the same hue as the in-app art. */}
        <div
          style={{
            position: "absolute",
            top: -200,
            left: -160,
            width: 900,
            height: 900,
            borderRadius: 9999,
            background: `radial-gradient(circle, hsla(${hue}, 70%, 45%, 0.34), transparent 62%)`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -260,
            right: -120,
            width: 760,
            height: 760,
            borderRadius: 9999,
            background: `radial-gradient(circle, ${BRAND}44, transparent 64%)`,
            display: "flex",
          }}
        />

        {/* Copy column */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "72px 64px",
            width: 740,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                width: 40,
                height: 40,
                borderRadius: 10,
                background: `linear-gradient(135deg, ${BRAND}, #22d3ee)`,
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                fontWeight: 800,
                color: "#fff",
              }}
            >
              A
            </div>
            <div
              style={{
                marginLeft: 14,
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: -0.5,
                display: "flex",
              }}
            >
              Arnav Games
            </div>
          </div>

          <div
            style={{
              marginTop: 34,
              fontSize: name.length > 34 ? 60 : 76,
              fontWeight: 800,
              lineHeight: 1.03,
              letterSpacing: -2.6,
              display: "flex",
              // Satori has no line-clamp; the font-size step above keeps long
              // titles inside the frame instead.
              maxHeight: 250,
              overflow: "hidden",
            }}
          >
            {name}
          </div>

          <div
            style={{
              marginTop: 26,
              display: "flex",
              alignItems: "center",
              fontSize: 26,
              color: MUTED,
            }}
          >
            {meta}
            {metacritic !== null && (
              <div style={{ display: "flex", alignItems: "center", marginLeft: 22 }}>
                <div
                  style={{
                    display: "flex",
                    width: 8,
                    height: 8,
                    borderRadius: 9999,
                    background: MUTED,
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    marginLeft: 22,
                    padding: "6px 16px",
                    borderRadius: 10,
                    fontSize: 26,
                    fontWeight: 800,
                    color: scoreColour(metacritic),
                    border: `2px solid ${scoreColour(metacritic)}55`,
                  }}
                >
                  {metacritic}
                </div>
              </div>
            )}
          </div>

          {genres && (
            <div style={{ marginTop: 18, fontSize: 22, color: "#61617a", display: "flex" }}>
              {genres}
            </div>
          )}
        </div>

        {/* Cover column. Always rendered — when a title has no artwork the
            generated poster keeps the composition balanced instead of leaving
            half the card empty. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 460,
          }}
        >
          {cover ? (
            // Satori rasterises this to a PNG on the server — there is no
            // browser and no LCP here, so next/image has no role.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt=""
              width={330}
              height={440}
              style={{
                width: 330,
                height: 440,
                objectFit: "cover",
                borderRadius: 20,
                border: "2px solid rgba(255,255,255,0.14)",
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 330,
                height: 440,
                borderRadius: 20,
                border: "2px solid rgba(255,255,255,0.14)",
                background: `linear-gradient(155deg, hsl(${hue}, 62%, 24%), hsl(${(hue + 48) % 360}, 58%, 12%))`,
                fontSize: 128,
                fontWeight: 800,
                color: "rgba(255,255,255,0.16)",
              }}
            >
              {initials(name)}
            </div>
          )}
        </div>

      </div>
    ),
    size,
  );
}
