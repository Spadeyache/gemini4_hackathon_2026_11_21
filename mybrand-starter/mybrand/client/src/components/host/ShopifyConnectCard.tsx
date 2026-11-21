import type { ReactNode } from "react";
import type {
  PendingQuestion,
  ShopifyResponsePayload,
} from "../../api/hostApi";

interface ShopifyConnectCardProps {
  question: PendingQuestion;
  submitting: boolean;
  onRespond: (payload: ShopifyResponsePayload) => Promise<boolean>;
  /**
   * M4 extension slot: renders the secure Shop Domain + Client ID + Client Secret
   * credentials form directly inside this card when M4 Shopify connect is enabled.
   */
  credentialsFormSlot?: ReactNode;
}

const DEFAULT_SCOPES = [
  "read_products",
  "write_products",
  "read_publications",
  "write_publications",
];

export function ShopifyConnectCard({
  question,
  submitting,
  onRespond,
  credentialsFormSlot,
}: ShopifyConnectCardProps) {
  const scopes =
    question.scopes && question.scopes.length > 0
      ? question.scopes
      : DEFAULT_SCOPES;

  const handleSkip = () => {
    void onRespond({ connected: false, skip: true });
  };

  return (
    <section
      className="shopify-connect-card"
      aria-label="Shopify connection request"
    >
      <div className="shopify-card-header">
        <span className="shopify-badge">Phase 5 · Shopify Sync</span>
        <h3>Connect your Shopify store</h3>
      </div>

      <p className="shopify-card-desc">
        {question.message ||
          "The Boot agent is ready to create DRAFT products, attach generated images, and generate live checkout links in your Shopify store."}
      </p>

      <div className="shopify-scopes-block">
        <div className="shopify-scopes-label">Requested Admin scopes</div>
        <div className="shopify-scopes-list">
          {scopes.map((scope) => (
            <code key={scope} className="shopify-scope-pill">
              {scope}
            </code>
          ))}
        </div>
      </div>

      {credentialsFormSlot ? (
        <div className="shopify-m4-slot">{credentialsFormSlot}</div>
      ) : (
        <div className="shopify-m3-notice">
          Direct Shopify credential sync unlocks in <strong>M4</strong>. Never
          paste API secrets into chat — you can skip for now and still walk your
          complete 3D boutique with &ldquo;Coming soon&rdquo; checkout buttons.
        </div>
      )}

      <div className="shopify-card-actions">
        <button
          type="button"
          className="primary-cta"
          disabled={submitting}
          onClick={handleSkip}
        >
          {submitting
            ? "Continuing without Shopify…"
            : "Skip Shopify for now (launch with 'Coming soon' items)"}
        </button>
      </div>
    </section>
  );
}
