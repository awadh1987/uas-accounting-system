import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.uas.accounting",
  appName: "UAS Accounting",
  webDir: "out",
  backgroundColor: "#f8fafc",
  server: {
    ...(serverUrl ? { url: serverUrl } : {}),
    androidScheme: "http",
    iosScheme: "capacitor",
    cleartext: true,
    allowNavigation: [
      "*",
      "192.168.*.*",
      "10.*.*.*",
      "172.*.*.*",
      "localhost",
      "qat.world",
      "*.qat.world",
    ],
  },
  android: {
    allowMixedContent: true,
    buildOptions: {
      releaseType: "APK",
    },
  },
  ios: {
    contentInset: "automatic",
  },
};

export default config;


