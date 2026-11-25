"use client";

import { useEffect } from "react";

const LIGHT_TARGET_SELECTOR =
  ".card-surface, .uas-light-card, .uas-light-btn, .uas-light-tab, .uas-light-divider, .uas-light-heading, button.accent-bg, [data-uas-light]";

/**
 * Lightweight, GPU-friendly pointer-reactive spotlight sheen controller.
 * Activates exclusively on fine-pointer hover devices and respects prefers-reduced-motion.
 * Uses a single RAF-throttled listener without causing React re-renders.
 */
export function PointerLightController() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const canHover =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!canHover || reducedMotion) return;

    let rafId: number | null = null;
    let lastTarget: HTMLElement | null = null;
    let pendingEvent: { x: number; y: number; target: HTMLElement | null } | null = null;

    const clearTarget = (el: HTMLElement | null) => {
      if (!el) return;
      el.removeAttribute("data-uas-lit");
      el.style.removeProperty("--uas-ptr-x");
      el.style.removeProperty("--uas-ptr-y");
    };

    const flush = () => {
      rafId = null;
      if (!pendingEvent) return;
      const { x, y, target } = pendingEvent;
      pendingEvent = null;

      if (lastTarget && lastTarget !== target) {
        clearTarget(lastTarget);
      }

      if (target) {
        const rect = target.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const lx = Math.round(x - rect.left);
          const ly = Math.round(y - rect.top);
          target.style.setProperty("--uas-ptr-x", `${lx}px`);
          target.style.setProperty("--uas-ptr-y", `${ly}px`);
          target.setAttribute("data-uas-lit", "1");
          lastTarget = target;
          return;
        }
      }
      lastTarget = null;
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerType && ev.pointerType !== "mouse" && ev.pointerType !== "pen") {
        return;
      }
      const rawTarget = ev.target instanceof HTMLElement ? ev.target : null;
      const litEl = rawTarget ? (rawTarget.closest(LIGHT_TARGET_SELECTOR) as HTMLElement | null) : null;
      pendingEvent = { x: ev.clientX, y: ev.clientY, target: litEl };
      if (rafId === null) {
        rafId = window.requestAnimationFrame(flush);
      }
    };

    const onPointerLeave = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingEvent = null;
      clearTarget(lastTarget);
      lastTarget = null;
    };

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave, { passive: true });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      clearTarget(lastTarget);
    };
  }, []);

  return null;
}
