export type Platform =
  | "x"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "reddit"
  | "facebook"
  | "snapchat"
  | "unknown";

export interface DetectedLink {
  platform: Platform;
  postId: string | null;
  url: string;
}

const X_HOST = /^(x\.com|twitter\.com|mobile\.twitter\.com)$/i;
const INSTAGRAM_HOST = /^(www\.)?instagram\.com$/i;
const TIKTOK_HOST = /^(www\.)?tiktok\.com$/i;
const YOUTUBE_HOST = /^(www\.|m\.)?youtube\.com$/i;
const YOUTUBE_SHORT_HOST = /^youtu\.be$/i;
const REDDIT_HOST = /^(www\.|old\.)?reddit\.com$/i;
const FACEBOOK_HOST = /^(www\.|m\.|web\.)?facebook\.com$/i;
const FB_WATCH_HOST = /^fb\.watch$/i;
const SNAPCHAT_HOST = /^(www\.)?snapchat\.com$/i;

/**
 * Identifies which platform a pasted post link belongs to and pulls out
 * the post/tweet id where the URL shape makes that possible.
 */
export function detectPlatform(rawUrl: string): DetectedLink {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { platform: "unknown", postId: null, url: rawUrl };
  }

  const host = url.hostname.toLowerCase();

  if (X_HOST.test(host)) {
    // /{user}/status/{id}
    const match = url.pathname.match(/\/status\/(\d+)/);
    return { platform: "x", postId: match ? match[1] : null, url: url.toString() };
  }

  if (INSTAGRAM_HOST.test(host)) {
    // /p/{shortcode}/ or /reel/{shortcode}/
    const match = url.pathname.match(/\/(?:p|reel|tv)\/([^/]+)/);
    return { platform: "instagram", postId: match ? match[1] : null, url: url.toString() };
  }

  if (TIKTOK_HOST.test(host)) {
    // /@{user}/video/{id}
    const match = url.pathname.match(/\/video\/(\d+)/);
    return { platform: "tiktok", postId: match ? match[1] : null, url: url.toString() };
  }

  if (YOUTUBE_HOST.test(host)) {
    // /watch?v={id} or /shorts/{id} or /live/{id}
    const videoId =
      url.searchParams.get("v") ??
      url.pathname.match(/\/(?:shorts|live)\/([^/]+)/)?.[1] ??
      null;
    return { platform: "youtube", postId: videoId, url: url.toString() };
  }

  if (YOUTUBE_SHORT_HOST.test(host)) {
    // youtu.be/{id}
    const videoId = url.pathname.slice(1).split("/")[0] || null;
    return { platform: "youtube", postId: videoId, url: url.toString() };
  }

  if (REDDIT_HOST.test(host)) {
    // /r/{subreddit}/comments/{postId}/...
    const match = url.pathname.match(/\/r\/[^/]+\/comments\/([^/]+)/);
    return { platform: "reddit", postId: match ? match[1] : null, url: url.toString() };
  }

  if (FACEBOOK_HOST.test(host) || FB_WATCH_HOST.test(host)) {
    // Facebook post URLs are inconsistent (posts/{id}, videos/{id},
    // watch?v={id}, photo.php?fbid={id}, reel/{id}, fb.watch/{code}...).
    // The id is only used for display here — the scraper takes the full
    // URL — so this is best-effort and fine to come back null.
    const postId =
      url.pathname.match(/\/(?:posts|videos|reel)\/([^/]+)/)?.[1] ??
      url.searchParams.get("fbid") ??
      url.searchParams.get("v") ??
      (FB_WATCH_HOST.test(host) ? url.pathname.slice(1).split("/")[0] : null) ??
      null;
    return { platform: "facebook", postId, url: url.toString() };
  }

  if (SNAPCHAT_HOST.test(host)) {
    // /spotlight/{id}
    const match = url.pathname.match(/\/spotlight\/([^/]+)/);
    return { platform: "snapchat", postId: match ? match[1] : null, url: url.toString() };
  }

  return { platform: "unknown", postId: null, url: url.toString() };
}
