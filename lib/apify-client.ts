import type { RawComment } from "./x-client";

const APIFY_BASE = "https://api.apify.com/v2";

export function hasApifyToken(): boolean {
  return Boolean(process.env.APIFY_API_TOKEN);
}

function getApifyToken(): string {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      "APIFY_API_TOKEN is not set. Add it to .env.local (see .env.example)."
    );
  }
  return token;
}

async function runActorSync(
  actorId: string,
  input: Record<string, unknown>
): Promise<unknown[]> {
  const token = getApifyToken();
  const url = `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?token=${token}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify actor ${actorId} failed (${res.status}): ${body}`);
  }

  return res.json();
}

// Field names vary slightly between Apify actors/versions, so this reads
// defensively rather than assuming one exact shape.
interface ApifyCommentItem {
  id?: string;
  cid?: string;
  commentId?: string;
  tweetId?: string;
  text?: string;
  comment?: string;
  message?: string;
  contentText?: string;
  ownerUsername?: string;
  uniqueId?: string;
  authorName?: string;
  name?: string;
  userName?: string;
  timestamp?: string;
  createTimeISO?: string;
  date?: string;
  dateTime?: string;
}

function toRawComments(items: unknown[]): RawComment[] {
  return (items as ApifyCommentItem[])
    .map((item, i): RawComment | null => {
      const text = item.text ?? item.comment ?? item.message ?? item.contentText ?? "";
      if (!text.trim()) return null;
      return {
        id: item.id ?? item.cid ?? item.commentId ?? item.tweetId ?? String(i),
        authorId:
          item.ownerUsername ??
          item.uniqueId ??
          item.authorName ??
          item.userName ??
          item.name ??
          "unknown",
        text,
        createdAt:
          item.timestamp ??
          item.createTimeISO ??
          item.date ??
          item.dateTime ??
          new Date().toISOString(),
      };
    })
    .filter((c): c is RawComment => c !== null);
}

/**
 * Pulls comments from an Instagram post/reel via Apify's
 * apify/instagram-comment-scraper actor.
 */
export async function fetchInstagramComments(
  postUrl: string,
  limit: number
): Promise<RawComment[]> {
  const items = await runActorSync("apify~instagram-comment-scraper", {
    directUrls: [postUrl],
    resultsLimit: limit,
  });
  console.log(`[STAGE 1] Apify raw items returned: ${items.length}`);
  if (items.length > 0) {
    console.log(`[STAGE 1] Sample raw item keys: ${Object.keys(items[0] as object).join(", ")}`);
  }

  const comments = toRawComments(items);
  console.log(`[STAGE 2] After code-side filtering: ${comments.length}`);

  return comments;
}

interface ApifyPostItem {
  videoUrl?: string;
  childPosts?: Array<{ videoUrl?: string }>;
}

/**
 * Picks the video file out of an Instagram post scrape: the post's own
 * `videoUrl` for a reel/video, else the first video inside a carousel.
 */
export function pickInstagramVideoUrl(items: unknown[]): string | null {
  for (const item of items as ApifyPostItem[]) {
    if (item?.videoUrl) return item.videoUrl;
    const child = item?.childPosts?.find((c) => c.videoUrl);
    if (child?.videoUrl) return child.videoUrl;
  }
  return null;
}

/**
 * Looks up the video file for an Instagram post/reel via Apify's
 * apify/instagram-scraper actor (billed per run).
 */
export async function fetchInstagramVideoUrl(
  postUrl: string
): Promise<string | null> {
  const items = await runActorSync("apify~instagram-scraper", {
    directUrls: [postUrl],
    resultsType: "posts",
    resultsLimit: 1,
  });
  return pickInstagramVideoUrl(items);
}

/**
 * Pulls comments from a TikTok video via Apify's
 * clockworks/tiktok-comments-scraper actor.
 */
export async function fetchTiktokComments(
  videoUrl: string,
  limit: number
): Promise<RawComment[]> {
  const items = await runActorSync("clockworks~tiktok-comments-scraper", {
    postURLs: [videoUrl],
    commentsPerPost: limit,
  });
  return toRawComments(items);
}

/**
 * Pulls comments from a Facebook post/video via Apify's
 * apify/facebook-comments-scraper actor.
 */
export async function fetchFacebookComments(
  postUrl: string,
  limit: number
): Promise<RawComment[]> {
  const items = await runActorSync("apify~facebook-comments-scraper", {
    startUrls: [{ url: postUrl }],
    maxPostComments: limit,
  });
  return toRawComments(items);
}
