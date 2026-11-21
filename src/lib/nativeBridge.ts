/**
 * UAS Enterprise — Unified Native Shell Bridge (Windows Desktop UAS.exe & Capacitor Android APK)
 *
 * Centralizes:
 *   1. PDF / Voucher / Report Printing (`triggerNativePrint`)
 *      - Android APK: invokes native `android.print.PrintManager` via `window.UasAndroidNative.printCurrentPage`
 *        (or Capacitor Share fallback) so Android opens the system Save-as-PDF / Print dialog.
 *      - Windows Desktop: sets document title for clean default PDF filename and invokes `window.print()`.
 *   2. Binary File Export & Share (`exportOrShareBinaryFile` for Excel `.xlsx` & documents)
 *      - Android APK: writes binary file to Android Cache via `window.UasAndroidNative.shareBase64File`
 *        (or `@capacitor/filesystem` + `@capacitor/share`) and opens Android's native `FileProvider` Share chooser.
 *      - Windows Desktop: downloads immediately via `Blob` + `URL.createObjectURL` + `<a download>`.
 *   3. WhatsApp & External URL Launching (`openExternalOrWhatsApp` & `formatWhatsAppUrl`)
 *      - Android APK: launches outside the WebView via `Intent.ACTION_VIEW` (`window.UasAndroidNative.openExternalUrl`,
 *        `@capacitor/browser`, or `_system`) preventing `ERR_UNKNOWN_URL_SCHEME` and WebView navigation traps.
 *      - Windows Desktop: opens cleanly in the default system browser / WhatsApp Desktop.
 */

export interface NativeAndroidJsBridge {
  printCurrentPage?: (jobName: string) => boolean;
  shareBase64File?: (
    filename: string,
    mimeType: string,
    base64Data: string,
    title: string
  ) => boolean;
  openExternalUrl?: (url: string) => boolean;
  checkMicrophonePermission?: () => string;
  requestMicrophonePermission?: () => boolean;
  openAppSettings?: () => boolean;
  checkUnusedAppRestrictionsStatus?: () => number;
  openUnusedAppSettings?: () => boolean;
  checkNotificationPermission?: () => boolean;
  requestNotificationPermission?: () => boolean;
  registerNotificationChannels?: () => boolean;
  showLocalNotification?: (channelId: string, title: string, body: string) => boolean;
}

export interface NativeWindowLike {
  UasAndroidNative?: NativeAndroidJsBridge;
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: {
      Filesystem?: {
        writeFile?: (opts: {
          path: string;
          data: string;
          directory?: string;
        }) => Promise<{ uri: string }>;
      };
      Share?: {
        share?: (opts: {
          title?: string;
          text?: string;
          url?: string;
          dialogTitle?: string;
        }) => Promise<void>;
      };
      Browser?: {
        open?: (opts: { url: string }) => Promise<void>;
      };
    };
  };
  location?: { protocol?: string; hostname?: string };
  document?: Document;
  navigator?: Navigator;
  open?: (url?: string | URL, target?: string, features?: string) => Window | null;
  print?: () => void;
}

function getWin(winOverride?: NativeWindowLike): NativeWindowLike | undefined {
  if (winOverride) return winOverride;
  if (typeof window !== "undefined") return window as unknown as NativeWindowLike;
  return undefined;
}

export function isCapacitorNative(winOverride?: NativeWindowLike): boolean {
  const win = getWin(winOverride);
  if (!win) return false;
  if (win.UasAndroidNative) return true;
  if (win.Capacitor?.isNativePlatform?.()) return true;
  const proto = win.location?.protocol || "";
  if (proto === "capacitor:" || proto === "file:") return true;
  return false;
}

// ---------------------------------------------------------------------------
// WhatsApp Phone & URL Formatting + External Launcher
// ---------------------------------------------------------------------------

export function normalizeWhatsAppPhone(
  phone?: string | null,
  defaultCountryCode = "967"
): string {
  let digits = String(phone ?? "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  // 10-digit Yemeni mobile with leading 0 (e.g. 077xxxxxxx) -> 96777xxxxxxx
  if (digits.length === 10 && digits.startsWith("07")) {
    return `${defaultCountryCode}${digits.slice(1)}`;
  }
  // 9-digit Yemeni mobile starting with 7 (e.g. 77xxxxxxx, 78xxxxxxx, 73xxxxxxx, 71xxxxxxx, 70xxxxxxx)
  if (digits.length === 9 && digits.startsWith("7")) {
    return `${defaultCountryCode}${digits}`;
  }
  return digits;
}

export interface WhatsAppLinkOptions {
  phone?: string | null;
  text?: string | null;
  defaultCountryCode?: string;
}

export function formatWhatsAppUrl(
  input: string | WhatsAppLinkOptions
): string {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("whatsapp://") ||
      trimmed.startsWith("mailto:") ||
      trimmed.startsWith("tel:")
    ) {
      return trimmed;
    }
    return `https://wa.me/?text=${encodeURIComponent(trimmed)}`;
  }

  const cleanPhone = normalizeWhatsAppPhone(input.phone, input.defaultCountryCode ?? "967");
  const text = String(input.text ?? "").trim();
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return cleanPhone
    ? `https://wa.me/${cleanPhone}${query}`
    : `https://wa.me/${query}`;
}

export function openExternalOrWhatsApp(
  urlOrOpts: string | WhatsAppLinkOptions,
  winOverride?: NativeWindowLike
): {
  method:
    | "android_native_intent"
    | "capacitor_browser"
    | "capacitor_system_window"
    | "window_open";
  url: string;
  ok: boolean;
} {
  const url = formatWhatsAppUrl(urlOrOpts);
  const win = getWin(winOverride);
  if (!win) {
    return { method: "window_open", url, ok: false };
  }

  // 1. Native Android JavascriptInterface (MainActivity.java Intent.ACTION_VIEW)
  if (win.UasAndroidNative?.openExternalUrl) {
    try {
      const ok = win.UasAndroidNative.openExternalUrl(url);
      if (ok) {
        return { method: "android_native_intent", url, ok: true };
      }
    } catch {
      // fall through
    }
  }

  // 2. Capacitor Browser plugin if registered
  if (win.Capacitor?.Plugins?.Browser?.open) {
    try {
      void win.Capacitor.Plugins.Browser.open({ url });
      return { method: "capacitor_browser", url, ok: true };
    } catch {
      // fall through
    }
  }

  // 3. Capacitor native platform fallback (_system target)
  if (isCapacitorNative(win)) {
    try {
      win.open?.(url, "_system");
      return { method: "capacitor_system_window", url, ok: true };
    } catch {
      // fall through
    }
  }

  // 4. Windows Desktop / Web Browser
  try {
    const opened = win.open?.(url, "_blank", "noopener,noreferrer");
    if (!opened && win.document) {
      const a = win.document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.display = "none";
      win.document.body.appendChild(a);
      a.click();
      win.document.body.removeChild(a);
    }
    return { method: "window_open", url, ok: true };
  } catch {
    return { method: "window_open", url, ok: false };
  }
}

// ---------------------------------------------------------------------------
// Native Print / Save-as-PDF Bridge
// ---------------------------------------------------------------------------

export async function triggerNativePrint(
  options: { title?: string } = {},
  winOverride?: NativeWindowLike
): Promise<{
  method: "android_print_manager" | "capacitor_share_html" | "window_print";
  ok: boolean;
}> {
  const win = getWin(winOverride);
  const jobTitle = (options.title || "UAS-Accounting-Report").trim();
  if (!win) {
    return { method: "window_print", ok: false };
  }

  // 1. Native Android PrintManager via MainActivity.java JavascriptInterface
  if (win.UasAndroidNative?.printCurrentPage) {
    try {
      const ok = win.UasAndroidNative.printCurrentPage(jobTitle);
      if (ok) {
        return { method: "android_print_manager", ok: true };
      }
    } catch {
      // fall through
    }
  }

  // 2. Capacitor Share plugin fallback on mobile if PrintManager interface is absent
  if (isCapacitorNative(win) && win.Capacitor?.Plugins?.Share?.share) {
    try {
      await win.Capacitor.Plugins.Share.share({
        title: jobTitle,
        text: jobTitle,
        dialogTitle: jobTitle,
      });
      return { method: "capacitor_share_html", ok: true };
    } catch {
      // fall through
    }
  }

  // 3. Windows Desktop / Web Browser window.print() with clean title for PDF spooler
  try {
    const prevTitle = win.document?.title;
    if (win.document && jobTitle) {
      win.document.title = jobTitle;
    }
    win.print?.();
    if (win.document && prevTitle) {
      setTimeout(() => {
        if (win.document) win.document.title = prevTitle;
      }, 1200);
    }
    return { method: "window_print", ok: true };
  } catch {
    return { method: "window_print", ok: false };
  }
}

// ---------------------------------------------------------------------------
// Binary File Export & Native Share Bridge (Excel .xlsx & PDF/Vouchers)
// ---------------------------------------------------------------------------

export function bytesToBase64(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

export async function exportOrShareBinaryFile(
  options: {
    filename: string;
    mimeType: string;
    data: Uint8Array | ArrayBuffer;
    title?: string;
  },
  winOverride?: NativeWindowLike
): Promise<{
  method:
    | "android_native_share"
    | "capacitor_filesystem_share"
    | "web_share_api"
    | "blob_download";
  ok: boolean;
}> {
  const win = getWin(winOverride);
  const filename = (options.filename || "UAS_Export.xlsx").trim();
  const mimeType =
    options.mimeType ||
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const title = options.title || filename;
  const bytes =
    options.data instanceof Uint8Array
      ? options.data
      : new Uint8Array(options.data);

  // 1. Native Android FileProvider Share (MainActivity.java UasAndroidNative.shareBase64File)
  if (win?.UasAndroidNative?.shareBase64File) {
    try {
      const b64 = bytesToBase64(bytes);
      const ok = win.UasAndroidNative.shareBase64File(filename, mimeType, b64, title);
      if (ok) {
        return { method: "android_native_share", ok: true };
      }
    } catch {
      // fall through
    }
  }

  // 2. Capacitor @capacitor/filesystem + @capacitor/share plugins (if installed)
  const fsPlugin = win?.Capacitor?.Plugins?.Filesystem;
  const sharePlugin = win?.Capacitor?.Plugins?.Share;
  if (fsPlugin?.writeFile && sharePlugin?.share) {
    try {
      const b64 = bytesToBase64(bytes);
      const written = await fsPlugin.writeFile({
        path: filename,
        data: b64,
        directory: "CACHE",
      });
      await sharePlugin.share({
        title,
        url: written.uri,
        dialogTitle: title,
      });
      return { method: "capacitor_filesystem_share", ok: true };
    } catch {
      // fall through
    }
  }

  // 3. Mobile Web Share API (Level 2 File share) when running on mobile
  if (isCapacitorNative(win) && typeof navigator !== "undefined" && navigator.share) {
    try {
      const file = new File(
        [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
        filename,
        { type: mimeType }
      );
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ title, files: [file] });
        return { method: "web_share_api", ok: true };
      }
    } catch {
      // fall through
    }
  }

  // 4. Windows Desktop / Standard Web Browser Blob + <a download>
  if (win?.document && typeof URL !== "undefined" && URL.createObjectURL) {
    try {
      const blob = new Blob(
        [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
        { type: mimeType }
      );
      const blobUrl = URL.createObjectURL(blob);
      const a = win.document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      a.style.display = "none";
      win.document.body.appendChild(a);
      a.click();
      win.document.body.removeChild(a);
      setTimeout(() => {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {}
      }, 5000);
      return { method: "blob_download", ok: true };
    } catch {
      return { method: "blob_download", ok: false };
    }
  }

  return { method: "blob_download", ok: false };
}
