import { NextRequest, NextResponse } from "next/server";
import { detectPlatform } from "@/lib/platform";
import {
  DownloadError,
  MAX_DOWNLOAD_BYTES,
  parseAllowedVideoUrl,
  probeVideoSize,
  resolveInstagramVideo,
  resolveXVideo,
  type ResolvedVideo,
} from "@/lib/video-download";

export const maxDuration = 120;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Turns a pasted X or Instagram post link into a download URL. The video
 * itself is streamed by /api/download/file, never stored here.
 */
export async function POST(req: NextRequest) {
  let body: { link?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }
  if (!body.link) return errorResponse("Paste a post link first.", 400);

  try {
    const detected = detectPlatform(body.link);
    let video: ResolvedVideo;

    if (detected.platform === "x") {
      if (!detected.postId) {
        return errorResponse("Couldn't find a post id in that X link.", 400);
      }
      video = await resolveXVideo(detected.postId);
    } else if (detected.platform === "instagram") {
      if (!detected.postId) {
        return errorResponse("Couldn't find a post code in that Instagram link.", 400);
      }
      video = await resolveInstagramVideo(detected.url, detected.postId);
    } else {
      return errorResponse(
        "Video download only works for X and Instagram posts.",
        400
      );
    }

    if (!parseAllowedVideoUrl(video.url)) {
      throw new DownloadError(
        "The platform returned a video link we can't download.",
        502
      );
    }

    const bytes = await probeVideoSize(video.url);
    if (bytes !== null && bytes > MAX_DOWNLOAD_BYTES) {
      const mb = Math.round(bytes / (1024 * 1024));
      const capMb = MAX_DOWNLOAD_BYTES / (1024 * 1024);
      throw new DownloadError(
        `That video is ${mb} MB, over the ${capMb} MB download limit.`,
        413
      );
    }

    const fileUrl = `/api/download/file?${new URLSearchParams({
      url: video.url,
      filename: video.filename,
    })}`;
    return NextResponse.json({
      platform: detected.platform,
      filename: video.filename,
      label: video.label,
      bytes,
      fileUrl,
    });
  } catch (err) {
    if (err instanceof DownloadError) {
      return errorResponse(err.message, err.status);
    }
    console.error("[download] unexpected error:", err);
    return errorResponse("Something went wrong fetching that video.", 500);
  }
}
