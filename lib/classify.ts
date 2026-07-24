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

export interface ClassificationResult {
  totalComments: number;
  sentimentBreakdown: Record<Sentiment, number>;
  spamCount: number;
  themes: ThemeCluster[];
  summary: string;
  comments: ClassifiedComment[];
}

const MODEL = "deepseek-ai/deepseek-v4-pro";
const BATCH_SIZE = 50;

// NVIDIA's endpoint accepts this DeepSeek-specific field directly in the
// request body (the OpenAI Node SDK has no typed knowledge of it).
type NvidiaChatParams = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
  chat_template_kwargs?: { thinking: boolean };
};

function getClient(): OpenAI {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NVIDIA_API_KEY is not set. Add it to .env.local (see .env.example)."
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate.trim());
}

async function classifyBatch(
  client: OpenAI,
  batch: RawComment[]
): Promise<ClassifiedComment[]> {
  const payload = batch.map((c) => ({ id: c.id, text: c.text }));

  const params: NvidiaChatParams = {
    model: MODEL,
    max_tokens: 4096,
    temperature: 0,
    chat_template_kwargs: { thinking: false },
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
  const completion = await client.chat.completions.create(params);

  const text = completion.choices[0]?.message?.content ?? "";

  const parsed = extractJson(text) as Array<{
    id: string;
    sentiment: Sentiment;
    isSpam: boolean;
  }>;

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
): Promise<{ themes: ThemeCluster[]; summary: string }> {
  const genuine = comments.filter((c) => !c.isSpam).map((c) => c.text);
  // Cap the sample so the prompt stays a reasonable size on very large threads.
  const sample = genuine.slice(0, 300);

  const params: NvidiaChatParams = {
    model: MODEL,
    max_tokens: 2048,
    temperature: 0,
    chat_template_kwargs: { thinking: false },
    messages: [
      {
        role: "user",
        content:
          "These are genuine comments from one social media post. Identify the " +
          "3-6 most common themes/topics people are raising (e.g. praise, price " +
          "complaints, questions about X, confusion about Y). For each theme give " +
          "a short label, an approximate count of matching comments, and up to 2 " +
          "short example quotes pulled verbatim from the list. Then write a 2-3 " +
          "sentence overall summary of audience reaction.\n\n" +
          'Respond with ONLY JSON shaped like {"themes":[{"theme":"...","count":0,' +
          '"exampleQuotes":["..."]}],"summary":"..."}.\n\n' +
          JSON.stringify(sample),
      },
    ],
  };
  const completion = await client.chat.completions.create(params);

  const text = completion.choices[0]?.message?.content ?? "";

  return extractJson(text) as { themes: ThemeCluster[]; summary: string };
}

export async function classifyComments(
  comments: RawComment[]
): Promise<ClassificationResult> {
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

  const { themes, summary } = classified.length
    ? await clusterThemes(client, classified)
    : { themes: [], summary: "No comments to analyze." };

  return {
    totalComments: classified.length,
    sentimentBreakdown,
    spamCount,
    themes,
    summary,
    comments: classified,
  };
}
