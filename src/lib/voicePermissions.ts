import type { NativeWindowLike } from "@/lib/nativeBridge";

export type MicPermissionState = "granted" | "denied" | "prompt" | "unavailable";

export interface VoiceDiagnosticStatus {
  permissionState: MicPermissionState;
  canRequest: boolean;
  isNativeAndroid: boolean;
  unusedAppRestrictionsEnabled: boolean;
  unusedAppStatusCode: number; // 0 = unknown/unavailable, 1 = disabled/whitelisted, 2+ = enabled/restricted
}

export interface NormalizedSpeechError {
  code: "not-allowed" | "no-speech" | "audio-capture" | "language-not-supported" | "network" | "aborted" | "unknown";
  messageAr: string;
  messageEn: string;
  shouldOpenSettings: boolean;
}

/**
 * Normalizes Web Speech API & native Android speech error codes in a language-independent way
 * (`ar-YE`, `ar-SA`, `en-US`, `en-GB`, etc.) so listening state never gets wedged.
 */
export function normalizeSpeechError(rawError?: string | null): NormalizedSpeechError {
  const err = String(rawError || "").trim().toLowerCase();

  if (
    err.includes("not-allowed") ||
    err.includes("permission") ||
    err.includes("service-not-allowed") ||
    err.includes("denied")
  ) {
    return {
      code: "not-allowed",
      messageAr:
        "⚠️ تم رفض إذن الميكروفون؛ اضغط «فتح إعدادات التطبيق» لمنح صلاحية الصوت أو استخدم الكتابة.",
      messageEn:
        "⚠️ Microphone permission denied; tap 'Open App Settings' to grant audio access or type manually.",
      shouldOpenSettings: true,
    };
  }

  if (err.includes("audio-capture") || err.includes("no-mic") || err.includes("hardware")) {
    return {
      code: "audio-capture",
      messageAr:
        "⚠️ تعذر الوصول إلى الميكروفون (قد يكون قيد الاستخدام من تطبيق آخر أو معطلاً).",
      messageEn:
        "⚠️ Audio capture failed (microphone may be in use by another app or unavailable).",
      shouldOpenSettings: true,
    };
  }

  if (err.includes("no-speech")) {
    return {
      code: "no-speech",
      messageAr: "لم يتم التقاط صوت واضح؛ اضغط رمز الميكروفون وتحدث مجدداً.",
      messageEn: "No speech detected; tap the microphone and speak again.",
      shouldOpenSettings: false,
    };
  }

  if (err.includes("language-not-supported") || err.includes("bad-grammar")) {
    return {
      code: "language-not-supported",
      messageAr: "⚠️ حزمة التعرف الصوتي لهذه اللهجة غير متوفرة؛ يتم التبديل التلقائي للهجة البديلة.",
      messageEn: "⚠️ Selected voice locale is unavailable on this engine; switching to fallback locale.",
      shouldOpenSettings: false,
    };
  }

  if (err.includes("network")) {
    return {
      code: "network",
      messageAr: "⚠️ تعذر الاتصال بخدمة التعرف الصوتي السحابية؛ يمكنك المتابعة بالكتابة النصية.",
      messageEn: "⚠️ Speech engine network error; you can continue with manual text input.",
      shouldOpenSettings: false,
    };
  }

  if (err.includes("aborted")) {
    return {
      code: "aborted",
      messageAr: "تم إيقاف الاستماع.",
      messageEn: "Listening stopped.",
      shouldOpenSettings: false,
    };
  }

  return {
    code: "unknown",
    messageAr: `⚠️ تعذر التعرف على الصوت (${err || "unknown"})؛ يمكنك المتابعة بالكتابة النصية.`,
    messageEn: `⚠️ Voice input interrupted (${err || "unknown"}); you can continue by typing.`,
    shouldOpenSettings: false,
  };
}

/**
 * Checks microphone permission and Android "Manage app if unused" auto-revoke status
 * independently of the active speech locale (`ar-YE`, `en-US`, `en-GB`).
 */
export async function checkMicrophoneDiagnostics(
  winOverride?: NativeWindowLike
): Promise<VoiceDiagnosticStatus> {
  const win: (NativeWindowLike & { UasAndroidNative?: Record<string, (...args: unknown[]) => unknown> }) | undefined =
    (winOverride as any) ?? (typeof window !== "undefined" ? (window as any) : undefined);

  const isNative = Boolean(win?.UasAndroidNative || win?.Capacitor?.isNativePlatform?.());

  if (win?.UasAndroidNative && typeof win.UasAndroidNative.checkMicrophonePermission === "function") {
    try {
      const raw = String(win.UasAndroidNative.checkMicrophonePermission());
      const parsed = JSON.parse(raw) as {
        granted?: boolean;
        unusedAppRestrictionsStatus?: number;
        unusedRestrictionsEnabled?: boolean;
      };
      const unusedCode = Number(parsed.unusedAppRestrictionsStatus ?? 0);
      return {
        permissionState: parsed.granted ? "granted" : "denied",
        canRequest: !parsed.granted,
        isNativeAndroid: true,
        unusedAppRestrictionsEnabled:
          Boolean(parsed.unusedRestrictionsEnabled) || unusedCode >= 2,
        unusedAppStatusCode: unusedCode,
      };
    } catch {
      // Fall through to Web Permissions API
    }
  }

  if (typeof navigator !== "undefined" && navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      return {
        permissionState:
          status.state === "granted"
            ? "granted"
            : status.state === "denied"
              ? "denied"
              : "prompt",
        canRequest: status.state !== "denied",
        isNativeAndroid: isNative,
        unusedAppRestrictionsEnabled: false,
        unusedAppStatusCode: 0,
      };
    } catch {
      // Some WebViews throw for PermissionName 'microphone'
    }
  }

  return {
    permissionState: "prompt",
    canRequest: true,
    isNativeAndroid: isNative,
    unusedAppRestrictionsEnabled: false,
    unusedAppStatusCode: 0,
  };
}

/**
 * Requests microphone runtime permission cleanly in a language-independent manner.
 */
export async function requestMicrophoneAccess(
  winOverride?: NativeWindowLike
): Promise<MicPermissionState> {
  const win: any =
    winOverride ?? (typeof window !== "undefined" ? (window as any) : undefined);

  if (win?.UasAndroidNative && typeof win.UasAndroidNative.requestMicrophonePermission === "function") {
    try {
      const granted = Boolean(win.UasAndroidNative.requestMicrophonePermission());
      if (granted) return "granted";
    } catch {
      // Fall through
    }
  }

  if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return "granted";
    } catch (err) {
      const name = err instanceof Error ? err.name.toLowerCase() : "";
      if (name.includes("notallowed") || name.includes("permission")) {
        return "denied";
      }
      return "unavailable";
    }
  }

  return "prompt";
}

export function openNativeAppSettings(winOverride?: NativeWindowLike): boolean {
  const win: any =
    winOverride ?? (typeof window !== "undefined" ? (window as any) : undefined);
  if (win?.UasAndroidNative && typeof win.UasAndroidNative.openAppSettings === "function") {
    try {
      return Boolean(win.UasAndroidNative.openAppSettings());
    } catch {
      return false;
    }
  }
  return false;
}

export function openUnusedAppRestrictionsSettings(winOverride?: NativeWindowLike): boolean {
  const win: any =
    winOverride ?? (typeof window !== "undefined" ? (window as any) : undefined);
  if (win?.UasAndroidNative && typeof win.UasAndroidNative.openUnusedAppSettings === "function") {
    try {
      return Boolean(win.UasAndroidNative.openUnusedAppSettings());
    } catch {
      return false;
    }
  }
  return openNativeAppSettings(winOverride);
}

/**
 * Merges consecutive or cumulative SpeechRecognition segments while eliminating
 * Android WebView / Chromium word repetition, prefix supersets, and suffix-prefix overlaps.
 */
export function mergeSpeechTranscriptSegments(segments: string[]): string {
  const mergedWords: string[] = [];

  for (const rawSeg of segments) {
    const clean = String(rawSeg || "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const words = clean.split(" ");

    if (mergedWords.length === 0) {
      // Collapse accidental immediate duplicate inside first phrase only if repeated whole half
      mergedWords.push(...words);
      continue;
    }

    // Check if the new segment starts with a suffix of existing mergedWords
    let overlap = 0;
    const maxCheck = Math.min(mergedWords.length, words.length);
    for (let k = maxCheck; k >= 1; k--) {
      let allMatch = true;
      for (let i = 0; i < k; i++) {
        if (mergedWords[mergedWords.length - k + i] !== words[i]) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        overlap = k;
        break;
      }
    }

    if (overlap > 0) {
      mergedWords.push(...words.slice(overlap));
    } else {
      // Also check if incoming cumulative phrase is a superset containing tail tokens
      const prevJoined = mergedWords.join(" ");
      if (clean.startsWith(prevJoined)) {
        const tail = clean.slice(prevJoined.length).trim();
        if (tail) mergedWords.push(...tail.split(" "));
      } else if (!prevJoined.endsWith(clean)) {
        // Avoid immediate single-word stuttering across rapid final chunks
        const dedupedWords =
          words[0] === mergedWords[mergedWords.length - 1] ? words.slice(1) : words;
        mergedWords.push(...dedupedWords);
      }
    }
  }

  return mergedWords.join(" ").trim();
}

/**
 * Accumulates finalized and interim speech recognition segments cleanly on top of any
 * preserved manual `baseDraft` text, eliminating duplicate words and flushing safely
 * without premature auto-submit.
 */
export function createSpeechTranscriptAccumulator() {
  let baseDraft = "";
  let finalText = "";
  let interimText = "";
  let flushed = false;

  const combineWithBase = (...parts: string[]): string => {
    const cleanSpoken = mergeSpeechTranscriptSegments(parts);
    return mergeSpeechTranscriptSegments([baseDraft, cleanSpoken].filter(Boolean));
  };

  return {
    ingestResults(results: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } }> | undefined) {
      if (!results) {
        return {
          finalText,
          interimText,
          combined: combineWithBase(finalText, interimText),
        };
      }
      const finalSegments: string[] = [];
      const interimSegments: string[] = [];
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        const txt = String(res?.[0]?.transcript || "").replace(/\s+/g, " ").trim();
        if (!txt) continue;
        if (res?.isFinal) {
          finalSegments.push(txt);
        } else {
          interimSegments.push(txt);
        }
      }
      if (finalSegments.length > 0) {
        finalText = mergeSpeechTranscriptSegments(finalSegments);
      }
      interimText = mergeSpeechTranscriptSegments(interimSegments);
      return {
        finalText,
        interimText,
        combined: combineWithBase(finalText, interimText),
      };
    },
    commitExternalFinal(spokenText: string): string {
      const clean = String(spokenText || "").replace(/\s+/g, " ").trim();
      if (clean) {
        finalText = mergeSpeechTranscriptSegments([finalText, clean].filter(Boolean));
      }
      interimText = "";
      return combineWithBase(finalText);
    },
    getCombined(): string {
      return combineWithBase(finalText, interimText);
    },
    flushOnStop(): string {
      if (flushed) return "";
      flushed = true;
      const committed = combineWithBase(finalText, interimText);
      finalText = "";
      interimText = "";
      return committed;
    },
    reset(nextBaseDraft = "") {
      baseDraft = String(nextBaseDraft || "").trim();
      finalText = "";
      interimText = "";
      flushed = false;
    },
  };
}
