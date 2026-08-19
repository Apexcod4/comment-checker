import OpenAI from "openai";
import type { RawComment } from "./x-client";

export type Sentiment = "positive" | "negative" | "neutral";

export interface ClassifiedComment {
  id: string;
  text: string;
  sentiment: Sentiment;
  isSpam: boolean;
}

export interface ThemeCluster {
  theme: string;
  count: number;
  exampleQuotes: string[];
}

export type Urgency = "high" | "medium" | "low";

export interface ActionItem {
  text: string;
  count: number;
  urgency: Urgency;
}

export interface ClassificationResult {
  totalComments: number;
  sentimentBreakdown: Record<Sentiment, number>;
  spamCount: number;
  themes: ThemeCluster[];
  actions: ActionItem[];
  comments: ClassifiedComment[];
}

const URGENCY_RANK: Record<Urgency, number> = { high: 0, medium: 1, low: 2 };

const MODEL = "openai/gpt-oss-20b";
const BATCH_SIZE = 50;

// gpt-oss is a reasoning model — without this it burns the token budget on
// chain-of-thought (in a separate `reasoning` field) and never reaches the
// actual JSON answer in `content`. The Node SDK has no typed knowledge of
// this Groq-specific field.
type GroqChatParams = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
  reasoning_effort?: "low" | "medium" | "high";
};

function getClient(): OpenAI {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Add it to .env.local (see .env.example)."
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate.trim());
}

// Groq's free tier has a tokens-per-minute cap shared across every request
// this app makes — a burst of concurrent batches on a large report can trip
// it. Rather than fail the whole scan on one transient 429, wait for the
// window to clear (Groq tells us exactly how long) and retry.
async function createWithRetry(
  client: OpenAI,
  params: GroqChatParams,
  maxRetries = 3
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.chat.completions.create(params);
    } catch (err) {
      const isRateLimit = err instanceof OpenAI.APIError && err.status === 429;
      if (!isRateLimit || attempt === maxRetries) throw err;

      const headerWaitSeconds = Number(
        err.headers?.get?.("retry-after") ?? NaN
      );
      const messageMatch = err.message.match(/try again in ([\d.]+)s/i);
      const waitSeconds = !Number.isNaN(headerWaitSeconds)
        ? headerWaitSeconds
        : messageMatch
          ? parseFloat(messageMatch[1])
          : 15;
      const waitMs = Math.ceil(waitSeconds * 1000) + 500; // small buffer

      console.log(
        `[RATE LIMIT] Attempt ${attempt + 1}/${maxRetries} hit 429, waiting ${waitMs}ms before retry`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  // Unreachable — the loop above always returns or throws.
  throw new Error("Retry loop exited unexpectedly.");
}

async function classifyBatch(
  client: OpenAI,
  batch: RawComment[]
): Promise<ClassifiedComment[]> {
  const payload = batch.map((c) => ({ id: c.id, text: c.text }));

  const params: GroqChatParams = {
    model: MODEL,
    max_tokens: 4096,
    temperature: 0,
    reasoning_effort: "low",
    messages: [
      {
        role: "user",
        content:
          "Classify each social media comment below. For every item return " +
          "sentiment (\"positive\", \"negative\", or \"neutral\") and isSpam " +
          "(true if it's a bot/ad/copy-paste/engagement-bait comment unrelated " +
          "to genuine reaction). Respond with ONLY a JSON array, no prose, " +
          'shaped like [{"id":"...","sentiment":"positive","isSpam":false}].\n\n' +
          JSON.stringify(payload),
      },
    ],
  };
  const completion = await createWithRetry(client, params);

  const text = completion.choices[0]?.message?.content ?? "";

  const parsed = extractJson(text) as Array<{
    id: string;
    sentiment: Sentiment;
    isSpam: boolean;
  }>;

  console.log(
    `[STAGE 4] Batch sent ${batch.length}, AI accounted for ${parsed.length}`
  );

  const byId = new Map(parsed.map((p) => [p.id, p]));

  return batch.map((c) => {
    const result = byId.get(c.id);
    return {
      id: c.id,
      text: c.text,
      sentiment: result?.sentiment ?? "neutral",
      isSpam: result?.isSpam ?? false,
    };
  });
}

async function clusterThemes(
  client: OpenAI,
  comments: ClassifiedComment[]
): Promise<{ themes: ThemeCluster[]; actions: ActionItem[] }> {
  const genuine = comments.filter((c) => !c.isSpam).map((c) => c.text);
  // Cap the sample so the prompt stays a reasonable size on very large
  // threads. 300 was measured to request ~10.5k tokens in one shot on a
  // real run — over Groq's free-tier 8k TPM limit outright, which no
  // amount of retrying fixes (unlike a transient 429). 150 leaves headroom
  // for the classify batches sharing the same per-minute budget.
  const sample = genuine.slice(0, 150);

  const params: GroqChatParams = {
    model: MODEL,
    // Themes (max 6, short) + actions (max 4, ~12 words each) is a small
    // output — 4096 was unnecessarily eating into the shared TPM budget.
    max_tokens: 1200,
    temperature: 0,
    reasoning_effort: "low",
    messages: [
      {
        role: "user",
        content:
          "These are genuine comments from one social media post. Do two things:\n\n" +
          "1. Identify the 3-6 most common themes/topics people are raising (e.g. " +
          "praise, price complaints, questions about X, confusion about Y). For " +
          "each theme give a short label, an approximate count of matching " +
          "comments, and up to 2 short example quotes pulled verbatim from the " +
          "list.\n\n" +
          "2. Derive concrete actions the CREATOR should take in response to " +
          "their OWN post/product/audience. Be strict — most posts have 1-2 real " +
          "actions, occasionally 0, rarely more than 2.\n\n" +
          "   FIRST, for every action candidate, name the `thirdParty`: any " +
          "outside product/company/service the underlying comment(s) are " +
          "actually about — Gemini, ChatGPT, Instagram, Apple, or any tool the " +
          "creator didn't build — or null if it's entirely about the creator's " +
          "own product, content, or post. Do this ownership check first, before " +
          "anything else, and do NOT let urgency, severity, or emotionally " +
          "loaded words (\"security\", \"bug\", \"broken\", \"urgent\") influence " +
          "it — a broken third-party tool is still not the creator's to fix, no " +
          "matter how badly it's described. Any action with a non-null " +
          "`thirdParty` will be discarded automatically regardless of what else " +
          "you write, so don't bother softening the text to sneak it past — " +
          "just tag it honestly and move on; that comment is still a valid " +
          "theme above, just not an action.\n\n" +
          "   THEN, for candidates that pass (thirdParty is null), apply the " +
          "remaining rules, all mandatory:\n" +
          "   - Start with a concrete action verb: post, reply, DM, ship, answer, " +
          'fix, explain, share, follow up. NEVER use soft/passive verbs like ' +
          '"consider", "acknowledge", "review", "monitor", "engage", "look into" ' +
          "— those aren't actions, they're intentions.\n" +
          "   - Before including an action, test it: \"if the creator does this, " +
          "does something concretely change for their business (a reply gets " +
          "sent, a bug gets fixed, a sale becomes possible)?\" If the honest " +
          "answer is no, or it's just raising awareness, drop it.\n" +
          "   - Every action must carry its supporting count (how many comments " +
          "it's based on) — the number is the evidence.\n" +
          "   - Max ~12 words per action.\n" +
          "   - Order by urgency, not volume — one unresolved problem with the " +
          "creator's own product outranks many compliments. Give each action an " +
          'urgency of "high", "medium", or "low".\n' +
          "   - Prefer fewer, real actions over more, weak ones. If nothing " +
          "passes, return an empty array. Do NOT invent actions just to fill " +
          "space — honesty here is what makes this trustworthy.\n\n" +
          'Respond with ONLY JSON, no prose, shaped like {"themes":[{"theme":"...",' +
          '"count":0,"exampleQuotes":["..."]}],"actions":[{"text":"...","count":0,' +
          '"urgency":"high","thirdParty":null}]}.\n\n' +
          JSON.stringify(sample),
      },
    ],
  };
  const completion = await createWithRetry(client, params);

  const text = completion.choices[0]?.message?.content ?? "";

  const parsed = extractJson(text) as {
    themes: ThemeCluster[];
    actions: Array<ActionItem & { thirdParty: string | null }>;
  };

  // Hard gate: drop anything about a third-party product before urgency
  // ranking even sees it. This runs in code, not the model's judgment,
  // because urgent-sounding language ("security", "bug", "broken") was
  // observed overriding a prompt-only version of this rule.
  const ownedActions = (parsed.actions ?? []).filter((a) => !a.thirdParty);

  return {
    themes: parsed.themes ?? [],
    actions: ownedActions
      .slice(0, 4)
      .sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency])
      .map((a) => ({ text: a.text, count: a.count, urgency: a.urgency })),
  };
}

export async function classifyComments(
  comments: RawComment[]
): Promise<ClassificationResult> {
  console.log(`[STAGE 3] Sent to AI classification: ${comments.length}`);

  const client = getClient();

  const batches: RawComment[][] = [];
  for (let i = 0; i < comments.length; i += BATCH_SIZE) {
    batches.push(comments.slice(i, i + BATCH_SIZE));
  }

  // Run batches concurrently instead of one-at-a-time, but cap how many
  // run at once so we don't slam NVIDIA's shared free tier with a burst
  // of simultaneous requests (which risks throttling/errors of its own).
  const CONCURRENCY = 3;
  const classified: ClassifiedComment[] = [];
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = batches.slice(i, i + CONCURRENCY);
    const groupResults = await Promise.all(
      group.map((batch) => classifyBatch(client, batch))
    );
    classified.push(...groupResults.flat());
  }

  console.log(
    `[STAGE 4] Total: sent ${comments.length}, AI accounted for ${classified.length} across ${batches.length} batch(es)`
  );

  const sentimentBreakdown: Record<Sentiment, number> = {
    positive: 0,
    negative: 0,
    neutral: 0,
  };
  let spamCount = 0;
  for (const c of classified) {
    if (c.isSpam) {
      spamCount += 1;
    } else {
      sentimentBreakdown[c.sentiment] += 1;
    }
  }

  const { themes, actions } = classified.length
    ? await clusterThemes(client, classified)
    : { themes: [], actions: [] };

  return {
    totalComments: classified.length,
    sentimentBreakdown,
    spamCount,
    themes,
    actions,
    comments: classified,
  };
}
