import { NextRequest, NextResponse } from "next/server";
import { detectPlatform, type Platform } from "@/lib/platform";
import { fetchTweetAndReplies, MAX_COMMENTS, type RawComment } from "@/lib/x-client";
import {
  fetchInstagramComments,
  fetchTiktokComments,
  fetchFacebookComments,
  hasApifyToken,
} from "@/lib/apify-client";
import { fetchYoutubeComments, hasYoutubeKey } from "@/lib/youtube-client";
import { fetchRedditComments, hasRedditCreds } from "@/lib/reddit-client";
import { classifyComments } from "@/lib/classify";

export const maxDuration = 60;

interface AnalyzeRequest {
  link?: string;
  platform?: Platform;
  pastedComments?: string;
}

function manualPasteResponse(platform: Platform) {
  return NextResponse.json(
    {
      error: `${platform} links can't be pulled automatically yet.`,
      platform,
      requiresManualPaste: true,
    },
    { status: 422 }
  );
}

function commentsFromPastedText(raw: string): { comments: RawComment[]; truncated: boolean } {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const comments = lines.slice(0, MAX_COMMENTS).map((text, i) => ({
    id: String(i),
    authorId: "manual",
    text,
    createdAt: new Date().toISOString(),
  }));

  return { comments, truncated: lines.length > MAX_COMMENTS };
}

export async function POST(req: NextRequest) {
  let body: AnalyzeRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    // Manual path: user pasted comment text directly (Instagram/TikTok).
    if (body.pastedComments) {
      const { comments, truncated } = commentsFromPastedText(body.pastedComments);
      if (comments.length === 0) {
        return NextResponse.json(
          { error: "No comment text found in the pasted content." },
          { status: 400 }
        );
      }
      const result = await classifyComments(comments);
      return NextResponse.json({
        platform: body.platform ?? "unknown",
        truncated,
        ...result,
      });
    }

    // Link path: only X can be fetched automatically.
    if (body.link) {
      const detected = detectPlatform(body.link);

      if (detected.platform === "x") {
        if (!detected.postId) {
          return NextResponse.json(
            { error: "Couldn't find a tweet/post id in that X link." },
            { status: 400 }
          );
        }
        const { comments, truncated } = await fetchTweetAndReplies(detected.postId);
        const result = await classifyComments(comments);
        return NextResponse.json({ platform: "x", truncated, ...result });
      }

      // Snapchat: the only actor found that scrapes Spotlight comments
      // requires a paid rental beyond usage cost, so this stays
      // manual-paste-only for now.
      if (detected.platform === "snapchat") {
        return manualPasteResponse("snapchat");
      }

      if (
        detected.platform === "instagram" ||
        detected.platform === "tiktok" ||
        detected.platform === "facebook"
      ) {
        // No Apify token configured: fall back to the manual-paste flow.
        if (!hasApifyToken()) {
          return manualPasteResponse(detected.platform);
        }

        const comments =
          detected.platform === "instagram"
            ? await fetchInstagramComments(detected.url, MAX_COMMENTS)
            : detected.platform === "tiktok"
              ? await fetchTiktokComments(detected.url, MAX_COMMENTS)
              : await fetchFacebookComments(detected.url, MAX_COMMENTS);

        const capped = comments.slice(0, MAX_COMMENTS);
        const truncated = comments.length >= MAX_COMMENTS;

        if (capped.length === 0) {
          return NextResponse.json(
            { error: "No comments found on that post." },
            { status: 400 }
          );
        }

        const result = await classifyComments(capped);
        return NextResponse.json({
          platform: detected.platform,
          truncated,
          ...result,
        });
      }

      if (detected.platform === "youtube") {
        if (!detected.postId) {
          return NextResponse.json(
            { error: "Couldn't find a video id in that YouTube link." },
            { status: 400 }
          );
        }
        if (!hasYoutubeKey()) {
          return manualPasteResponse("youtube");
        }

        const comments = await fetchYoutubeComments(detected.postId, MAX_COMMENTS);
        const truncated = comments.length >= MAX_COMMENTS;

        if (comments.length === 0) {
          return NextResponse.json(
            { error: "No comments found on that video (or comments are disabled)." },
            { status: 400 }
          );
        }

        const result = await classifyComments(comments);
        return NextResponse.json({ platform: "youtube", truncated, ...result });
      }

      if (detected.platform === "reddit") {
        if (!detected.postId) {
          return NextResponse.json(
            { error: "Couldn't find a post id in that Reddit link." },
            { status: 400 }
          );
        }
        if (!hasRedditCreds()) {
          return manualPasteResponse("reddit");
        }

        const permalink = new URL(detected.url).pathname;
        const comments = await fetchRedditComments(permalink, MAX_COMMENTS);
        const truncated = comments.length >= MAX_COMMENTS;

        if (comments.length === 0) {
          return NextResponse.json(
            { error: "No comments found on that post." },
            { status: 400 }
          );
        }

        const result = await classifyComments(comments);
        return NextResponse.json({ platform: "reddit", truncated, ...result });
      }

      return NextResponse.json(
        {
          error:
            "Unrecognized link. Paste an X, Instagram, TikTok, YouTube, Reddit, Facebook, or Snapchat post URL.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Provide either a link or pastedComments." },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
