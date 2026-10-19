import { Monitor } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { brandIcon } from "@/components/brand/brand-icons";
import { platformKeys, type PlatformKey } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * Platform availability, drawn with the platforms' own marks.
 *
 * "PC" has no single logo that isn't a specific vendor's — Windows, and a game
 * on PC may equally be Linux or Mac — so it keeps a neutral monitor glyph.
 * Everything else uses the real brand mark, which is far more scannable in a
 * dense row than generic controller shapes.
 */

const LABELS: Record<PlatformKey, string> = {
  pc: "PC",
  playstation: "PlayStation",
  xbox: "Xbox",
  nintendo: "Nintendo",
  mac: "macOS",
  linux: "Linux",
  mobile: "Mobile",
  web: "Browser",
};

/** Not every family maps onto a brand mark; `pc` and `web` fall back to a glyph. */
function hasBrand(key: PlatformKey): boolean {
  return key !== "pc" && key !== "web" && brandIcon(key) !== null;
}

function PlatformGlyph({
  platform,
  size,
  tinted,
}: {
  platform: PlatformKey;
  size: number;
  tinted?: boolean;
}) {
  if (hasBrand(platform)) {
    return <BrandIcon name={platform} size={size} tinted={tinted} title={LABELS[platform]} />;
  }
  return (
    <>
      <Monitor size={size} aria-hidden />
      <span className="sr-only">{LABELS[platform]}</span>
    </>
  );
}

export function PlatformIcons({
  platforms,
  max = 4,
  size = 14,
  className,
  tinted = false,
}: {
  platforms: { slug: string }[];
  max?: number;
  size?: number;
  className?: string;
  tinted?: boolean;
}) {
  const keys = platformKeys(platforms);
  if (keys.length === 0) return null;

  const shown = keys.slice(0, max);
  const overflow = keys.length - shown.length;

  return (
    <ul className={cn("flex items-center gap-2", className)}>
      {shown.map((key) => (
        <li key={key} className={cn(!tinted && "text-faint")} title={LABELS[key]}>
          <PlatformGlyph platform={key} size={size} tinted={tinted} />
        </li>
      ))}
      {overflow > 0 && (
        <li className="text-[10px] font-medium text-faint tabular-nums">+{overflow}</li>
      )}
    </ul>
  );
}

/** Labelled variant for the detail page, where there's room to name platforms. */
export function PlatformList({ platforms }: { platforms: { slug: string; name: string }[] }) {
  const keys = platformKeys(platforms);
  return (
    <ul className="flex flex-wrap gap-2">
      {keys.map((key) => (
        <li
          key={key}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-fg/[0.04] px-3 py-1.5 text-xs text-muted transition-colors hover:border-line-strong"
        >
          <PlatformGlyph platform={key} size={15} tinted />
          {LABELS[key]}
        </li>
      ))}
    </ul>
  );
}
