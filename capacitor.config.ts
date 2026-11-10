import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.uas.accounting",
  appName: "UAS Accounting",
  webDir: "out",
  backgroundColor: "#f8fafc",
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  android: {
    buildOptions: {
      releaseType: "AAB",
    },
  },
  ios: {
    contentInset: "automatic",
  },
};

export default config;

