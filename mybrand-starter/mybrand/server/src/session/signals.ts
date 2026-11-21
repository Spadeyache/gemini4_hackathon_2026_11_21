import type { BoutiqueEvent, SessionCatalogItem } from "@mybrand/shared";
import type { ComputedSignals, ModelSignalsPayload } from "./types";

const QUICK_EXIT_THRESHOLD_S = 3;
const RECENT_EVENTS_LIMIT = 20;
const ACTIVE_LOOK_GRACE_S = 1.5;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addCount(map: Record<string, number>, key: string, delta: number): void {
  map[key] = (map[key] ?? 0) + delta;
}

/**
 * Computes all §5 session signals purely from raw renderer events, catalog metadata, and nowS.
 */
export function computeSignals(
  events: readonly BoutiqueEvent[],
  catalog: readonly SessionCatalogItem[],
  nowS: number
): ComputedSignals {
  const productTags = new Map<string, readonly string[]>();
  for (const item of catalog) {
    productTags.set(item.id, item.tags);
  }

  const sorted = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.t - b.event.t || a.index - b.index)
    .map((entry) => entry.event);

  const dwellRaw: Record<string, number> = {};
  const lookRaw: Record<string, number> = {};
  const inspects: Record<string, number> = {};
  const inspectsByTag: Record<string, number> = {};
  const addToCart: Record<string, number> = {};
  const addToCartByTag: Record<string, number> = {};
  const removeFromCart: Record<string, number> = {};
  const removeFromCartByTag: Record<string, number> = {};
  const quickExits: Record<string, number> = {};

  let activeZone: { zone: string; enter_t: number } | null = null;
  let lastLook: {
    product_id: string;
    start_t: number;
    end_t: number;
    zone?: string;
  } | null = null;

  for (const event of sorted) {
    switch (event.type) {
      case "enter_zone": {
        if (!event.zone) break;
        if (activeZone && activeZone.zone !== event.zone) {
          const elapsed = Math.max(0, event.t - activeZone.enter_t);
          addCount(dwellRaw, activeZone.zone, elapsed);
          if (elapsed <= QUICK_EXIT_THRESHOLD_S) {
            addCount(quickExits, activeZone.zone, 1);
          }
          activeZone = { zone: event.zone, enter_t: event.t };
        } else if (!activeZone) {
          activeZone = { zone: event.zone, enter_t: event.t };
        }
        if (lastLook && lastLook.zone && lastLook.zone !== event.zone) {
          lastLook = null;
        }
        break;
      }

      case "exit_zone": {
        if (!event.zone) break;
        let duration = 0;
        if (event.ms !== undefined) {
          duration = event.ms / 1000;
        } else if (activeZone && activeZone.zone === event.zone) {
          duration = Math.max(0, event.t - activeZone.enter_t);
        }
        addCount(dwellRaw, event.zone, duration);
        if (duration <= QUICK_EXIT_THRESHOLD_S) {
          addCount(quickExits, event.zone, 1);
        }
        if (activeZone && activeZone.zone === event.zone) {
          activeZone = null;
        }
        lastLook = null;
        break;
      }

      case "look": {
        if (!event.product_id) break;
        const durationS = (event.ms ?? 0) / 1000;
        addCount(lookRaw, event.product_id, durationS);
        lastLook = {
          product_id: event.product_id,
          start_t: event.t,
          end_t: event.t + durationS,
          zone: event.zone,
        };
        break;
      }

      case "inspect": {
        lastLook = null;
        if (!event.product_id) break;
        addCount(inspects, event.product_id, 1);
        const tags = productTags.get(event.product_id) ?? [];
        for (const tag of tags) {
          addCount(inspectsByTag, tag, 1);
        }
        break;
      }

      case "add_to_cart": {
        lastLook = null;
        if (!event.product_id) break;
        addCount(addToCart, event.product_id, 1);
        const tags = productTags.get(event.product_id) ?? [];
        for (const tag of tags) {
          addCount(addToCartByTag, tag, 1);
        }
        break;
      }

      case "remove_from_cart": {
        lastLook = null;
        if (!event.product_id) break;
        addCount(removeFromCart, event.product_id, 1);
        const tags = productTags.get(event.product_id) ?? [];
        for (const tag of tags) {
          addCount(removeFromCartByTag, tag, 1);
        }
        break;
      }

      case "checkout_click": {
        lastLook = null;
        break;
      }
    }
  }

  if (activeZone) {
    const openElapsed = Math.max(0, nowS - activeZone.enter_t);
    addCount(dwellRaw, activeZone.zone, openElapsed);
  }

  const dwellS: Record<string, number> = {};
  for (const [zone, seconds] of Object.entries(dwellRaw)) {
    dwellS[zone] = round2(seconds);
  }

  const lookS: Record<string, number> = {};
  for (const [productId, seconds] of Object.entries(lookRaw)) {
    lookS[productId] = round2(seconds);
  }

  const currentLookProductId =
    lastLook !== null &&
    nowS >= lastLook.start_t &&
    nowS <= lastLook.end_t + ACTIVE_LOOK_GRACE_S
      ? lastLook.product_id
      : null;

  return {
    current_zone: activeZone?.zone ?? null,
    dwell_s: dwellS,
    look_s: lookS,
    inspects,
    inspects_by_tag: inspectsByTag,
    add_to_cart: addToCart,
    add_to_cart_by_tag: addToCartByTag,
    remove_from_cart: removeFromCart,
    remove_from_cart_by_tag: removeFromCartByTag,
    quick_exits: quickExits,
    recent_events: sorted.slice(-RECENT_EVENTS_LIMIT),
    current_look_product_id: currentLookProductId,
  };
}

export function toModelSignalsPayload(
  signals: ComputedSignals
): ModelSignalsPayload {
  return {
    current_zone: signals.current_zone,
    dwell_s: signals.dwell_s,
    look_s: signals.look_s,
    inspects: signals.inspects,
    inspects_by_tag: signals.inspects_by_tag,
    add_to_cart: signals.add_to_cart,
    add_to_cart_by_tag: signals.add_to_cart_by_tag,
    remove_from_cart: signals.remove_from_cart,
    remove_from_cart_by_tag: signals.remove_from_cart_by_tag,
    quick_exits: signals.quick_exits,
    recent_events: signals.recent_events,
  };
}
