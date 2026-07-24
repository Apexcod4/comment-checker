import type { RawComment } from "./x-client";

const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

export function hasYoutubeKey(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

function getKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error(
      "YOUTUBE_API_KEY is not set. Add it to .env.local (see .env.example)."
    );
  }
  return key;
}

/**
 * Pulls top-level comments for a YouTube video via the official Data API
 * v3 (commentThreads.list). Costs 1 quota unit per page regardless of
 * page size, against a free 10,000 unit/day project quota.
 */
export async function fetchYoutubeComments(
  videoId: string,
  limit: number
): Promise<RawComment[]> {
  const key = getKey();
  const comments: RawComment[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${YT_API_BASE}/commentThreads`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("videoId", videoId);
    url.searchParams.set("maxResults", "100");
    url.searchParams.set("textFormat", "plainText");
    url.searchParams.set("key", key);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube API request failed (${res.status}): ${body}`);
    }
    const data = await res.json();

    for (const item of data.items ?? []) {
      const top = item.snippet?.topLevelComment?.snippet;
      if (!top?.textDisplay) continue;
      comments.push({
        id: item.snippet?.topLevelComment?.id ?? String(comments.length),
        authorId: top.authorDisplayName ?? "unknown",
        text: top.textDisplay,
        createdAt: top.publishedAt ?? new Date().toISOString(),
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken && comments.length < limit);

  return comments.slice(0, limit);
}
