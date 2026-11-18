export function isInstalledClientApp(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  if (w.Capacitor?.isNativePlatform?.()) return true;
  if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
  const protocol = window.location.protocol;
  if (protocol === "capacitor:" || protocol === "file:") return true;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  return false;
}
