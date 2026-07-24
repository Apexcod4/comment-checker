import { NextRequest, NextResponse } from "next/server";
import { detectPlatform } from "@/lib/platform";
import { fetchTweetAndReplies, MAX_COMMENTS, type RawComment } from "@/lib/x-client";
import { classifyComments } from "@/lib/classify";

export const maxDuration = 60;

interface AnalyzeRequest {
  link?: string;
  platform?: "instagram" | "tiktok";
  pastedComments?: string;
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

      if (detected.platform === "instagram" || detected.platform === "tiktok") {
        return NextResponse.json(
          {
            error: `${detected.platform} links can't be pulled automatically yet.`,
            platform: detected.platform,
            requiresManualPaste: true,
          },
          { status: 422 }
        );
      }

      return NextResponse.json(
        { error: "Unrecognized link. Paste an X, Instagram, or TikTok post URL." },
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
