import { ExternalLink } from "lucide-react";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { brandIcon } from "@/components/brand/brand-icons";
import type { StoreRef, WebsiteRef } from "@/lib/games/types";

/**
 * Storefront links, each carrying its own brand mark.
 *
 * A row of identical generic icons makes people read every label; the real
 * marks let them find "the Steam one" without reading at all. Marks are tinted
 * to their brand colour here because on this surface the logo *is* the label.
 */
export function StoreLinks({ stores }: { stores: StoreRef[] }) {
  if (stores.length === 0) return null;

  return (
    <ul className="space-y-2">
      {stores.map((store) => (
        <li key={`${store.slug}-${store.id}`}>
          <a
            href={store.url ?? `https://${store.domain ?? ""}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 rounded-xl border border-line px-3.5 py-3 text-sm transition-colors hover:border-line-strong hover:bg-fg/[0.04]"
          >
            {brandIcon(store.slug) ? (
              <BrandIcon name={store.slug} size={17} tinted title={null} />
            ) : (
              <span aria-hidden className="h-[17px] w-[17px] rounded bg-fg/10" />
            )}
            <span className="min-w-0 flex-1 truncate">{store.name}</span>
            <ExternalLink
              size={13}
              className="shrink-0 text-faint transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Community and reference links. Kept visually quieter than storefronts — they
 * matter, but they aren't the primary action on the page.
 */
export function CommunityLinks({ websites }: { websites: WebsiteRef[] }) {
  const links = websites.filter(
    (site) => site.kind !== "official" && brandIcon(site.kind) !== null,
  );
  if (links.length === 0) return null;

  const seen = new Set<string>();
  const unique = links.filter((site) => {
    if (seen.has(site.kind)) return false;
    seen.add(site.kind);
    return true;
  });

  return (
    <ul className="flex flex-wrap gap-2">
      {unique.map((site) => (
        <li key={site.kind}>
          <a
            href={site.url}
            target="_blank"
            rel="noopener noreferrer"
            className="grid h-10 w-10 place-items-center rounded-xl border border-line text-muted transition-colors hover:border-line-strong hover:text-text"
          >
            <BrandIcon name={site.kind} size={16} />
          </a>
        </li>
      ))}
    </ul>
  );
}
