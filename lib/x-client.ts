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
// and the manual-paste path — all cheap/free per-comment, so this can run
// higher now that Groq classification is fast.
export const MAX_COMMENTS = 500;

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
