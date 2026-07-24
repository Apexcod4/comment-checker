import type { RawComment } from "./x-client";

const USER_AGENT = "comment-intelligence/1.0";

export function hasRedditCreds(): boolean {
  return Boolean(
    process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET
  );
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are not set. Add them to .env.local (see .env.example)."
    );
  }

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit auth failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

/**
 * Pulls top-level comments for a Reddit post via the official OAuth API
 * (app-only client_credentials grant — no user login needed for public
 * read access). `permalink` is the post's path, e.g.
 * "/r/subreddit/comments/abc123/title/".
 */
export async function fetchRedditComments(
  permalink: string,
  limit: number
): Promise<RawComment[]> {
  const token = await getAccessToken();
  const url = `https://oauth.reddit.com${permalink}?limit=${Math.min(limit, 100)}&depth=1`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit API request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const commentListing = data?.[1]?.data?.children ?? [];

  const comments: RawComment[] = [];
  for (const child of commentListing) {
    if (child.kind !== "t1") continue; // skip "load more" stubs etc.
    const c = child.data;
    if (!c?.body) continue;
    comments.push({
      id: c.id ?? String(comments.length),
      authorId: c.author ?? "unknown",
      text: c.body,
      createdAt: c.created_utc
        ? new Date(c.created_utc * 1000).toISOString()
        : new Date().toISOString(),
    });
  }

  return comments.slice(0, limit);
}
