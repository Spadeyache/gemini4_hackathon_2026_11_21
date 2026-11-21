import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  formatElapsedClock,
  formatPhaseLabel,
} from "../../state/bootJobReducer";
import { useBootJob } from "../../state/useBootJob";
import { MarkdownLite } from "../../utils/markdownLite";
import { BrandReadCard } from "./BrandReadCard";
import { BuildRail } from "./BuildRail";
import { ShopifyConnectCard } from "./ShopifyConnectCard";

interface HostWorkspacePageProps {
  bootId: string;
  onNavigate: (path: string) => void;
}

function formatMessageTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getStatusBadgeMeta(status: string): { label: string; tone: string } {
  switch (status) {
    case "running":
      return { label: "Running", tone: "running" };
    case "waiting_host":
      return { label: "Waiting for your reply", tone: "waiting" };
    case "waiting_shopify":
      return { label: "Shopify step", tone: "waiting" };
    case "completed":
      return { label: "Completed", tone: "completed" };
    case "failed":
      return { label: "Failed", tone: "failed" };
    default:
      return { label: status, tone: "running" };
  }
}

export function HostWorkspacePage({
  bootId,
  onNavigate,
}: HostWorkspacePageProps) {
  const {
    state,
    loading,
    notFound,
    loadError,
    submittingReply,
    submittingShopify,
    actionError,
    submitReply,
    submitShopify,
    refreshSnapshot,
  } = useBootJob(bootId);

  const [replyText, setReplyText] = useState("");
  const [heartbeatAgeSec, setHeartbeatAgeSec] = useState(0);

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const replyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Track seconds since last heartbeat/event so banner always confirms liveness
  useEffect(() => {
    const updateAge = () => {
      if (!state.lastHeartbeatAtMs) {
        setHeartbeatAgeSec(0);
        return;
      }
      setHeartbeatAgeSec(
        Math.max(0, Math.floor((Date.now() - state.lastHeartbeatAtMs) / 1000))
      );
    };
    updateAge();
    const timer = window.setInterval(updateAge, 1000);
    return () => window.clearInterval(timer);
  }, [state.lastHeartbeatAtMs]);

  // Smooth auto-scroll when new messages/prompts arrive (unless user scrolled up)
  useEffect(() => {
    if (stickToBottomRef.current) {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [state.messages.length, state.pendingQuestion?.id, state.status]);

  const handleThreadScroll = () => {
    const el = threadScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 96;
  };

  const handleOpenBoutique = () => {
    onNavigate(`/b/${encodeURIComponent(bootId)}`);
  };

  const handleSendReply = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed) return;
    const ok = await submitReply(trimmed);
    if (ok) {
      setReplyText("");
      stickToBottomRef.current = true;
    }
  };

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void handleSendReply(replyText);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSendReply(replyText);
    }
  };

  const handleRequestBrandReadTweak = () => {
    setReplyText((prev) =>
      prev.trim().length > 0 ? prev : "About the brand read: "
    );
    replyInputRef.current?.focus();
  };

  if (loading && !state.hydrated) {
    return (
      <main className="boutique-status-screen">
        <div className="status-card">
          <div className="status-eyebrow">MyBrand Host Studio</div>
          <h1>Connecting to {bootId}…</h1>
          <p>Loading Boot job snapshot and subscribing to live progress.</p>
        </div>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="boutique-status-screen">
        <div className="status-card">
          <div className="status-eyebrow">Boot Not Found</div>
          <h1>No boot job &ldquo;{bootId}&rdquo;</h1>
          <p>
            This boot ID doesn&apos;t exist on the server yet, or the server was
            restarted before artifacts were saved.
          </p>
          <div className="status-card-actions">
            <button
              type="button"
              className="primary-cta"
              onClick={() => onNavigate("/host")}
            >
              Start a new boot →
            </button>
            <button
              type="button"
              className="secondary-cta"
              onClick={() => onNavigate("/")}
            >
              ← Back to lobby
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (loadError && !state.hydrated) {
    return (
      <main className="boutique-status-screen">
        <div className="status-card">
          <div className="status-eyebrow">Connection Error</div>
          <h1>Could not load &ldquo;{bootId}&rdquo;</h1>
          <p className="status-error">{loadError}</p>
          <div className="status-card-actions">
            <button
              type="button"
              className="primary-cta"
              onClick={() => void refreshSnapshot()}
            >
              Retry
            </button>
            <button
              type="button"
              className="secondary-cta"
              onClick={() => onNavigate("/")}
            >
              ← Back to lobby
            </button>
          </div>
        </div>
      </main>
    );
  }

  const badge = getStatusBadgeMeta(state.status);
  const latestActivity =
    state.activities.length > 0
      ? state.activities[state.activities.length - 1]
      : null;

  const askHostPending =
    state.pendingQuestion?.kind === "ask_host" ? state.pendingQuestion : null;
  const shopifyPending =
    state.pendingQuestion?.kind === "request_shopify_connection"
      ? state.pendingQuestion
      : state.status === "waiting_shopify"
        ? {
            id: "shopify_fallback",
            kind: "request_shopify_connection" as const,
            message:
              "Connect your Shopify store to sync DRAFT products and checkout links, or skip for now.",
            scopes: [
              "read_products",
              "write_products",
              "read_publications",
              "write_publications",
            ],
          }
        : null;

  const latestMessage =
    state.messages.length > 0
      ? state.messages[state.messages.length - 1]
      : null;
  const askHostAlreadyInThread =
    askHostPending &&
    latestMessage?.role === "assistant" &&
    latestMessage.text.trim() === askHostPending.message.trim();

  const composerPlaceholder =
    state.status === "waiting_host"
      ? "Type your reply to the Boot agent… (Enter to send)"
      : state.status === "completed"
        ? "Ask for edits to voice, products, prices, look, or adaptation rules…"
        : "Send a note or brand tweak while the Boot agent builds…";

  return (
    <div className="workspace-shell">
      {/* Top Workspace Header */}
      <header className="workspace-header">
        <div className="workspace-header-left">
          <button
            type="button"
            className="ghost-nav-btn"
            onClick={() => onNavigate("/")}
          >
            ← Lobby
          </button>
          <div className="workspace-title-group">
            <div className="workspace-eyebrow">Host Studio · Boot Job</div>
            <h1 className="workspace-title">{state.bootId}</h1>
          </div>
        </div>

        <div className="workspace-header-right">
          <button
            type="button"
            className="ghost-nav-btn"
            onClick={() => onNavigate("/host")}
          >
            + New Boot
          </button>
          <button
            type="button"
            className={`primary-cta workspace-open-btn ${state.readyToOpen ? "ready-pulse" : ""}`}
            disabled={!state.readyToOpen}
            onClick={handleOpenBoutique}
            title={
              state.readyToOpen
                ? `Open /b/${bootId}`
                : "Enabled once all required boutique artifacts are saved"
            }
          >
            {state.readyToOpen ? "Open boutique →" : "Building boutique…"}
          </button>
        </div>
      </header>

      {/* Always-Alive Status, Phase & Heartbeat Banner */}
      <section className={`status-banner banner-${badge.tone}`} aria-live="polite">
        <div className="status-banner-primary">
          <span className={`status-live-dot dot-${badge.tone}`} />
          <div className="status-banner-copy">
            <div className="status-banner-row">
              <span className={`status-pill pill-${badge.tone}`}>
                {badge.label}
              </span>
              <strong className="status-phase">
                {formatPhaseLabel(state.phase)}
              </strong>
            </div>
            <div className="status-activity-line">
              {state.status === "running"
                ? latestActivity?.label ||
                  "Gemini 4 Carbon is working on your boutique…"
                : state.status === "waiting_host"
                  ? "Paused briefly for your input below."
                  : state.status === "waiting_shopify"
                    ? "Ready for Shopify sync — connect or skip below."
                    : state.status === "completed"
                      ? "Boot complete — walk your boutique or request edits anytime."
                      : state.error || "The Boot agent hit an error."}
            </div>
          </div>
        </div>

        <div className="status-banner-telemetry">
          <div className="telemetry-chip" title="Elapsed boot time">
            <span className="telemetry-label">Elapsed</span>
            <strong className="telemetry-value">
              {formatElapsedClock(state.elapsedSeconds)}
            </strong>
          </div>
          <div className="telemetry-chip" title="SSE stream & last update">
            <span className="telemetry-label">Stream</span>
            <strong
              className={`telemetry-value stream-${state.streamState}`}
            >
              {state.streamState === "live"
                ? state.lastHeartbeatAtMs
                  ? `Live · ${heartbeatAgeSec}s ago`
                  : "Live"
                : state.streamState === "reconnecting"
                  ? "Reconnecting…"
                  : "Connecting…"}
            </strong>
          </div>
        </div>
      </section>

      {state.error && (
        <div className="workspace-error-banner" role="alert">
          <strong>Boot Error:</strong> {state.error}
        </div>
      )}

      {/* Split Workspace: Interactive Chat + Right Live Build Rail */}
      <div className="workspace-grid">
        <main className="workspace-chat-col">
          {state.brandRead && (
            <BrandReadCard
              brandRead={state.brandRead}
              onRequestTweak={handleRequestBrandReadTweak}
            />
          )}

          {/* Chat Thread */}
          <section className="chat-panel" aria-label="Boot agent conversation">
            <div
              className="chat-thread"
              ref={threadScrollRef}
              onScroll={handleThreadScroll}
            >
              {state.messages.length === 0 ? (
                <div className="chat-empty-state">
                  <div className="thinking-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <p>
                    The Boot agent is reading your uploaded photos, links, and
                    voice samples. First questions or brand read will appear
                    here shortly.
                  </p>
                </div>
              ) : (
                state.messages.map((msg) => (
                  <article
                    key={msg.id}
                    className={`chat-bubble role-${msg.role}`}
                  >
                    <div className="chat-bubble-meta">
                      <span className="chat-role-label">
                        {msg.role === "assistant"
                          ? "MyBrand Boot Agent"
                          : msg.role === "host"
                            ? "You (Host)"
                            : "System"}
                      </span>
                      <span className="chat-time">
                        {formatMessageTime(msg.timestamp)}
                      </span>
                    </div>
                    <div className="chat-bubble-body">
                      {msg.role === "assistant" ? (
                        <MarkdownLite text={msg.text} />
                      ) : (
                        <p className="md-para">{msg.text}</p>
                      )}
                    </div>
                  </article>
                ))
              )}

              {/* Pending ask_host callout with quick-reply option chips */}
              {askHostPending && (
                <div className="pending-question-card">
                  <div className="pending-question-kicker">
                    Action needed · Reply to continue
                  </div>
                  {!askHostAlreadyInThread && askHostPending.message && (
                    <div className="pending-question-body">
                      <MarkdownLite text={askHostPending.message} />
                    </div>
                  )}
                  {askHostPending.options &&
                    askHostPending.options.length > 0 && (
                      <div className="quick-reply-chips">
                        {askHostPending.options.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            className="quick-reply-chip"
                            disabled={submittingReply}
                            onClick={() => void handleSendReply(opt)}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                </div>
              )}

              {/* Pending request_shopify_connection card */}
              {shopifyPending && (
                <ShopifyConnectCard
                  question={shopifyPending}
                  submitting={submittingShopify}
                  onRespond={submitShopify}
                />
              )}

              {/* Active thinking indicator during long Carbon turns */}
              {state.status === "running" && (
                <div className="chat-thinking-row">
                  <div className="thinking-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span>
                    {latestActivity?.label ||
                      "Gemini 4 Carbon is thinking — complex turns can take a minute or two…"}
                  </span>
                </div>
              )}

              <div ref={threadEndRef} />
            </div>

            {/* Reply Composer (always active for ask_host, mid-run tweaks, & post-boot edits) */}
            <form className="chat-composer" onSubmit={handleFormSubmit}>
              {actionError && (
                <div className="composer-error" role="alert">
                  {actionError}
                </div>
              )}
              <div className="composer-row">
                <textarea
                  ref={replyInputRef}
                  className="composer-input"
                  rows={2}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={composerPlaceholder}
                  disabled={submittingReply || state.status === "failed"}
                  aria-label="Message to Boot agent"
                />
                <button
                  type="submit"
                  className="primary-cta composer-send-btn"
                  disabled={
                    submittingReply ||
                    !replyText.trim() ||
                    state.status === "failed"
                  }
                >
                  {submittingReply ? "Sending…" : "Send"}
                </button>
              </div>
              <div className="composer-footnote">
                Enter to send · Shift+Enter for new line · You can answer
                questions, steer the Brand Read mid-run, or request edits after
                launch.
              </div>
            </form>
          </section>
        </main>

        <BuildRail
          bootId={bootId}
          status={state.status}
          artifacts={state.artifacts}
          assets={state.assets}
          activities={state.activities}
          readyToOpen={state.readyToOpen}
          onOpenBoutique={handleOpenBoutique}
        />
      </div>
    </div>
  );
}
