import { useState } from "react";
import type { BrandRead } from "../../api/hostApi";

interface BrandReadCardProps {
  brandRead: BrandRead;
  onRequestTweak?: () => void;
}

const BRAND_READ_ROWS: Array<{
  key: keyof Pick<
    BrandRead,
    "positioning" | "audience" | "dynamic" | "strategy" | "voice" | "look"
  >;
  label: string;
}> = [
  { key: "positioning", label: "Positioning" },
  { key: "audience", label: "Audience" },
  { key: "dynamic", label: "Dynamic" },
  { key: "strategy", label: "Strategy" },
  { key: "voice", label: "Voice" },
  { key: "look", label: "Look" },
];

export function BrandReadCard({
  brandRead,
  onRequestTweak,
}: BrandReadCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const swatches = (brandRead.palette_hex ?? []).filter((c) =>
    /^#[0-9a-fA-F]{6}$/.test(c)
  );

  return (
    <section className="brand-read-card" aria-label="Brand Read">
      <div className="brand-read-header">
        <div>
          <div className="brand-read-kicker">Brand Read · Phase 1</div>
          <h2 className="brand-read-title">How the Boot agent reads your brand</h2>
        </div>

        <div className="brand-read-actions">
          {swatches.length > 0 && (
            <div className="brand-read-swatches" aria-label="Brand palette">
              {swatches.map((hex) => (
                <span
                  key={hex}
                  className="brand-swatch"
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))}
            </div>
          )}
          {onRequestTweak && (
            <button
              type="button"
              className="brand-read-btn"
              onClick={onRequestTweak}
            >
              Suggest tweak
            </button>
          )}
          <button
            type="button"
            className="brand-read-toggle"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-expanded={!collapsed}
          >
            {collapsed ? "Expand ▾" : "Hide ▴"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <dl className="brand-read-grid">
          {BRAND_READ_ROWS.map((row) => {
            const value = brandRead[row.key];
            if (!value) return null;
            return (
              <div key={row.key} className="brand-read-row">
                <dt>{row.label}</dt>
                <dd>{value}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
