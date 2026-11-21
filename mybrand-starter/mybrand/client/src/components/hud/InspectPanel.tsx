import { useEffect, useState } from "react";
import type { BlurbIndex, Product } from "@mybrand/shared";

interface InspectPanelProps {
  product: Product | null;
  zoneId: string | null;
  activeBlurbIndex: BlurbIndex;
  imageUrl: string | null;
  inBag: boolean;
  onClose: () => void;
  onCheckoutClick: (product: Product, zoneId: string) => void;
  onToggleTestBag: (product: Product, zoneId: string) => void;
}

function formatPrice(price: string, currency: string): string {
  if (currency === "USD") return `$${price} USD`;
  return `${price} ${currency}`;
}

export function InspectPanel({
  product,
  zoneId,
  activeBlurbIndex,
  imageUrl,
  inBag,
  onClose,
  onCheckoutClick,
  onToggleTestBag,
}: InspectPanelProps) {
  const [blurbFlash, setBlurbFlash] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [imageUrl, product?.id]);

  useEffect(() => {
    if (!product) return;
    setBlurbFlash(true);
    const timer = window.setTimeout(() => setBlurbFlash(false), 750);
    return () => window.clearTimeout(timer);
  }, [product?.id, activeBlurbIndex]);

  useEffect(() => {
    if (!product) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [product, onClose]);

  if (!product) return null;

  const activeBlurb = product.blurbs[activeBlurbIndex] ?? product.blurbs[0];
  const resolvedZone = zoneId ?? product.zone_id;
  const checkoutUrl = product.shopify.checkout_url;

  return (
    <aside className="inspect-panel" role="dialog" aria-label={product.title}>
      <div className="inspect-header">
        <div className="inspect-badges">
          <span className={`tier-badge tier-${product.tier}`}>{product.tier}</span>
          <span className="kind-badge">{product.product_type}</span>
        </div>
        <button
          type="button"
          className="inspect-close"
          onClick={onClose}
          aria-label="Close product panel"
        >
          ✕
        </button>
      </div>

      {imageUrl && !imgFailed && (
        <div className="inspect-image-wrap">
          <img
            src={imageUrl}
            alt={product.title}
            className="inspect-image"
            onError={() => setImgFailed(true)}
          />
        </div>
      )}

      <div className="inspect-body">
        <h2 className="inspect-title">{product.title}</h2>
        <div className="inspect-price">
          {formatPrice(product.price, product.currency)}
        </div>

        <div className={`inspect-blurb ${blurbFlash ? "flash" : ""}`}>
          <div className="inspect-blurb-meta">
            Featured note · angle {activeBlurbIndex + 1}
          </div>
          <p>{activeBlurb}</p>
        </div>

        <p className="inspect-description">{product.description}</p>

        {product.options.length > 0 && (
          <div className="inspect-options">
            {product.options.map((opt) => (
              <div key={opt.name} className="inspect-option-row">
                <span className="inspect-option-name">{opt.name}</span>
                <div className="inspect-option-values">
                  {opt.values.map((val) => (
                    <span key={val} className="inspect-chip">
                      {val}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="inspect-actions">
        {checkoutUrl ? (
          <button
            type="button"
            className="inspect-primary-btn"
            onClick={() => onCheckoutClick(product, resolvedZone)}
          >
            Add to cart ↗
          </button>
        ) : (
          <>
            <button
              type="button"
              className="inspect-primary-btn disabled"
              disabled
            >
              Coming soon
            </button>
            <button
              type="button"
              className={`inspect-secondary-btn ${inBag ? "in-bag" : ""}`}
              onClick={() => onToggleTestBag(product, resolvedZone)}
            >
              {inBag
                ? "Remove from bag (demo event)"
                : "Test add to bag"}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
