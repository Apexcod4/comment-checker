export type Platform = "x" | "instagram" | "tiktok" | "unknown";

export interface DetectedLink {
  platform: Platform;
  postId: string | null;
  url: string;
}

const X_HOST = /^(x\.com|twitter\.com|mobile\.twitter\.com)$/i;
const INSTAGRAM_HOST = /^(www\.)?instagram\.com$/i;
const TIKTOK_HOST = /^(www\.)?tiktok\.com$/i;

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

  return { platform: "unknown", postId: null, url: url.toString() };
}
