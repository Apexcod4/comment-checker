export interface RawComment {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
}

export interface FetchResult {
  postText: string | null;
  comments: RawComment[];
  truncated: boolean;
}

// General cap used for Apify (Instagram/TikTok/Facebook), YouTube, Reddit,
// and the manual-paste path. Classification runs in batches of 50 (see
// BATCH_SIZE in lib/classify.ts) with 3 running concurrently — that trio
// already presses close to Groq's shared 8000 TPM limit, so a 500-comment
// scan (10 batches, 4 concurrent waves) meant repeated 429 retries that
// compounded past even a 300s function timeout. 150 = one wave's worth
// (50 * 3), so a scan needs at most one rate-limit backoff instead of
// several stacked ones.
export const MAX_COMMENTS = 150;

// X's official API bills per read, so it stays capped much lower
// regardless of the general cap above — a heavily replied-to post pulls
// one billed API call per page (100 comments) and this budget is tight.
export const X_MAX_COMMENTS = 100;

const X_API_BASE = "https://api.x.com/2";

function getBearerToken(): string {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    throw new Error(
      "X_BEARER_TOKEN is not set. Add it to .env.local (see .env.example)."
    );
  }
  return token;
}

async function xGet(path: string, params: Record<string, string>) {
  const url = new URL(`${X_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getBearerToken()}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API request failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Pulls a tweet's text plus every reply in its conversation thread using
 * the recent search endpoint (conversation_id filter). Recent search only
 * covers the last 7 days, which is fine for freshly posted content.
 */
export async function fetchTweetAndReplies(tweetId: string): Promise<FetchResult> {
  const tweet = await xGet(`/tweets/${tweetId}`, {
    "tweet.fields": "text,author_id,created_at",
  });
  const postText: string | null = tweet?.data?.text ?? null;

  const comments: RawComment[] = [];
  let nextToken: string | undefined;

  do {
    const params: Record<string, string> = {
      query: `conversation_id:${tweetId}`,
      max_results: "100",
      "tweet.fields": "author_id,created_at",
    };
    if (nextToken) params.next_token = nextToken;

    const page = await xGet("/tweets/search/recent", params);

    for (const t of page?.data ?? []) {
      if (t.id === tweetId) continue; // skip the root post itself
      comments.push({
        id: t.id,
        authorId: t.author_id,
        text: t.text,
        createdAt: t.created_at,
      });
    }

    nextToken = page?.meta?.next_token;
  } while (nextToken && comments.length < X_MAX_COMMENTS);

  return { postText, comments, truncated: Boolean(nextToken) };
}

export interface VideoVariant {
  url: string;
  contentType: string;
  bitrate: number;
}

/**
 * Looks up a tweet's attached video files via the official API. This is a
 * billed read, so it's only the fallback for the free syndication lookup in
 * lib/video-download.ts. `found: false` means the API has no such tweet
 * (deleted, or protected from an app-only token); an empty `variants` list
 * on a found tweet means it has no video.
 */
export async function fetchTweetVideoVariants(
  tweetId: string
): Promise<{ found: boolean; variants: VideoVariant[] }> {
  const res = await xGet(`/tweets/${tweetId}`, {
    expansions: "attachments.media_keys",
    "media.fields": "type,variants",
  });
  // v2 reports missing/protected tweets as a 200 with `errors` and no `data`.
  if (!res?.data) return { found: false, variants: [] };

  const variants: VideoVariant[] = [];
  for (const media of res?.includes?.media ?? []) {
    if (media.type !== "video" && media.type !== "animated_gif") continue;
    for (const v of media.variants ?? []) {
      variants.push({
        url: v.url,
        contentType: v.content_type,
        bitrate: v.bit_rate ?? 0,
      });
    }
  }
  return { found: true, variants };
}
