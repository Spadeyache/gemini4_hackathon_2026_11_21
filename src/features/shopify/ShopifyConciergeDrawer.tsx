import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Layers,
  Loader2,
  Minus,
  Plus,
  Send,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  GarmentAssetSet,
  InventedProductSpec,
  ProductCategory3D,
  ProductPlacementZone,
  StoreConfig,
} from '../../types/storeConfig';

export interface ShopifyConciergeDrawerProps {
  config: StoreConfig;
  focusedProductId?: string | null;
  onFocusProduct?: (productId: string) => void;
}

interface ComparableShopifyItem {
  id: string;
  title: string;
  vendor: string;
  storeDomain: string;
  price: number;
  currency: string;
  productType: string;
  productUrl: string;
  imageUrl?: string;
  variantId?: string;
  matchedForProductId?: string;
  matchedCategory?: ProductCategory3D;
  wholesaleNote: string;
}

interface StorefrontCheckoutInfo {
  mode: 'live_storefront_api' | 'public_shopify_permalink' | 'shop_dev_draft_checkout';
  checkoutUrl: string;
  cartId?: string;
  lineCount: number;
  subtotal: number;
  currencyCode: string;
  graphqlQuery: string;
  note: string;
}

interface ShopifyChatApiResponse {
  reply: string;
  recommendedProductIds: string[];
  autoAddProductIds: string[];
  comparableProducts: ComparableShopifyItem[];
  checkout?: StorefrontCheckoutInfo;
  draftPublishPreview?: {
    readySkuCount: number;
    estimatedMarginPct: number;
    suggestedCollectionTitle: string;
  };
  usedGemini: boolean;
  usedLiveShopifyStorefront: boolean;
  modelUsed: string;
  error?: string;
}

interface PublishedProductRecord {
  localProductId: string;
  sku: string;
  title: string;
  category: ProductCategory3D;
  price: number;
  shopifyProductGid: string;
  shopifyVariantGid: string;
  handle: string;
  status: 'ACTIVE' | 'DRAFT_READY';
  storefrontPreviewUrl: string;
}

interface ShopifyPublishApiResponse {
  ok: boolean;
  mode: 'live_shopify_admin_graphql' | 'shop_dev_graphql_manifest';
  apiVersion: string;
  storeDomain: string;
  collectionTitle: string;
  collectionHandle: string;
  publishedProducts: PublishedProductRecord[];
  graphqlMutationPayload: string;
  graphqlVariablesJson: string;
  storefrontPreviewUrl: string;
  summaryMessage: string;
  syncedAt: string;
  error?: string;
}

interface ChatMessageEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  recommendedProductIds?: string[];
  comparableProducts?: ComparableShopifyItem[];
  checkout?: StorefrontCheckoutInfo;
  usedGemini?: boolean;
  usedLiveShopifyStorefront?: boolean;
}

type DrawerTab = 'chat' | 'catalog';

const QUICK_ACTION_CHIPS = [
  'Why were these products chosen?',
  'Build a starter bundle',
  'Find sourceable blanks/suppliers',
  'Checkout top hero item',
] as const;

const CATEGORY_LABELS: Record<ProductCategory3D, string> = {
  heavyweight_hoodie: 'Heavyweight Hoodie',
  structured_tshirt: 'Structured Tee',
  varsity_jacket: 'Outerwear / Knit',
  ceramic_mug: 'Ceramic Mug',
  structured_cap: 'Structured Cap',
  canvas_tote: 'Canvas Tote',
  hardcover_book: 'Hardcover Book',
  apothecary_bottle: 'Apothecary Vessel',
};

const PLACEMENT_LABELS: Record<ProductPlacementZone, string> = {
  hero_rack: 'Hero Stand',
  capsule_rack: 'Capsule Rail',
  center_table: 'Center Table',
  left_pedestal: 'Left Plinth',
  right_pedestal: 'Right Plinth',
};

function inferCategoryFromRackItem(item: GarmentAssetSet): ProductCategory3D {
  if (item.productSpec?.category) return item.productSpec.category;
  const hay = `${item.title} ${item.subtitle ?? ''}`.toLowerCase();
  if (/hoodie|sweatshirt|fleece|pullover/.test(hay)) return 'heavyweight_hoodie';
  if (/jacket|varsity|cardigan|coat|blazer|knit|layer/.test(hay)) return 'varsity_jacket';
  if (/mug|cup|tumbler|ceramic/.test(hay)) return 'ceramic_mug';
  if (/tote|bag|carry/.test(hay)) return 'canvas_tote';
  if (/cap|hat|beanie/.test(hay)) return 'structured_cap';
  if (/book|monograph|journal/.test(hay)) return 'hardcover_book';
  if (/bottle|fragrance|mist|vessel/.test(hay)) return 'apothecary_bottle';
  return 'structured_tshirt';
}

function buildUnifiedCatalog(config: StoreConfig): InventedProductSpec[] {
  const seen = new Set<string>();
  const items: InventedProductSpec[] = [];

  if (Array.isArray(config.products)) {
    for (const p of config.products) {
      if (!p || !p.id || seen.has(p.id)) continue;
      seen.add(p.id);
      items.push(p);
    }
  }

  for (let rIdx = 0; rIdx < (config.racks?.length ?? 0); rIdx++) {
    const rack = config.racks[rIdx];
    for (const g of rack.items ?? []) {
      if (!g || !g.id || seen.has(g.id)) continue;
      seen.add(g.id);
      if (g.productSpec) {
        items.push({ ...g.productSpec, id: g.id });
        continue;
      }
      const category = inferCategoryFromRackItem(g);
      items.push({
        id: g.id,
        sku: g.sku || `SKU-${items.length + 1}`,
        title: g.title,
        subtitle: g.subtitle || `${config.brandName} Capsule Piece`,
        category,
        placement: rIdx === 0 ? 'hero_rack' : 'capsule_rack',
        price: g.price,
        primaryColor: g.dominantHex || config.palette.wall || '#F2EEEB',
        secondaryColor: config.palette.plinth || '#E5DEC9',
        accentColor: config.palette.accent || '#547049',
        graphicHeadline: config.brandName.toUpperCase().slice(0, 22),
        graphicSubtext: config.tagline?.slice(0, 32),
        graphicMotif: 'monogram_crest',
        materialFinish:
          category === 'heavyweight_hoodie'
            ? 'brushed_fleece'
            : category === 'varsity_jacket'
              ? 'merino_knit'
              : 'combed_cotton',
        designRationale: `Synthesized from ${config.brandName}'s "${config.vibe}" identity, pairing ${config.palette.accent} accents with ${config.palette.wall} tonal fabric.`,
        featured: Boolean(g.featured),
      });
    }
  }

  return items;
}

function renderFormattedInline(line: string): React.ReactNode[] {
  const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return tokens.map((tok, idx) => {
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
      return (
        <strong key={idx} style={{ color: '#fbf9f3', fontWeight: 600 }}>
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
      return (
        <code
          key={idx}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            padding: '1px 4px',
            borderRadius: 4,
            background: 'rgba(255,255,255,0.09)',
            color: '#e7c96b',
          }}
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2) {
      return (
        <em key={idx} style={{ color: 'rgba(247,244,236,0.86)' }}>
          {tok.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{tok}</React.Fragment>;
  });
}

function FormattedConciergeMessage({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {paragraphs.map((block, pIdx) => {
        const lines = block.split('\n').filter((l) => l.trim().length > 0);
        return (
          <div key={pIdx} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {lines.map((line, lIdx) => (
              <div key={lIdx} style={{ lineHeight: 1.42 }}>
                {renderFormattedInline(line)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function ShopifyConciergeDrawer({
  config,
  focusedProductId,
  onFocusProduct,
}: ShopifyConciergeDrawerProps) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>('chat');

  const catalog = useMemo(() => buildUnifiedCatalog(config), [config]);
  const catalogById = useMemo(() => {
    const map = new Map<string, InventedProductSpec>();
    for (const item of catalog) {
      map.set(item.id, item);
    }
    return map;
  }, [catalog]);

  const [cartQuantities, setCartQuantities] = useState<Record<string, number>>({});
  const [messages, setMessages] = useState<ChatMessageEntry[]>([]);
  const [draftInput, setDraftInput] = useState<string>('');
  const [isSendingChat, setIsSendingChat] = useState<boolean>(false);

  const [latestCheckout, setLatestCheckout] = useState<StorefrontCheckoutInfo | null>(null);
  const [isCreatingCheckout, setIsCreatingCheckout] = useState<boolean>(false);
  const [expandedCheckoutMsgId, setExpandedCheckoutMsgId] = useState<string | null>(null);
  const [showCatalogCheckoutGraphql, setShowCatalogCheckoutGraphql] = useState<boolean>(false);

  const [publishResult, setPublishResult] = useState<ShopifyPublishApiResponse | null>(null);
  const [isPublishingLine, setIsPublishingLine] = useState<boolean>(false);
  const [showPublishGraphql, setShowPublishGraphql] = useState<boolean>(false);
  const [copiedGraphql, setCopiedGraphql] = useState<boolean>(false);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Reset brand-scoped conversation & sync state cleanly whenever a new brand world is loaded
  useEffect(() => {
    const heroItem = catalog.find((p) => p.featured) ?? catalog[0];
    setCartQuantities({});
    setLatestCheckout(null);
    setPublishResult(null);
    setShowPublishGraphql(false);
    setShowCatalogCheckoutGraphql(false);
    setMessages([
      {
        id: `welcome-${config.id}`,
        role: 'assistant',
        text: `Welcome to **${config.brandName}**. I synthesized **${catalog.length} sellable 3D products** tailored to *${config.vibe}* — anchored by **${
          heroItem?.title ?? 'our Flagship Piece'
        }** ($${heroItem?.price ?? 68}). Ask why each piece fits your brand, source real Shopify blanks, or build a checkout.`,
        recommendedProductIds: heroItem
          ? [heroItem.id, ...catalog.filter((p) => p.id !== heroItem.id).slice(0, 1).map((p) => p.id)]
          : [],
      },
    ]);
  }, [config.id, config.brandName, config.vibe, catalog]);

  useEffect(() => {
    if (isOpen && activeTab === 'chat' && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isSendingChat, isOpen, activeTab]);

  const totalBagCount = useMemo(
    () => Object.values(cartQuantities).reduce((sum, q) => sum + (q > 0 ? q : 0), 0),
    [cartQuantities]
  );

  const bagSubtotal = useMemo(() => {
    let sum = 0;
    for (const [pid, qty] of Object.entries(cartQuantities)) {
      if (qty <= 0) continue;
      const prod = catalogById.get(pid);
      if (prod) sum += prod.price * qty;
    }
    return Math.round(sum * 100) / 100;
  }, [cartQuantities, catalogById]);

  const addToBag = useCallback((productId: string, delta = 1) => {
    setCartQuantities((prev) => {
      const nextQty = Math.max(0, (prev[productId] ?? 0) + delta);
      const copy = { ...prev };
      if (nextQty === 0) {
        delete copy[productId];
      } else {
        copy[productId] = nextQty;
      }
      return copy;
    });
  }, []);

  const toggleInBag = useCallback((productId: string) => {
    setCartQuantities((prev) => {
      const copy = { ...prev };
      if ((copy[productId] ?? 0) > 0) {
        delete copy[productId];
      } else {
        copy[productId] = 1;
      }
      return copy;
    });
  }, []);

  const serializeCartItems = useCallback(
    (overrideMap?: Record<string, number>) => {
      const src = overrideMap ?? cartQuantities;
      return Object.entries(src)
        .filter(([, q]) => q > 0)
        .map(([productId, quantity]) => ({ productId, quantity }));
    },
    [cartQuantities]
  );

  const sendConciergePrompt = useCallback(
    async (rawPrompt: string) => {
      const trimmed = rawPrompt.trim();
      if (!trimmed || isSendingChat) return;

      const userMsg: ChatMessageEntry = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed,
      };

      const historyPayload = messages.slice(-5).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      setMessages((prev) => [...prev, userMsg]);
      setDraftInput('');
      setIsSendingChat(true);

      try {
        const res = await fetch('/api/shopify/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            storeConfig: config,
            cartItems: serializeCartItems(),
            history: historyPayload,
          }),
        });

        const data = (await res.json()) as ShopifyChatApiResponse;
        if (!res.ok || data.error) {
          throw new Error(data.error || `Concierge HTTP ${res.status}`);
        }

        if (Array.isArray(data.autoAddProductIds) && data.autoAddProductIds.length > 0) {
          setCartQuantities((prev) => {
            const copy = { ...prev };
            for (const pid of data.autoAddProductIds) {
              if (catalogById.has(pid) && !copy[pid]) {
                copy[pid] = 1;
              }
            }
            return copy;
          });
        }

        if (data.checkout) {
          setLatestCheckout(data.checkout);
        }

        const assistantMsg: ChatMessageEntry = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: data.reply,
          recommendedProductIds: data.recommendedProductIds,
          comparableProducts: data.comparableProducts,
          checkout: data.checkout,
          usedGemini: data.usedGemini,
          usedLiveShopifyStorefront: data.usedLiveShopifyStorefront,
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        const hero = catalog[0];
        setMessages((prev) => [
          ...prev,
          {
            id: `fallback-${Date.now()}`,
            role: 'assistant',
            text: `Here is our featured 3D capsule piece for **${config.brandName}**: **${
              hero?.title ?? 'Signature Edition'
            }** ($${hero?.price ?? 68}). (${
              err instanceof Error ? err.message : 'Offline preview mode'
            })`,
            recommendedProductIds: hero ? [hero.id] : [],
          },
        ]);
      } finally {
        setIsSendingChat(false);
      }
    },
    [isSendingChat, messages, config, serializeCartItems, catalogById, catalog]
  );

  const handleCreateCatalogCheckout = useCallback(async () => {
    if (isCreatingCheckout) return;
    setIsCreatingCheckout(true);

    let workingCart = { ...cartQuantities };
    if (Object.keys(workingCart).length === 0 && catalog[0]) {
      workingCart = { [catalog[0].id]: 1 };
      setCartQuantities(workingCart);
    }

    try {
      const res = await fetch('/api/shopify/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Create Shopify Storefront checkout for current bag',
          storeConfig: config,
          cartItems: serializeCartItems(workingCart),
          createCheckout: true,
        }),
      });
      const data = (await res.json()) as ShopifyChatApiResponse;
      if (data.checkout) {
        setLatestCheckout(data.checkout);
      }
    } catch {
      // No-op: retain existing state cleanly
    } finally {
      setIsCreatingCheckout(false);
    }
  }, [isCreatingCheckout, cartQuantities, catalog, config, serializeCartItems]);

  const handleSyncProductLine = useCallback(async () => {
    if (isPublishingLine) return;
    setIsPublishingLine(true);

    try {
      const res = await fetch('/api/shopify/publish-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeConfig: config }),
      });
      const data = (await res.json()) as ShopifyPublishApiResponse;
      if (res.ok && data.ok) {
        setPublishResult(data);
      }
    } catch {
      // Keep clean UI if network hiccups
    } finally {
      setIsPublishingLine(false);
    }
  }, [isPublishingLine, config]);

  const handleCopyGraphqlBundle = useCallback(() => {
    if (!publishResult) return;
    const combined = `${publishResult.graphqlMutationPayload}\n\n# Variables JSON:\n${publishResult.graphqlVariablesJson}`;
    navigator.clipboard?.writeText(combined).then(() => {
      setCopiedGraphql(true);
      window.setTimeout(() => setCopiedGraphql(false), 2000);
    });
  }, [publishResult]);

  const handleDownloadGraphqlBundle = useCallback(() => {
    if (!publishResult) return;
    const combined = `${publishResult.graphqlMutationPayload}\n\n# Variables JSON:\n${publishResult.graphqlVariablesJson}\n`;
    const blob = new Blob([combined], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${publishResult.collectionHandle}-shop-dev-sync.graphql`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [publishResult]);

  const focusedProduct = focusedProductId ? catalogById.get(focusedProductId) : undefined;

  return (
    <>
      {/* Open State: 340px-Wide Dark-Glass Architectural Commerce Drawer */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            right: 16,
            bottom: 64,
            width: 340,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: '72vh',
            zIndex: 32,
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(15, 16, 15, 0.90)',
            backdropFilter: 'blur(18px)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: 16,
            boxShadow: '0 20px 52px rgba(0, 0, 0, 0.55)',
            color: '#f5f2eb',
            overflow: 'hidden',
            fontSize: 12,
          }}
        >
          {/* Drawer Header */}
          <div
            style={{
              padding: '11px 13px 9px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.09)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              background:
                'linear-gradient(180deg, rgba(149, 191, 71, 0.08) 0%, rgba(212, 175, 55, 0.03) 100%)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 9.5,
                  letterSpacing: '0.13em',
                  textTransform: 'uppercase',
                  color: '#95bf47',
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#95bf47',
                    boxShadow: '0 0 8px rgba(149,191,71,0.75)',
                  }}
                />
                <span>SHOPIFY AI CONCIERGE · 2025-01</span>
              </div>
              <div
                style={{
                  fontFamily: "'Cormorant Garamond', Georgia, serif",
                  fontSize: 16.5,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  color: '#fbf9f3',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: 1,
                }}
              >
                {config.brandName} Merchandising
              </div>
            </div>

            <button
              onClick={() => setIsOpen(false)}
              title="Minimize Shopify Concierge"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                width: 26,
                height: 26,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'rgba(245,242,235,0.8)',
                flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>

          {/* 2 Clean Tabs: Concierge Chat | Catalog & Shopify Sync */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 4,
              padding: '6px 10px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(0, 0, 0, 0.22)',
            }}
          >
            <button
              onClick={() => setActiveTab('chat')}
              style={{
                border:
                  activeTab === 'chat'
                    ? '1px solid rgba(212, 175, 55, 0.65)'
                    : '1px solid transparent',
                background:
                  activeTab === 'chat' ? 'rgba(212, 175, 55, 0.17)' : 'transparent',
                color: activeTab === 'chat' ? '#fbf8f0' : 'rgba(245,242,235,0.66)',
                borderRadius: 8,
                padding: '6px 8px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              <Sparkles size={12} color={activeTab === 'chat' ? '#e7c96b' : 'currentColor'} />
              <span>Concierge Chat</span>
            </button>

            <button
              onClick={() => setActiveTab('catalog')}
              style={{
                border:
                  activeTab === 'catalog'
                    ? '1px solid rgba(149, 191, 71, 0.65)'
                    : '1px solid transparent',
                background:
                  activeTab === 'catalog' ? 'rgba(149, 191, 71, 0.16)' : 'transparent',
                color: activeTab === 'catalog' ? '#fbf8f0' : 'rgba(245,242,235,0.66)',
                borderRadius: 8,
                padding: '6px 8px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              <Layers size={12} color={activeTab === 'catalog' ? '#a8d45a' : 'currentColor'} />
              <span>
                Catalog & Sync ({totalBagCount > 0 ? `${totalBagCount} in Bag` : catalog.length})
              </span>
            </button>
          </div>

          {/* TAB 1: CONCIERGE CHAT */}
          {activeTab === 'chat' ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
              }}
            >
              {/* Quick Action Chips */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  padding: '7px 10px',
                  borderBottom: '1px solid rgba(255,255,255,0.07)',
                  background: 'rgba(255,255,255,0.02)',
                }}
              >
                {QUICK_ACTION_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    disabled={isSendingChat}
                    onClick={() => void sendConciergePrompt(chip)}
                    style={{
                      border: '1px solid rgba(255,255,255,0.13)',
                      background: 'rgba(255,255,255,0.05)',
                      color: 'rgba(247,244,236,0.88)',
                      borderRadius: 999,
                      padding: '3.5px 8px',
                      fontSize: 10.2,
                      fontWeight: 500,
                      cursor: isSendingChat ? 'default' : 'pointer',
                      opacity: isSendingChat ? 0.55 : 1,
                    }}
                  >
                    {chip}
                  </button>
                ))}
                {focusedProduct && (
                  <button
                    disabled={isSendingChat}
                    onClick={() =>
                      void sendConciergePrompt(
                        `Tell me about ${focusedProduct.title} and how to style or source it`
                      )
                    }
                    style={{
                      border: '1px solid rgba(212,175,55,0.45)',
                      background: 'rgba(212,175,55,0.12)',
                      color: '#f2d984',
                      borderRadius: 999,
                      padding: '3.5px 8px',
                      fontSize: 10.2,
                      fontWeight: 600,
                      cursor: isSendingChat ? 'default' : 'pointer',
                    }}
                  >
                    Ask about {focusedProduct.title.split(' ').slice(0, 3).join(' ')}
                  </button>
                )}
              </div>

              {/* Scrollable Messages Stream */}
              <div
                ref={chatScrollRef}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '10px 11px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {messages.map((msg) => {
                  const isUser = msg.role === 'user';
                  const recProducts = (msg.recommendedProductIds ?? [])
                    .map((pid) => catalogById.get(pid))
                    .filter((x): x is InventedProductSpec => Boolean(x));

                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isUser ? 'flex-end' : 'flex-start',
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          maxWidth: isUser ? '86%' : '100%',
                          padding: isUser ? '7px 10px' : '9px 11px',
                          borderRadius: isUser
                            ? '12px 12px 3px 12px'
                            : '12px 12px 12px 3px',
                          background: isUser
                            ? 'rgba(212, 175, 55, 0.22)'
                            : 'rgba(255, 255, 255, 0.055)',
                          border: isUser
                            ? '1px solid rgba(212, 175, 55, 0.42)'
                            : '1px solid rgba(255, 255, 255, 0.09)',
                          color: '#f5f2eb',
                          fontSize: 11.5,
                        }}
                      >
                        {!isUser && (msg.usedGemini || msg.usedLiveShopifyStorefront) && (
                          <div
                            style={{
                              display: 'flex',
                              gap: 5,
                              flexWrap: 'wrap',
                              marginBottom: 5,
                            }}
                          >
                            {msg.usedGemini && (
                              <span
                                style={{
                                  fontSize: 9,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background: 'rgba(212,175,55,0.18)',
                                  color: '#e7c96b',
                                  fontWeight: 600,
                                  letterSpacing: '0.05em',
                                }}
                              >
                                GEMINI 4 HYDROGEN
                              </span>
                            )}
                            {msg.usedLiveShopifyStorefront && (
                              <span
                                style={{
                                  fontSize: 9,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background: 'rgba(149,191,71,0.2)',
                                  color: '#b4e063',
                                  fontWeight: 600,
                                  letterSpacing: '0.05em',
                                }}
                              >
                                LIVE STOREFRONT API
                              </span>
                            )}
                          </div>
                        )}
                        <FormattedConciergeMessage text={msg.text} />
                      </div>

                      {/* Clickable 3D Product Recommendation Cards inside Chat Replies */}
                      {!isUser && recProducts.length > 0 && (
                        <div
                          style={{
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 5,
                          }}
                        >
                          {recProducts.map((prod) => {
                            const inBagQty = cartQuantities[prod.id] ?? 0;
                            const isFocused = focusedProductId === prod.id;
                            return (
                              <div
                                key={prod.id}
                                style={{
                                  padding: '7px 9px',
                                  borderRadius: 10,
                                  background: isFocused
                                    ? 'rgba(212, 175, 55, 0.13)'
                                    : 'rgba(255, 255, 255, 0.035)',
                                  border: isFocused
                                    ? '1px solid rgba(212, 175, 55, 0.55)'
                                    : '1px solid rgba(255, 255, 255, 0.1)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 6,
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 7,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 7,
                                      minWidth: 0,
                                    }}
                                  >
                                    <span
                                      style={{
                                        width: 16,
                                        height: 16,
                                        borderRadius: '50%',
                                        background: prod.primaryColor,
                                        border: `2px solid ${prod.accentColor}`,
                                        flexShrink: 0,
                                      }}
                                    />
                                    <div style={{ minWidth: 0 }}>
                                      <div
                                        style={{
                                          fontSize: 11.5,
                                          fontWeight: 600,
                                          color: '#fbf9f3',
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                        }}
                                      >
                                        {prod.title}
                                      </div>
                                      <div
                                        style={{
                                          fontSize: 9.8,
                                          color: 'rgba(245,242,235,0.62)',
                                        }}
                                      >
                                        {CATEGORY_LABELS[prod.category]} ·{' '}
                                        {PLACEMENT_LABELS[prod.placement]}
                                      </div>
                                    </div>
                                  </div>
                                  <div
                                    style={{
                                      fontFamily: "'JetBrains Mono', monospace",
                                      fontSize: 11.5,
                                      fontWeight: 600,
                                      color: '#e7c96b',
                                      flexShrink: 0,
                                    }}
                                  >
                                    ${prod.price}
                                  </div>
                                </div>

                                <div style={{ display: 'flex', gap: 5 }}>
                                  <button
                                    onClick={() => addToBag(prod.id, 1)}
                                    style={{
                                      flex: 1,
                                      border:
                                        inBagQty > 0
                                          ? '1px solid rgba(149, 191, 71, 0.7)'
                                          : '1px solid rgba(212, 175, 55, 0.55)',
                                      background:
                                        inBagQty > 0
                                          ? 'rgba(149, 191, 71, 0.22)'
                                          : 'rgba(212, 175, 55, 0.16)',
                                      color: '#fbf9f3',
                                      borderRadius: 6,
                                      padding: '4.5px 7px',
                                      fontSize: 10.5,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: 4,
                                    }}
                                  >
                                    <ShoppingBag size={11} />
                                    <span>
                                      {inBagQty > 0
                                        ? `In Bag (${inBagQty}) · +1 ($${prod.price})`
                                        : `+ Bag ($${prod.price})`}
                                    </span>
                                  </button>

                                  <button
                                    onClick={() => onFocusProduct?.(prod.id)}
                                    style={{
                                      border: '1px solid rgba(255,255,255,0.16)',
                                      background: isFocused
                                        ? 'rgba(212,175,55,0.24)'
                                        : 'rgba(255,255,255,0.06)',
                                      color: '#f5f2eb',
                                      borderRadius: 6,
                                      padding: '4.5px 8px',
                                      fontSize: 10.5,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    <Eye size={11} />
                                    <span>Focus in 3D</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Live Public Shopify Supplier / Blank Reference Cards */}
                      {!isUser &&
                        msg.comparableProducts &&
                        msg.comparableProducts.length > 0 && (
                          <div
                            style={{
                              width: '100%',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                              padding: '7px 8px',
                              borderRadius: 10,
                              background: 'rgba(149, 191, 71, 0.07)',
                              border: '1px solid rgba(149, 191, 71, 0.28)',
                            }}
                          >
                            <div
                              style={{
                                fontSize: 9.5,
                                fontWeight: 700,
                                letterSpacing: '0.09em',
                                textTransform: 'uppercase',
                                color: '#b4e063',
                              }}
                            >
                              Live Comparable Shopify Reference SKUs
                            </div>
                            {msg.comparableProducts.map((comp) => (
                              <a
                                key={comp.id}
                                href={comp.productUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  textDecoration: 'none',
                                  color: 'inherit',
                                  padding: '5px 7px',
                                  borderRadius: 7,
                                  background: 'rgba(0,0,0,0.28)',
                                  border: '1px solid rgba(255,255,255,0.08)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 2,
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 6,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 10.8,
                                      fontWeight: 600,
                                      color: '#fbf9f3',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {comp.title}
                                  </span>
                                  <span
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 3,
                                      fontSize: 10.2,
                                      color: '#b4e063',
                                      flexShrink: 0,
                                      fontWeight: 600,
                                    }}
                                  >
                                    ${comp.price}
                                    <ArrowUpRight size={11} />
                                  </span>
                                </div>
                                <div
                                  style={{
                                    fontSize: 9.8,
                                    color: 'rgba(245,242,235,0.68)',
                                    lineHeight: 1.3,
                                  }}
                                >
                                  {comp.vendor} ({comp.storeDomain}) · {comp.wholesaleNote}
                                </div>
                              </a>
                            ))}
                          </div>
                        )}

                      {/* Inline Storefront Checkout Card */}
                      {!isUser && msg.checkout && (
                        <div
                          style={{
                            width: '100%',
                            padding: '8px 9px',
                            borderRadius: 10,
                            background: 'rgba(149, 191, 71, 0.12)',
                            border: '1px solid rgba(149, 191, 71, 0.45)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: '0.07em',
                                textTransform: 'uppercase',
                                color: '#b8e467',
                              }}
                            >
                              Shopify Checkout Ready ({msg.checkout.lineCount} item
                              {msg.checkout.lineCount === 1 ? '' : 's'})
                            </span>
                            <span
                              style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#fbf9f3',
                              }}
                            >
                              ${msg.checkout.subtotal.toFixed(2)}
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: 5 }}>
                            <a
                              href={msg.checkout.checkoutUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                flex: 1,
                                textDecoration: 'none',
                                background: '#95bf47',
                                color: '#11160b',
                                borderRadius: 7,
                                padding: '6px 9px',
                                fontSize: 11,
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 5,
                              }}
                            >
                              <span>Open Shopify Checkout</span>
                              <ExternalLink size={11} />
                            </a>
                            <button
                              onClick={() =>
                                setExpandedCheckoutMsgId((cur) =>
                                  cur === msg.id ? null : msg.id
                                )
                              }
                              title="Inspect Shopify Storefront cartCreate GraphQL"
                              style={{
                                border: '1px solid rgba(255,255,255,0.18)',
                                background: 'rgba(0,0,0,0.32)',
                                color: '#f5f2eb',
                                borderRadius: 7,
                                padding: '6px 8px',
                                fontSize: 10.5,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <Code2 size={12} />
                            </button>
                          </div>

                          {expandedCheckoutMsgId === msg.id && (
                            <pre
                              style={{
                                margin: 0,
                                padding: 7,
                                borderRadius: 6,
                                background: 'rgba(0,0,0,0.55)',
                                color: '#cde89c',
                                fontSize: 9.5,
                                fontFamily: "'JetBrains Mono', monospace",
                                maxHeight: 130,
                                overflow: 'auto',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {msg.checkout.graphqlQuery}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {isSendingChat && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      fontSize: 11,
                      color: 'rgba(245,242,235,0.7)',
                      padding: '4px 2px',
                    }}
                  >
                    <Loader2 size={13} color="#d4af37" />
                    <span>Concierge querying 3D catalog & Shopify API...</span>
                  </div>
                )}
              </div>

              {/* Chat Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendConciergePrompt(draftInput);
                }}
                style={{
                  padding: '8px 10px',
                  borderTop: '1px solid rgba(255,255,255,0.09)',
                  display: 'flex',
                  gap: 6,
                  background: 'rgba(0,0,0,0.28)',
                }}
              >
                <input
                  type="text"
                  value={draftInput}
                  onChange={(e) => setDraftInput(e.target.value)}
                  placeholder="Ask about products, suppliers, or checkout..."
                  style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    borderRadius: 9,
                    padding: '7px 10px',
                    color: '#fbf9f3',
                    fontSize: 11.5,
                    outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={isSendingChat || !draftInput.trim()}
                  style={{
                    border: 'none',
                    borderRadius: 9,
                    padding: '0 11px',
                    background:
                      isSendingChat || !draftInput.trim()
                        ? 'rgba(212, 175, 55, 0.25)'
                        : '#d4af37',
                    color: '#161512',
                    cursor:
                      isSendingChat || !draftInput.trim() ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Send size={13} />
                </button>
              </form>
            </div>
          ) : (
            /* TAB 2: CATALOG & SHOPIFY SYNC (CART + PUBLISH) */
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
              }}
            >
              {/* Scrollable Invented 3D Product List + Sync Output */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '10px 11px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {catalog.map((prod) => {
                  const qty = cartQuantities[prod.id] ?? 0;
                  const isFocused = focusedProductId === prod.id;
                  return (
                    <div
                      key={prod.id}
                      style={{
                        padding: '9px 10px',
                        borderRadius: 11,
                        background: isFocused
                          ? 'rgba(212, 175, 55, 0.12)'
                          : 'rgba(255, 255, 255, 0.04)',
                        border: isFocused
                          ? '1px solid rgba(212, 175, 55, 0.55)'
                          : qty > 0
                            ? '1px solid rgba(149, 191, 71, 0.45)'
                            : '1px solid rgba(255, 255, 255, 0.09)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              flexWrap: 'wrap',
                              marginBottom: 3,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 9.2,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.07em',
                                padding: '1.5px 6px',
                                borderRadius: 4,
                                background: 'rgba(212, 175, 55, 0.16)',
                                color: '#e7c96b',
                              }}
                            >
                              {CATEGORY_LABELS[prod.category]}
                            </span>
                            <span
                              style={{
                                fontSize: 9.2,
                                color: 'rgba(245,242,235,0.55)',
                              }}
                            >
                              {PLACEMENT_LABELS[prod.placement]}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: '#fbf9f3',
                              lineHeight: 1.25,
                            }}
                          >
                            {prod.title}
                          </div>
                        </div>

                        <div
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 12.5,
                            fontWeight: 700,
                            color: '#e7c96b',
                            flexShrink: 0,
                          }}
                        >
                          ${prod.price}
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: 10.6,
                          color: 'rgba(245,242,235,0.73)',
                          lineHeight: 1.36,
                        }}
                      >
                        {prod.designRationale}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                          marginTop: 2,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span
                            title={`Primary ${prod.primaryColor} / Accent ${prod.accentColor}`}
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: '50%',
                              background: prod.primaryColor,
                              border: `2px solid ${prod.accentColor}`,
                            }}
                          />
                          <button
                            onClick={() => onFocusProduct?.(prod.id)}
                            style={{
                              border: '1px solid rgba(255,255,255,0.14)',
                              background: 'rgba(255,255,255,0.05)',
                              color: 'rgba(245,242,235,0.86)',
                              borderRadius: 6,
                              padding: '3.5px 7px',
                              fontSize: 10,
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Eye size={10} />
                            <span>Focus 3D</span>
                          </button>
                        </div>

                        {qty > 0 ? (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'rgba(149, 191, 71, 0.2)',
                              border: '1px solid rgba(149, 191, 71, 0.6)',
                              borderRadius: 7,
                              padding: '2px 4px',
                            }}
                          >
                            <button
                              onClick={() => addToBag(prod.id, -1)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#fbf9f3',
                                cursor: 'pointer',
                                padding: '2px 4px',
                                display: 'flex',
                                alignItems: 'center',
                              }}
                            >
                              <Minus size={11} />
                            </button>
                            <span
                              style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: 10.5,
                                fontWeight: 700,
                                minWidth: 16,
                                textAlign: 'center',
                              }}
                            >
                              {qty}
                            </span>
                            <button
                              onClick={() => addToBag(prod.id, 1)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#fbf9f3',
                                cursor: 'pointer',
                                padding: '2px 4px',
                                display: 'flex',
                                alignItems: 'center',
                              }}
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => toggleInBag(prod.id)}
                            style={{
                              border: '1px solid rgba(212, 175, 55, 0.5)',
                              background: 'rgba(212, 175, 55, 0.14)',
                              color: '#fbf9f3',
                              borderRadius: 7,
                              padding: '4px 9px',
                              fontSize: 10.5,
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Plus size={11} />
                            <span>+ Bag</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Live Storefront Checkout Result in Catalog Tab */}
                {latestCheckout && (
                  <div
                    style={{
                      padding: '9px 10px',
                      borderRadius: 10,
                      background: 'rgba(149, 191, 71, 0.12)',
                      border: '1px solid rgba(149, 191, 71, 0.45)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: '#c4ea7b' }}>
                      {latestCheckout.note}
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <a
                        href={latestCheckout.checkoutUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          flex: 1,
                          textDecoration: 'none',
                          background: '#95bf47',
                          color: '#11160b',
                          borderRadius: 7,
                          padding: '6px 9px',
                          fontSize: 11,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 5,
                        }}
                      >
                        <span>Launch Checkout (${latestCheckout.subtotal.toFixed(2)})</span>
                        <ExternalLink size={11} />
                      </a>
                      <button
                        onClick={() => setShowCatalogCheckoutGraphql((s) => !s)}
                        style={{
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: 'rgba(0,0,0,0.32)',
                          color: '#f5f2eb',
                          borderRadius: 7,
                          padding: '6px 8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <Code2 size={12} />
                      </button>
                    </div>
                    {showCatalogCheckoutGraphql && (
                      <pre
                        style={{
                          margin: 0,
                          padding: 7,
                          borderRadius: 6,
                          background: 'rgba(0,0,0,0.55)',
                          color: '#cde89c',
                          fontSize: 9.5,
                          fontFamily: "'JetBrains Mono', monospace",
                          maxHeight: 130,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {latestCheckout.graphqlQuery}
                      </pre>
                    )}
                  </div>
                )}

                {/* Live Shopify Admin / shop.dev Sync Result Card */}
                {publishResult && (
                  <div
                    style={{
                      padding: '9px 10px',
                      borderRadius: 11,
                      background: 'rgba(212, 175, 55, 0.09)',
                      border: '1px solid rgba(212, 175, 55, 0.42)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: '#e7c96b',
                        }}
                      >
                        {publishResult.mode === 'live_shopify_admin_graphql'
                          ? `LIVE ADMIN SYNCED (${publishResult.apiVersion})`
                          : `SHOP.DEV GRAPHQL READY (${publishResult.apiVersion})`}
                      </span>
                      <a
                        href={publishResult.storefrontPreviewUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 10,
                          color: '#b4e063',
                          textDecoration: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          fontWeight: 600,
                        }}
                      >
                        <span>Storefront</span>
                        <ArrowUpRight size={11} />
                      </a>
                    </div>

                    <div style={{ fontSize: 10.5, color: 'rgba(245,242,235,0.82)', lineHeight: 1.35 }}>
                      {publishResult.summaryMessage}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {publishResult.publishedProducts.map((rec) => (
                        <div
                          key={rec.localProductId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 6,
                            fontSize: 10,
                            padding: '3.5px 6px',
                            borderRadius: 5,
                            background: 'rgba(0,0,0,0.28)',
                          }}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: '#f5f2eb',
                            }}
                          >
                            {rec.title}
                          </span>
                          <span
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 9,
                              color: rec.status === 'ACTIVE' ? '#a8d45a' : '#e7c96b',
                              flexShrink: 0,
                            }}
                          >
                            {rec.status}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: 5 }}>
                      <button
                        onClick={handleCopyGraphqlBundle}
                        style={{
                          flex: 1,
                          border: '1px solid rgba(255,255,255,0.16)',
                          background: 'rgba(255,255,255,0.07)',
                          color: '#fbf9f3',
                          borderRadius: 6,
                          padding: '5px 7px',
                          fontSize: 10.2,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        {copiedGraphql ? <Check size={11} color="#a8d45a" /> : <Copy size={11} />}
                        <span>{copiedGraphql ? 'Copied GraphQL' : 'Copy GraphQL'}</span>
                      </button>

                      <button
                        onClick={handleDownloadGraphqlBundle}
                        style={{
                          flex: 1,
                          border: '1px solid rgba(255,255,255,0.16)',
                          background: 'rgba(255,255,255,0.07)',
                          color: '#fbf9f3',
                          borderRadius: 6,
                          padding: '5px 7px',
                          fontSize: 10.2,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                        }}
                      >
                        <Download size={11} />
                        <span>Download .graphql</span>
                      </button>
                    </div>

                    <button
                      onClick={() => setShowPublishGraphql((s) => !s)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'rgba(245,242,235,0.72)',
                        fontSize: 10.2,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '2px 0 0',
                      }}
                    >
                      <span>Inspect shop.dev productCreate Mutation & Variables</span>
                      {showPublishGraphql ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    {showPublishGraphql && (
                      <pre
                        style={{
                          margin: 0,
                          padding: 7,
                          borderRadius: 6,
                          background: 'rgba(0,0,0,0.58)',
                          color: '#f2d984',
                          fontSize: 9.2,
                          fontFamily: "'JetBrains Mono', monospace",
                          maxHeight: 150,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {`${publishResult.graphqlMutationPayload}\n\n${publishResult.graphqlVariablesJson}`}
                      </pre>
                    )}
                  </div>
                )}
              </div>

              {/* Sticky Commerce Subtotal, Checkout & Shopify Sync Footer */}
              <div
                style={{
                  padding: '9px 11px 10px',
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(0, 0, 0, 0.36)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 11.5,
                  }}
                >
                  <span style={{ color: 'rgba(245,242,235,0.75)' }}>
                    Bag Subtotal ({totalBagCount} item{totalBagCount === 1 ? '' : 's'})
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {totalBagCount > 0 && (
                      <button
                        onClick={() => setCartQuantities({})}
                        style={{
                          border: 'none',
                          background: 'none',
                          color: 'rgba(245,242,235,0.5)',
                          fontSize: 10,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        Clear
                      </button>
                    )}
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 700,
                        color: '#fbf9f3',
                      }}
                    >
                      ${bagSubtotal.toFixed(2)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => void handleCreateCatalogCheckout()}
                  disabled={isCreatingCheckout}
                  style={{
                    width: '100%',
                    border: '1px solid rgba(149, 191, 71, 0.75)',
                    background: 'rgba(149, 191, 71, 0.24)',
                    color: '#fbf9f3',
                    borderRadius: 8,
                    padding: '7px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: isCreatingCheckout ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <ShoppingBag size={12} color="#b4e063" />
                  <span>
                    {isCreatingCheckout
                      ? 'Creating Storefront Cart...'
                      : 'Create Shopify Checkout'}
                  </span>
                </button>

                <button
                  onClick={() => void handleSyncProductLine()}
                  disabled={isPublishingLine}
                  style={{
                    width: '100%',
                    border: '1px solid rgba(212, 175, 55, 0.6)',
                    background: 'rgba(212, 175, 55, 0.16)',
                    color: '#f5e29c',
                    borderRadius: 8,
                    padding: '6.5px 10px',
                    fontSize: 10.8,
                    fontWeight: 600,
                    cursor: isPublishingLine ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <Code2 size={12} color="#d4af37" />
                  <span>
                    {isPublishingLine
                      ? 'Syncing GraphQL Product Line...'
                      : 'Sync Product Line to Shopify (shop.dev)'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Default Closed / Toggle Pill in Bottom-Right Corner */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 31,
          border:
            totalBagCount > 0 || isOpen
              ? '1px solid rgba(149, 191, 71, 0.72)'
              : '1px solid rgba(255, 255, 255, 0.16)',
          background: isOpen
            ? 'rgba(22, 26, 20, 0.92)'
            : 'rgba(18, 18, 17, 0.86)',
          backdropFilter: 'blur(14px)',
          borderRadius: 999,
          padding: '8px 14px',
          color: '#f7f4ec',
          fontSize: 11.5,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          boxShadow: '0 10px 28px rgba(0, 0, 0, 0.42)',
          whiteSpace: 'nowrap',
        }}
      >
        <ShoppingBag size={13} color={totalBagCount > 0 ? '#a8d45a' : '#d4af37'} />
        <span>Shopify Concierge &amp; Bag ({totalBagCount})</span>
      </button>
    </>
  );
}

export default ShopifyConciergeDrawer;
