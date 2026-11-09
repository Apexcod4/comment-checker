import { NextRequest, NextResponse } from "next/server";
import {
  DownloadError,
  MAX_DOWNLOAD_BYTES,
  discardBody,
  fetchAllowedVideo,
  parseAllowedVideoUrl,
  safeFilename,
} from "@/lib/video-download";

export const maxDuration = 300;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Streams an X/Instagram video to the browser as a file download. Browsers
 * block saving straight from the platforms' CDNs, so it goes through here.
 * Only allowlisted video hosts are fetched, files over the size cap are
 * refused, and nothing is stored: bytes pass straight through.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const filename = safeFilename(req.nextUrl.searchParams.get("filename") ?? "video");

  if (!url || !parseAllowedVideoUrl(url)) {
    return errorResponse("That isn't a downloadable video link.", 400);
  }

  let upstream: Response;
  try {
    upstream = await fetchAllowedVideo(url, "GET");
  } catch (err) {
    if (err instanceof DownloadError) return errorResponse(err.message, err.status);
    console.error("[download/file] upstream fetch failed:", err);
    return errorResponse("Couldn't reach the platform's video server.", 502);
  }

  if (!upstream.ok || !upstream.body) {
    discardBody(upstream);
    return errorResponse(
      "The platform refused to serve that video. The link may have expired, so try again.",
      502
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("video/")) {
    discardBody(upstream);
    return errorResponse("That link doesn't point to a video file.", 415);
  }

  const length = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_DOWNLOAD_BYTES) {
    discardBody(upstream);
    return errorResponse("That video is over the download size limit.", 413);
  }

  // Backstop for responses with no (or a wrong) Content-Length: cut the
  // stream off once it passes the cap.
  let sent = 0;
  const capped = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        sent += chunk.byteLength;
        if (sent > MAX_DOWNLOAD_BYTES) {
          controller.error(new Error("download size limit exceeded"));
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );

  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (Number.isFinite(length) && length > 0) {
    headers.set("Content-Length", String(length));
  }

  return new Response(capped, { headers });
}
