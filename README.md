# Comment Intelligence

Scans a post's comments and separates real reaction from spam — sentiment,
recurring themes, and a filterable log of every comment.

- **X (Twitter)** — pulled automatically via the official X API.
- **Instagram / TikTok / Facebook** — pulled automatically via Apify actors.
- **YouTube** — pulled automatically via the official YouTube Data API v3.
- **Reddit** — pulled automatically via the official Reddit OAuth API (app-only).
- **Snapchat** — no working automated option found; falls back to manual paste.
- Any platform falls back to manual paste if its credentials aren't configured.
- Classification (sentiment, spam, themes, summary) runs through Llama 3.3 70B
  via Groq's OpenAI-compatible endpoint.

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

- Comment volume is capped at `MAX_COMMENTS` (500) in `lib/x-client.ts` for
  Apify/YouTube/Reddit/manual-paste, and separately at `X_MAX_COMMENTS` (100)
  for X specifically, since X's official API bills per read and that budget
  is tight. Raise either deliberately, not by accident.
- **Instagram comment counts are often much lower than the real total.** The
  Apify actor only sees comments visible to logged-out Instagram viewers,
  with no way to paginate deeper on the free tier — a post with hundreds of
  comments may only return a dozen or so. This is a known limitation of the
  actor, not a bug here. Worth mentioning to clients so expectations are set
  correctly.
- Models get deprecated by providers without much warning (this happened
  once already — see git history for the DeepSeek V4 Pro → Flash swap). If
  classification suddenly starts failing, check whether `MODEL` in
  `lib/classify.ts` is still live on Groq.
