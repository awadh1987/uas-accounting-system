# Mobile & PWA Deployment Guide

## 1. Installable Offline-First PWA
- **Manifest**: `public/manifest.webmanifest` (`display: "standalone"`, `dir: "rtl"`, `lang: "ar"`, icons `192x192` and `512x512`).
- **Service Worker**: `public/sw.js` pre-caches the shell and falls back to `public/offline.html` when offline.
- **Offline Mutation Queue**: `src/lib/offlineDb.ts` persists snapshots and pending mutations in IndexedDB (`uas_offline_db`) via Dexie.js, syncing automatically or on clicking **Sync**.

## 2. Capacitor Native Mobile Builds (Android & iOS)

Because Next.js static export (`output: "export"`) does not include dynamic `POST`/`DELETE` API route handlers, use `npm run build:mobile` (`scripts/build-capacitor.mjs`). It temporarily sets API routes aside during static export into `./out`, restores `src/app/api` in a `finally` block, and runs `npx cap sync`.

For native devices connecting to a live server, set `NEXT_PUBLIC_API_BASE_URL` in `.env` before running `npm run build:mobile` so the Capacitor WebView sends API calls to your deployed HTTPS backend (and falls back to IndexedDB offline).

```bash
# 1. Build static bundle into ./out and sync to android/ & ios/
npm run build:mobile

# 2. Open Android Studio to build signed APK / AAB
npx cap open android

# 3. Open Xcode on macOS to archive IPA
npx cap open ios
```

