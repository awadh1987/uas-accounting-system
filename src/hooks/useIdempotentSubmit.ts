"use client";

import { useCallback, useRef, useState } from "react";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface UseIdempotentSubmitOptions<TResult> {
  onSuccess?: (result: TResult) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
}

export interface UseIdempotentSubmitReturn<TArgs extends unknown[], TResult> {
  isSubmitting: boolean;
  submit: (...args: TArgs) => Promise<TResult | undefined>;
  idempotencyKey: string;
  resetKey: () => void;
}

/**
 * Universal Frontend Double-Click & Double-Tap Submission Lock Hook:
 * - Locks primary action buttons during active submission (disabling repeated clicks).
 * - Issues and rotates unique `X-Idempotency-Key` UUIDs across submit attempts.
 * - Safely handles errors and resets loading states.
 */
export function useIdempotentSubmit<TArgs extends unknown[], TResult>(
  submitFn: (idempotencyKey: string, ...args: TArgs) => Promise<TResult>,
  options?: UseIdempotentSubmitOptions<TResult>
): UseIdempotentSubmitReturn<TArgs, TResult> {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => generateUuid());
  const activeKeyRef = useRef(idempotencyKey);
  activeKeyRef.current = idempotencyKey;

  const isLockedRef = useRef(false);

  const resetKey = useCallback(() => {
    const next = generateUuid();
    setIdempotencyKey(next);
    activeKeyRef.current = next;
  }, []);

  const submit = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      // Rapid double-click / double-tap prevention guard
      if (isLockedRef.current) {
        return undefined;
      }

      isLockedRef.current = true;
      setIsSubmitting(true);
      const currentKey = activeKeyRef.current;

      try {
        const result = await submitFn(currentKey, ...args);
        options?.onSuccess?.(result);
        // Rotate key for the next distinct submission
        resetKey();
        return result;
      } catch (err) {
        options?.onError?.(err);
        throw err;
      } finally {
        isLockedRef.current = false;
        setIsSubmitting(false);
        options?.onSettled?.();
      }
    },
    [submitFn, options, resetKey]
  );

  return {
    isSubmitting,
    submit,
    idempotencyKey,
    resetKey,
  };
}
