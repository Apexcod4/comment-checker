import { fetchTweetVideoVariants, type VideoVariant } from "./x-client";
import { fetchInstagramVideoUrl, hasApifyToken } from "./apify-client";

// Hard ceiling on a single download so one huge file can't tie up the server.
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export class DownloadError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export interface ResolvedVideo {
  url: string;
  filename: string;
  label: string | null;
}

// The file route only ever fetches from these video CDNs, so it can't be
// pointed at arbitrary URLs. Suffixes carry a leading dot so a lookalike
// such as "evilcdninstagram.com" doesn't match.
const ALLOWED_VIDEO_HOSTS = ["video.twimg.com"];
const ALLOWED_VIDEO_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"];

export function parseAllowedVideoUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    ALLOWED_VIDEO_HOSTS.includes(host) ||
    ALLOWED_VIDEO_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  return allowed ? url : null;
}

/**
 * Releases a response body we've decided not to read. Deliberately not
 * awaited: under Next's patched fetch, awaiting cancel() on an unread body
 * never resolves, which hangs the whole request.
 */
export function discardBody(res: Response): void {
  res.body?.cancel().catch(() => {});
}

/**
 * Fetches an allowlisted video URL. Redirects are followed by hand so every
 * hop is re-checked against the allowlist rather than trusting the CDN.
 */
export async function fetchAllowedVideo(
  rawUrl: string,
  method: "GET" | "HEAD"
): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= 3; hop++) {
    const url = parseAllowedVideoUrl(current);
    if (!url) {
      throw new DownloadError(
        "That link isn't a video from a supported platform.",
        400
      );
    }
    const res = await fetch(url, { method, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      discardBody(res);
      const next = res.headers.get("location");
      if (!next) break;
      current = new URL(next, url).toString();
      continue;
    }
    return res;
  }
  throw new DownloadError("The platform sent too many redirects for that video.", 502);
}

/**
 * HEADs the video so an oversized file is refused before the browser starts
 * downloading it. Advisory only: if the HEAD fails, the streaming cap in the
 * file route still applies.
 */
export async function probeVideoSize(url: string): Promise<number | null> {
  try {
    const res = await fetchAllowedVideo(url, "HEAD");
    const length = Number(res.headers.get("content-length"));
    return res.ok && Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  }
}

export function safeFilename(name: string): string {
  const base =
    name
      .replace(/\.mp4$/i, "")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 80) || "video";
  return `${base}.mp4`;
}

export function pickBestMp4(variants: VideoVariant[]): VideoVariant | null {
  const mp4s = variants.filter((v) => v.contentType === "video/mp4" && v.url);
  if (mp4s.length === 0) return null;
  return mp4s.reduce((best, v) => (v.bitrate > best.bitrate ? v : best));
}

// X video URLs embed their resolution, e.g. /vid/avc1/1280x720/abc.mp4.
function qualityLabel(url: string): string | null {
  const match = url.match(/\/(\d{3,4})x(\d{3,4})\//);
  if (!match) return null;
  return `${Math.min(Number(match[1]), Number(match[2]))}p`;
}

// X's public embed endpoint. No key and no per-request cost, but it's
// unofficial and X can change or block it at any time.
function syndicationToken(tweetId: string): string {
  return ((Number(tweetId) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, "");
}

interface SyndicationMedia {
  type?: string;
  video_info?: {
    variants?: Array<{ content_type?: string; bitrate?: number; url?: string }>;
  };
}

type FreeLookup = { variants: VideoVariant[] } | { unavailable: true };

async function lookupViaSyndication(tweetId: string): Promise<FreeLookup> {
  const url = new URL("https://cdn.syndication.twimg.com/tweet-result");
  url.searchParams.set("id", tweetId);
  url.searchParams.set("lang", "en");
  url.searchParams.set("token", syndicationToken(tweetId));

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return { unavailable: true };
  if (!res.ok) throw new Error(`syndication endpoint returned ${res.status}`);

  const data = await res.json();
  if (data?.__typename === "TweetTombstone") return { unavailable: true };
  if (!data?.id_str) throw new Error("unexpected syndication response shape");

  const variants: VideoVariant[] = [];
  for (const media of (data.mediaDetails ?? []) as SyndicationMedia[]) {
    if (media.type !== "video" && media.type !== "animated_gif") continue;
    for (const v of media.video_info?.variants ?? []) {
      if (!v.url || !v.content_type) continue;
      variants.push({
        url: v.url,
        contentType: v.content_type,
        bitrate: v.bitrate ?? 0,
      });
    }
  }
  return { variants };
}

async function lookupViaOfficialApi(tweetId: string): Promise<VideoVariant[]> {
  if (!process.env.X_BEARER_TOKEN) {
    throw new DownloadError(
      "X blocked the free lookup and the X API fallback isn't set up on this server.",
      502
    );
  }
  try {
    const { found, variants } = await fetchTweetVideoVariants(tweetId);
    if (!found) {
      throw new DownloadError("That post is private or has been deleted.", 404);
    }
    return variants;
  } catch (err) {
    if (err instanceof DownloadError) throw err;
    console.error("[download] X API lookup failed:", err);
    throw new DownloadError(
      "X blocked the request, so the video couldn't be fetched. Try again later.",
      502
    );
  }
}

/**
 * Finds the best MP4 for an X post. Tries the free endpoint first and only
 * spends a billed X API read when that endpoint itself fails (network error,
 * 429, 5xx, bad response). A definite answer from the free endpoint, "gone"
 * or "no video", is final: the paid API can't change it.
 */
export async function resolveXVideo(tweetId: string): Promise<ResolvedVideo> {
  let free: FreeLookup | null = null;
  try {
    free = await lookupViaSyndication(tweetId);
  } catch (err) {
    console.warn("[download] free X endpoint failed, trying X API:", err);
  }

  if (free && "unavailable" in free) {
    throw new DownloadError(
      "That post is private, deleted, or age-restricted.",
      404
    );
  }

  const variants = free ? free.variants : await lookupViaOfficialApi(tweetId);
  const best = pickBestMp4(variants);
  if (!best) {
    throw new DownloadError("That post doesn't contain a video.", 404);
  }
  return {
    url: best.url,
    filename: safeFilename(`x-${tweetId}`),
    label: qualityLabel(best.url),
  };
}

export async function resolveInstagramVideo(
  postUrl: string,
  shortCode: string
): Promise<ResolvedVideo> {
  if (!hasApifyToken()) {
    throw new DownloadError(
      "Instagram downloads aren't set up on this server.",
      503
    );
  }
  let videoUrl: string | null;
  try {
    videoUrl = await fetchInstagramVideoUrl(postUrl);
  } catch (err) {
    console.error("[download] Instagram lookup failed:", err);
    throw new DownloadError(
      "Instagram blocked the request, so the video couldn't be fetched. Try again later.",
      502
    );
  }
  if (!videoUrl) {
    throw new DownloadError(
      "No video found. The post may be private, deleted, or photo-only.",
      404
    );
  }
  return {
    url: videoUrl,
    filename: safeFilename(`instagram-${shortCode}`),
    label: null,
  };
}
