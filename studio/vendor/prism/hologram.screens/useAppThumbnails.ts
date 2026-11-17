// hologram-forge (ours, replaces src/hooks/useAppThumbnails.ts; see VENDORED.md): an app's cover and card
// words are what the browser host captured and stored (shell/covers.mjs) in the page's "covers" cache, not
// files on a disk. The host announces each new cover with a "hologram:covers" event; the query refetches.
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export interface AppCard {
  thumbnailUrl: string | null;
  description: string | null;
  tag: string | null;
}

const CACHE = "covers";
const EVENT = "hologram:covers";
const keyOf = (appId: number, part: "webp" | "json") =>
  new URL(`${import.meta.env.BASE_URL}${CACHE}/${encodeURIComponent(String(appId))}.${part}`, location.origin).href;

// One object URL per stored picture, kept for the page's life and replaced when the picture changes.
const urls = new Map<number, { stamp: string; url: string }>();

async function readCard(appId: number): Promise<AppCard> {
  const cache = await caches.open(CACHE);
  const [picture, words] = await Promise.all([cache.match(keyOf(appId, "webp")), cache.match(keyOf(appId, "json"))]);
  let thumbnailUrl: string | null = null;
  if (picture) {
    const stamp = picture.headers.get("x-hologram-version") ?? "";
    const held = urls.get(appId);
    if (held && held.stamp === stamp) thumbnailUrl = held.url;
    else {
      if (held) URL.revokeObjectURL(held.url);
      thumbnailUrl = URL.createObjectURL(await picture.blob());
      urls.set(appId, { stamp, url: thumbnailUrl });
    }
  }
  let description: string | null = null, tag: string | null = null;
  if (words) {
    const card = (await words.json().catch(() => null)) as { description?: unknown; tag?: unknown } | null;
    if (card && typeof card.description === "string") description = card.description;
    if (card && typeof card.tag === "string") tag = card.tag;
  }
  return { thumbnailUrl, description, tag };
}

function useCards(appIds: number[]): Map<number, AppCard> {
  const sortedIds = useMemo(() => [...appIds].sort((a, b) => a - b), [appIds]);
  const client = useQueryClient();
  useEffect(() => {
    const refresh = () => client.invalidateQueries({ queryKey: queryKeys.apps.thumbnails });
    addEventListener(EVENT, refresh);
    return () => removeEventListener(EVENT, refresh);
  }, [client]);
  const { data } = useQuery({
    queryKey: [...queryKeys.apps.thumbnails, "cards", sortedIds],
    queryFn: async () => Promise.all(sortedIds.map(async (appId) => [appId, await readCard(appId)] as const)),
    enabled: sortedIds.length > 0 && typeof caches !== "undefined",
  });
  return useMemo(() => new Map(data ?? []), [data]);
}

/** Prism's signature: `Map<appId, thumbnailUrl>`, for every screen that only shows the picture. */
export function useAppThumbnails(appIds: number[]): Map<number, string | null> {
  const cards = useCards(appIds);
  return useMemo(() => new Map([...cards].map(([id, c]) => [id, c.thumbnailUrl])), [cards]);
}

/** One app's card: its picture, its sentence and its tag. */
export function useAppCard(appId: number): AppCard {
  const ids = useMemo(() => [appId], [appId]);
  return useCards(ids).get(appId) ?? { thumbnailUrl: null, description: null, tag: null };
}
