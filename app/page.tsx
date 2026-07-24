"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Sentiment = "positive" | "negative" | "neutral";
type LogFilter = Sentiment | "spam" | null;

interface ThemeCluster {
  theme: string;
  count: number;
  exampleQuotes: string[];
}

interface ClassifiedComment {
  id: string;
  text: string;
  sentiment: Sentiment;
  isSpam: boolean;
}

interface AnalyzeResult {
  platform: string;
  totalComments: number;
  sentimentBreakdown: Record<Sentiment, number>;
  spamCount: number;
  themes: ThemeCluster[];
  summary: string;
  truncated: boolean;
  comments: ClassifiedComment[];
}

interface ManualPrompt {
  platform: "instagram" | "tiktok";
}

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  positive: "POSITIVE",
  neutral: "NEUTRAL",
  negative: "NEGATIVE",
};

const SENTIMENT_VAR: Record<Sentiment, string> = {
  positive: "var(--positive)",
  neutral: "var(--neutral)",
  negative: "var(--negative)",
};

const PROGRESS_PHASES: Array<{ afterSeconds: number; label: string }> = [
  { afterSeconds: 0, label: "ESTABLISHING UPLINK" },
  { afterSeconds: 8, label: "SORTING SIGNAL FROM NOISE" },
  { afterSeconds: 90, label: "MAPPING CLUSTERS" },
];

function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return seconds;
}

function ThemeCard({
  theme,
  active,
  onToggle,
}: {
  theme: ThemeCluster;
  active: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  function handleMouseMove(e: React.MouseEvent<HTMLButtonElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--ry", `${px * 8}deg`);
    el.style.setProperty("--rx", `${-py * 8}deg`);
  }

  function handleMouseLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--rx", "0deg");
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="group relative flex flex-col gap-2 border p-4 text-left transition-[border-color,box-shadow] duration-200"
      style={{
        borderColor: active ? "var(--signal)" : "var(--line)",
        clipPath: "polygon(0 0, 100% 0, 100% 100%, 14px 100%, 0 calc(100% - 14px))",
        transform:
          "perspective(700px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))",
        transformStyle: "preserve-3d",
        boxShadow: active ? "0 0 0 1px var(--signal)" : "none",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-lg leading-none tracking-wide text-paper">
          {theme.theme.toUpperCase()}
        </span>
        <span className="shrink-0 font-mono text-xs text-dim">
          ~{theme.count}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {theme.exampleQuotes.map((q, i) => (
          <li key={i} className="text-sm italic text-dim">
            &ldquo;{q}&rdquo;
          </li>
        ))}
      </ul>
      <span className="mt-1 font-mono text-[10px] tracking-widest text-dim opacity-0 transition-opacity group-hover:opacity-100">
        {active ? "CLICK TO CLEAR" : "CLICK TO LOCATE IN LOG"}
      </span>
    </button>
  );
}

export default function Home() {
  const [link, setLink] = useState("");
  const [pastedComments, setPastedComments] = useState("");
  const [manual, setManual] = useState<ManualPrompt | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [logFilter, setLogFilter] = useState<LogFilter>(null);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const elapsedSeconds = useElapsedSeconds(loading);
  const logRef = useRef<HTMLDivElement>(null);

  async function runAnalysis(body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    setResult(null);
    setLogFilter(null);
    setActiveTheme(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.requiresManualPaste) {
          setManual({ platform: data.platform });
        } else {
          setError(data.error ?? "Something went wrong.");
        }
        return;
      }

      setManual(null);
      setResult(data);
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setLoading(false);
    }
  }

  function handleLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim()) return;
    runAnalysis({ link: link.trim() });
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manual || !pastedComments.trim()) return;
    runAnalysis({ platform: manual.platform, pastedComments });
  }

  function toggleSentimentFilter(next: LogFilter) {
    setLogFilter((current) => (current === next ? null : next));
  }

  function toggleTheme(theme: ThemeCluster) {
    const isSame = activeTheme === theme.theme;
    setActiveTheme(isSame ? null : theme.theme);
    if (!isSame) {
      requestAnimationFrame(() => {
        const el = logRef.current?.querySelector(
          `[data-quote="true"]`
        );
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }

  const activeQuotes = useMemo(() => {
    if (!activeTheme || !result) return null;
    const theme = result.themes.find((t) => t.theme === activeTheme);
    return theme ? new Set(theme.exampleQuotes) : null;
  }, [activeTheme, result]);

  const currentPhase = PROGRESS_PHASES.filter(
    (p) => elapsedSeconds >= p.afterSeconds
  ).at(-1);

  const total = result
    ? result.sentimentBreakdown.positive +
      result.sentimentBreakdown.neutral +
      result.sentimentBreakdown.negative
    : 0;

  const visibleComments =
    result?.comments.filter((c) => {
      if (!logFilter) return true;
      if (logFilter === "spam") return c.isSpam;
      return !c.isSpam && c.sentiment === logFilter;
    }) ?? [];

  return (
    <div className="relative z-10 min-h-screen">
      <span
        aria-hidden="true"
        className="vertical-label pointer-events-none fixed left-4 top-1/2 hidden -translate-y-1/2 font-mono text-[10px] text-dim/60 lg:block"
      >
        SIGNAL · NOISE · SIGNAL · NOISE · SIGNAL · NOISE
      </span>
      <span
        aria-hidden="true"
        className="vertical-label pointer-events-none fixed right-4 top-1/2 hidden -translate-y-1/2 font-mono text-[10px] text-dim/60 lg:block"
      >
        COMMENT · INTELLIGENCE · COMMENT · INTELLIGENCE
      </span>

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 py-20 lg:px-0">
        <header className="flex flex-col gap-4">
          <p className="font-mono text-xs tracking-[0.3em] text-dim">
            TRANSMISSION SCANNER
          </p>
          <h1 className="font-display text-6xl leading-[0.85] tracking-tight text-paper sm:text-7xl">
            READ THE
            <br />
            <span className="text-signal">SIGNAL.</span>
          </h1>
          <p className="max-w-md text-base leading-7 text-dim">
            Paste a post link and we&apos;ll sort what people actually said
            from the noise — sentiment, recurring clusters, and the spam
            that doesn&apos;t count. X posts scan automatically; Instagram
            and TikTok need the comments pasted in.
          </p>
        </header>

        <form onSubmit={handleLinkSubmit} className="flex flex-col gap-2">
          <label
            htmlFor="link"
            className="font-mono text-[11px] tracking-[0.2em] text-dim"
          >
            POST LINK
          </label>
          <div className="flex gap-2">
            <input
              id="link"
              type="url"
              required
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://x.com/user/status/..."
              className="flex-1 border border-line bg-void/60 px-3 py-3 font-mono text-sm text-paper outline-none transition-colors focus:border-signal"
            />
            <button
              type="submit"
              disabled={loading}
              className="border border-paper px-5 py-3 font-mono text-xs tracking-[0.2em] text-paper transition-all hover:border-signal hover:bg-signal hover:text-void disabled:opacity-40"
            >
              {loading ? "SCANNING" : "SCAN →"}
            </button>
          </div>
        </form>

        {manual && (
          <form
            onSubmit={handleManualSubmit}
            className="flex flex-col gap-3 border border-dashed border-signal/60 p-4"
          >
            <p className="font-mono text-xs leading-6 text-dim">
              <span className="text-signal">
                MANUAL INPUT — {manual.platform.toUpperCase()}
              </span>
              <br />
              This platform can&apos;t be scanned automatically. Copy the
              comment text from the post — one comment per line — and
              paste it below.
            </p>
            <textarea
              required
              rows={8}
              value={pastedComments}
              onChange={(e) => setPastedComments(e.target.value)}
              placeholder={"Great post!\nWhy is this so expensive?\n..."}
              className="border border-line bg-void/60 px-3 py-2 font-mono text-sm text-paper outline-none transition-colors focus:border-signal"
            />
            <button
              type="submit"
              disabled={loading}
              className="self-start border border-paper px-5 py-3 font-mono text-xs tracking-[0.2em] text-paper transition-all hover:border-signal hover:bg-signal hover:text-void disabled:opacity-40"
            >
              {loading ? "SCANNING" : "SCAN PASTED TEXT →"}
            </button>
          </form>
        )}

        {loading && (
          <div className="flex flex-col gap-3 border border-line p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-mono text-xs tracking-[0.2em] text-paper">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-signal"
                  style={{ animation: "pulse-dot 1.2s ease-in-out infinite" }}
                />
                {currentPhase?.label ?? "WORKING"}
              </span>
              <span className="font-mono text-xs tabular-nums text-dim">
                {String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:
                {String(elapsedSeconds % 60).padStart(2, "0")}
              </span>
            </div>
            <div className="relative h-px w-full overflow-hidden bg-line">
              <div
                className="absolute inset-y-0 w-1/4"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, var(--signal), transparent)",
                  animation: "scanline 1.6s ease-in-out infinite",
                }}
              />
            </div>
            <p className="font-mono text-[11px] leading-5 text-dim">
              Larger threads can take a few minutes on the current
              endpoint. This updates the moment it&apos;s done.
            </p>
          </div>
        )}

        {error && (
          <div className="border border-negative/60 p-4">
            <p className="font-mono text-xs tracking-[0.2em] text-negative">
              SCAN FAILED
            </p>
            <p className="mt-1 text-sm text-dim">{error}</p>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-10">
            {result.truncated && (
              <p className="border border-signal/50 px-3 py-2 font-mono text-xs text-signal">
                PARTIAL SCAN — showing results for the first{" "}
                {result.totalComments} comments found.
              </p>
            )}

            <section className="flex flex-col gap-2">
              <p className="font-mono text-[11px] tracking-[0.2em] text-dim">
                READOUT
              </p>
              <p className="text-lg leading-8 text-paper">{result.summary}</p>
            </section>

            <section className="flex flex-col gap-3">
              <p className="font-mono text-[11px] tracking-[0.2em] text-dim">
                SIGNAL COMPOSITION — {total} GENUINE / {result.spamCount} NOISE
              </p>
              <div className="flex h-8 w-full gap-0.5">
                {(["positive", "neutral", "negative"] as Sentiment[]).map(
                  (s) => {
                    const count = result.sentimentBreakdown[s];
                    const pct = total ? (count / total) * 100 : 0;
                    const isActive = logFilter === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleSentimentFilter(s)}
                        title={`${SENTIMENT_LABEL[s]}: ${count}`}
                        style={{
                          width: `${pct}%`,
                          backgroundColor: SENTIMENT_VAR[s],
                          opacity: !logFilter || isActive ? 1 : 0.35,
                          outline: isActive
                            ? "2px solid var(--paper)"
                            : "none",
                          outlineOffset: "-2px",
                        }}
                        className="min-w-[3px] transition-all duration-150 hover:brightness-125"
                      />
                    );
                  }
                )}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {(["positive", "neutral", "negative"] as Sentiment[]).map(
                  (s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSentimentFilter(s)}
                      className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-dim transition-colors hover:text-paper"
                    >
                      <span
                        className="h-2 w-2"
                        style={{ backgroundColor: SENTIMENT_VAR[s] }}
                      />
                      {SENTIMENT_LABEL[s]} ({result.sentimentBreakdown[s]})
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => toggleSentimentFilter("spam")}
                  className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-dim transition-colors hover:text-paper"
                >
                  <span className="h-2 w-2 border border-dim" />
                  NOISE ({result.spamCount})
                </button>
              </div>
            </section>

            {result.themes.length > 0 && (
              <section className="flex flex-col gap-3">
                <p className="font-mono text-[11px] tracking-[0.2em] text-dim">
                  CLUSTERS
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {result.themes.map((theme) => (
                    <ThemeCard
                      key={theme.theme}
                      theme={theme}
                      active={activeTheme === theme.theme}
                      onToggle={() => toggleTheme(theme)}
                    />
                  ))}
                </div>
              </section>
            )}

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] tracking-[0.2em] text-dim">
                  TRANSMISSION LOG
                </p>
                {(logFilter || activeTheme) && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogFilter(null);
                      setActiveTheme(null);
                    }}
                    className="font-mono text-[11px] tracking-wide text-signal hover:underline"
                  >
                    CLEAR FILTER
                  </button>
                )}
              </div>
              <div
                ref={logRef}
                className="flex max-h-96 flex-col gap-0 overflow-y-auto border border-line"
              >
                {visibleComments.length === 0 && (
                  <p className="p-4 font-mono text-xs text-dim">
                    No transmissions match this filter.
                  </p>
                )}
                {visibleComments.map((c) => {
                  const isHighlighted = activeQuotes?.has(c.text) ?? false;
                  return (
                    <div
                      key={c.id}
                      data-quote={isHighlighted ? "true" : undefined}
                      className="flex gap-3 border-b border-line px-3 py-2.5 text-sm transition-colors last:border-b-0"
                      style={{
                        borderLeft: `2px solid ${
                          c.isSpam ? "var(--dim)" : SENTIMENT_VAR[c.sentiment]
                        }`,
                        backgroundColor: isHighlighted
                          ? "rgba(255,47,109,0.08)"
                          : "transparent",
                      }}
                    >
                      <span
                        className={
                          c.isSpam
                            ? "line-through decoration-dim/60 text-dim"
                            : "text-paper"
                        }
                      >
                        {c.text}
                      </span>
                      {c.isSpam && (
                        <span className="ml-auto shrink-0 font-mono text-[10px] tracking-widest text-dim">
                          NOISE
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
