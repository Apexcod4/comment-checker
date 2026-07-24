# Comment Intelligence

Scans a post's comments and separates real reaction from spam — sentiment,
recurring themes, and a filterable log of every comment.

- **X (Twitter)** links are pulled automatically via the X API.
- **Instagram / TikTok** links require pasting the comment text manually
  (no supported API for pulling third-party comments on those platforms).
- Classification runs through DeepSeek V4 Pro via NVIDIA's OpenAI-compatible
  endpoint.

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

- `X_BEARER_TOKEN` — from the [X Developer Console](https://console.x.com) (App-only Bearer Token). Reads are billed per-call.
- `NVIDIA_API_KEY` — from [build.nvidia.com](https://build.nvidia.com).

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes

- Comment volume per report is capped (`MAX_COMMENTS` in `lib/x-client.ts`) to
  keep X API cost and NVIDIA response time bounded — raise it deliberately,
  not by accident.
- The free NVIDIA tier is slow (expect 1–3+ minutes per report); classification
  batches run with limited concurrency to avoid overwhelming it.
