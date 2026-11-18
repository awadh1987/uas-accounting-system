import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bytesToBase64,
  exportOrShareBinaryFile,
  formatWhatsAppUrl,
  isCapacitorNative,
  normalizeWhatsAppPhone,
  openExternalOrWhatsApp,
  triggerNativePrint,
  type NativeWindowLike,
} from "../src/lib/nativeBridge";
import {
  activateOfflineClientLicense,
  buildOfflineClientLicenseStatus,
  createMemoryStorage,
} from "../src/lib/licensing";

describe("Pre-Release Native Shell Bridge — WhatsApp, PDF Print & Excel Export Routing", () => {
  it("normalizes Yemeni and international phone numbers and formats WhatsApp URLs", () => {
    assert.equal(normalizeWhatsAppPhone("771234567"), "967771234567");
    assert.equal(normalizeWhatsAppPhone("0771234567"), "967771234567");
    assert.equal(normalizeWhatsAppPhone("+967 771-234-567"), "967771234567");
    assert.equal(normalizeWhatsAppPhone("00966501234567"), "966501234567");

    const voucherUrl = formatWhatsAppUrl({
      phone: "771234567",
      text: "سند قبض رقم VCH-01 بمبلغ 50,000 ريال",
    });
    assert.ok(voucherUrl.startsWith("https://wa.me/967771234567?text="));
    assert.ok(decodeURIComponent(voucherUrl).includes("سند قبض رقم VCH-01"));

    const requestCodeUrl = formatWhatsAppUrl({
      text: "طلب ترخيص UAS: REQ-1234-5678",
    });
    assert.ok(requestCodeUrl.startsWith("https://wa.me/?text="));
  });

  it("routes WhatsApp & external URLs to Android native Intent on APK and window.open on Windows Desktop", () => {
    let capturedAndroidUrl = "";
    const androidWin: NativeWindowLike = {
      UasAndroidNative: {
        openExternalUrl(url: string) {
          capturedAndroidUrl = url;
          return true;
        },
      },
    };

    assert.equal(isCapacitorNative(androidWin), true);
    const androidRes = openExternalOrWhatsApp(
      { phone: "777000111", text: "فاتورة مبيعات #101" },
      androidWin
    );
    assert.equal(androidRes.ok, true);
    assert.equal(androidRes.method, "android_native_intent");
    assert.ok(capturedAndroidUrl.startsWith("https://wa.me/967777000111?text="));

    // Capacitor Browser plugin fallback
    let browserOpenedUrl = "";
    const capBrowserWin: NativeWindowLike = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          Browser: {
            async open({ url }) {
              browserOpenedUrl = url;
            },
          },
        },
      },
    };
    const capRes = openExternalOrWhatsApp("https://wa.me/967777000111", capBrowserWin);
    assert.equal(capRes.ok, true);
    assert.equal(capRes.method, "capacitor_browser");
    assert.equal(browserOpenedUrl, "https://wa.me/967777000111");

    // Windows Desktop browser window.open
    let desktopUrl = "";
    let desktopTarget = "";
    const desktopWin: NativeWindowLike = {
      open(url, target) {
        desktopUrl = String(url);
        desktopTarget = String(target);
        return {} as Window;
      },
    };
    const desktopRes = openExternalOrWhatsApp(
      { phone: "777000111", text: "Receipt" },
      desktopWin
    );
    assert.equal(desktopRes.ok, true);
    assert.equal(desktopRes.method, "window_open");
    assert.equal(desktopTarget, "_blank");
    assert.ok(desktopUrl.includes("967777000111"));
  });

  it("routes PDF & Voucher printing to Android PrintManager on APK and window.print() on Windows Desktop", async () => {
    let androidJobTitle = "";
    const androidWin: NativeWindowLike = {
      UasAndroidNative: {
        printCurrentPage(jobName: string) {
          androidJobTitle = jobName;
          return true;
        },
      },
    };

    const pAndroid = await triggerNativePrint({ title: "UAS-Voucher-SAL-001" }, androidWin);
    assert.equal(pAndroid.ok, true);
    assert.equal(pAndroid.method, "android_print_manager");
    assert.equal(androidJobTitle, "UAS-Voucher-SAL-001");

    let printedDesktop = false;
    const mockDoc = { title: "UAS ERP" } as Document;
    const desktopWin: NativeWindowLike = {
      document: mockDoc,
      print() {
        printedDesktop = true;
      },
    };
    const pDesktop = await triggerNativePrint({ title: "UAS-Financial-Statements" }, desktopWin);
    assert.equal(pDesktop.ok, true);
    assert.equal(pDesktop.method, "window_print");
    assert.equal(printedDesktop, true);
    assert.equal(mockDoc.title, "UAS-Financial-Statements");
  });

  it("routes Excel (.xlsx) binary exports to Android FileProvider Share and Capacitor Filesystem/Share", async () => {
    const sampleBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]); // PK zip/xlsx header
    let sharedFile = { filename: "", mimeType: "", b64: "", title: "" };

    const androidWin: NativeWindowLike = {
      UasAndroidNative: {
        shareBase64File(filename, mimeType, base64Data, title) {
          sharedFile = { filename, mimeType, b64: base64Data, title };
          return true;
        },
      },
    };

    const resAndroid = await exportOrShareBinaryFile(
      {
        filename: "UAS_Enterprise_Financial_Statements.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: sampleBytes,
        title: "UAS Financial Statements",
      },
      androidWin
    );
    assert.equal(resAndroid.ok, true);
    assert.equal(resAndroid.method, "android_native_share");
    assert.equal(sharedFile.filename, "UAS_Enterprise_Financial_Statements.xlsx");
    assert.equal(sharedFile.b64, bytesToBase64(sampleBytes));

    // Capacitor @capacitor/filesystem + @capacitor/share fallback
    let capWrittenPath = "";
    let capSharedUri = "";
    const capPluginsWin: NativeWindowLike = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          Filesystem: {
            async writeFile(opts) {
              capWrittenPath = opts.path;
              return { uri: `file:///cache/${opts.path}` };
            },
          },
          Share: {
            async share(opts) {
              capSharedUri = opts.url || "";
            },
          },
        },
      },
    };

    const resCap = await exportOrShareBinaryFile(
      {
        filename: "UAS_Report.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: sampleBytes,
      },
      capPluginsWin
    );
    assert.equal(resCap.ok, true);
    assert.equal(resCap.method, "capacitor_filesystem_share");
    assert.equal(capWrittenPath, "UAS_Report.xlsx");
    assert.equal(capSharedUri, "file:///cache/UAS_Report.xlsx");
  });

  it("computes offline Capacitor license status with real Request Code and updates to ACTIVE upon offline activation", async () => {
    const storage = createMemoryStorage();
    const initialStatus = await buildOfflineClientLicenseStatus({ storage });
    assert.equal(initialStatus.is_valid, false);
    assert.equal(initialStatus.license_status, "UNLICENSED");
    assert.match(initialStatus.request_code, /^REQ-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);

    // Activate using a real signed license if license.uas exists
    const fs = await import("node:fs");
    const path = await import("node:path");
    const licPath = path.resolve(process.cwd(), "license.uas");
    if (fs.existsSync(licPath)) {
      const raw = fs.readFileSync(licPath, "utf8");
      const act = await activateOfflineClientLicense(
        { licenseFileContent: raw, platform: "android" },
        { storage }
      );
      assert.equal(act.success, true);

      const afterStatus = await buildOfflineClientLicenseStatus({ storage });
      assert.equal(afterStatus.is_valid, true);
      assert.equal(afterStatus.license_status, "ACTIVE");
    }
  });
});
