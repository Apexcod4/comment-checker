# Comment Intelligence

Scans a post's comments and separates real reaction from spam — sentiment,
recurring themes, and a filterable log of every comment.

- **X (Twitter)** — pulled automatically via the official X API.
- **Instagram / TikTok / Facebook** — pulled automatically via Apify actors.
- **YouTube** — pulled automatically via the official YouTube Data API v3.
- **Reddit** — pulled automatically via the official Reddit OAuth API (app-only).
- **Snapchat** — no working automated option found; falls back to manual paste.
- Any platform falls back to manual paste if its credentials aren't configured.
- Classification (sentiment, spam, themes, actions) runs through OpenAI's
  gpt-oss-20b via Groq's OpenAI-compatible endpoint.
- **Video download (X, Instagram)** — the "Download video" button next to
  "Scan" turns a public post link into an MP4 download. See Notes below.

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` (all optional — missing ones just fall back to manual paste):

- `GROQ_API_KEY` — from [console.groq.com](https://console.groq.com). Required for classification to work at all.
- `X_BEARER_TOKEN` — from the [X Developer Console](https://console.x.com) (App-only Bearer Token). Reads are billed per-call.
- `APIFY_API_TOKEN` — from [console.apify.com](https://console.apify.com). Powers Instagram/TikTok/Facebook. Billed per result.
- `YOUTUBE_API_KEY` — from [Google Cloud Console](https://console.cloud.google.com) (enable YouTube Data API v3). Free tier is generous.
- `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` — from [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) (create a "script" app). Free.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes

- Comment volume is capped at `MAX_COMMENTS` (150) in `lib/x-client.ts` for
  Apify/YouTube/Reddit/manual-paste, and separately at `X_MAX_COMMENTS` (100)
  for X specifically, since X's official API bills per read and that budget
  is tight. 150 isn't arbitrary — it's `BATCH_SIZE * CONCURRENCY` from
  `lib/classify.ts` (50 * 3), i.e. exactly one wave of concurrent
  classification calls. Raising it means additional waves, each risking a
  Groq 429 rate-limit backoff that compounds toward the Vercel function
  timeout (300s) on large threads. Raise either cap deliberately, not by
  accident.
- **Instagram is capped at 15 comments regardless of `MAX_COMMENTS`.** Root
  cause confirmed via 4-stage logging (Apify → code filter → sent to AI →
  AI response all showed 15, so nothing drops in our code) plus the Apify
  Console itself: `apify/instagram-comment-scraper` gates free-tier usage to
  "the top 15 comments, sorted by newest" — full access needs the Apify
  account to be on a paid **Starter plan** (~$29-39/mo, as prepaid credit,
  not a separate fee). This is an Apify monetization gate on this one
  actor, not an Instagram-wide defense as earlier assumed here (that theory
  came from one failed alternative-actor test, which was likely hitting the
  same kind of gate rather than proving a platform-wide block). Deferred
  for now — revisit once there's revenue to justify the recurring cost.
  Set client expectations accordingly until then: Instagram reports reflect
  a small recent sample, not the full comment count.
- **Video download** (`/api/download` resolves a link, `/api/download/file`
  streams the bytes; nothing is stored). Public posts only, 100 MB cap
  (`MAX_DOWNLOAD_BYTES` in `lib/video-download.ts`).
  - **X** tries X's free, keyless syndication endpoint first (unofficial, so
    it can change or break without notice). Only if that call itself fails
    (network error, 429, 5xx, bad response) does it spend a billed X API
    read via `X_BEARER_TOKEN`. A definite "no video" or "gone" from the free
    endpoint is final and never triggers the paid fallback.
  - **Instagram** uses `apify/instagram-scraper` (billed per run), which
    needs `APIFY_API_TOKEN`. Its output shape is handled defensively but
    hasn't been verified against a live run yet.
  - The file route only fetches `video.twimg.com`, `*.cdninstagram.com` and
    `*.fbcdn.net`, so it can't be pointed at arbitrary URLs.
  - No rate limiting yet: every download costs bandwidth, and (for
    Instagram, or X when the free endpoint fails) money.
- Models get deprecated by providers without much warning (this happened
  once already — see git history for the DeepSeek V4 Pro → Flash swap). If
  classification suddenly starts failing, check whether `MODEL` in
  `lib/classify.ts` is still live on Groq.
