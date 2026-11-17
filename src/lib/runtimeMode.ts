import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import type { RuntimeMode } from "./licensing/licenseSchema";

export interface RuntimeConfig {
  mode: RuntimeMode;
  port: number;
  host: string;
  cloudUrl: string;
  customDomain?: string;
  dataPath?: string;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  mode: "local",
  port: 3000,
  host: "127.0.0.1",
  cloudUrl: "https://qat.world",
  customDomain: "",
  dataPath: process.platform === "win32" ? "C:\\UAS-Data" : path.resolve(process.cwd(), "data"),
};

export function getRuntimeConfigFilePaths(): string[] {
  const paths: string[] = [];
  if (process.platform === "win32") {
    paths.push("C:\\UAS-Data\\uas.runtime.json");
    paths.push("C:\\UAS\\uas.runtime.json");
  }
  paths.push(path.resolve(process.cwd(), "uas.runtime.json"));
  return paths;
}

export function getRuntimeConfig(): RuntimeConfig {
  const candidates = getRuntimeConfigFilePaths();
  for (const p of candidates) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
        const raw = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8");
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          mode: ["local", "lan", "cloud"].includes(parsed.mode) ? parsed.mode : "local",
        };
      }
    } catch {
      // Continue
    }
  }
  return { ...DEFAULT_CONFIG };
}

export function saveRuntimeConfig(patch: Partial<RuntimeConfig>): RuntimeConfig {
  const current = getRuntimeConfig();
  const updated: RuntimeConfig = {
    ...current,
    ...patch,
  };

  // Adjust host binding based on mode
  if (updated.mode === "lan") {
    updated.host = "0.0.0.0";
  } else if (updated.mode === "local") {
    updated.host = "127.0.0.1";
  }

  let targetPath = path.resolve(process.cwd(), "uas.runtime.json");
  if (process.platform === "win32" && fs.existsSync("C:\\UAS-Data")) {
    targetPath = "C:\\UAS-Data\\uas.runtime.json";
  } else if (process.platform === "win32" && fs.existsSync("C:\\UAS")) {
    targetPath = "C:\\UAS\\uas.runtime.json";
  }

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(targetPath, JSON.stringify(updated, null, 2), "utf8");

  // If switched to LAN mode on Windows, ensure firewall rule exists
  if (updated.mode === "lan" && process.platform === "win32") {
    ensureWindowsFirewallRule(updated.port);
  }

  return updated;
}

export function getServerLanIps(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name];
    if (!list) continue;
    for (const net of list) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }

  // Sort preferred LAN IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  ips.sort((a, b) => {
    const aIs192 = a.startsWith("192.168.") ? 1 : 0;
    const bIs192 = b.startsWith("192.168.") ? 1 : 0;
    return bIs192 - aIs192;
  });

  return ips.length > 0 ? ips : ["127.0.0.1"];
}

export function getLanServerUrl(port: number = 3000): string {
  const ips = getServerLanIps();
  const primaryIp = ips[0] || "127.0.0.1";
  return `http://${primaryIp}:${port}`;
}

export function ensureWindowsFirewallRule(port: number = 3000): { success: boolean; message: string } {
  if (process.platform !== "win32") {
    return { success: true, message: "Firewall rule not needed on non-Windows OS" };
  }

  try {
    const checkScript = `powershell -NoProfile -NonInteractive -Command "if (!(Get-NetFirewallRule -DisplayName 'UAS Accounting LAN' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName 'UAS Accounting LAN' -Direction Inbound -LocalPort ${port} -Protocol TCP -Action Allow -Profile Any | Out-Null; Write-Output 'CREATED' } else { Write-Output 'EXISTS' }"`;
    const res = execSync(checkScript, { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { success: true, message: res === "CREATED" ? "Firewall rule created" : "Firewall rule already active" };
  } catch (err: any) {
    return { success: false, message: err?.message || "Failed to configure Windows Firewall (administrator privilege may be required)" };
  }
}

export async function verifyCloudHealth(url: string): Promise<{ healthy: boolean; status?: number; error?: string }> {
  try {
    const cleanUrl = url.trim().replace(/\/+$/, "");
    const res = await fetch(`${cleanUrl}/api/public/verify`, {
      method: "GET",
      headers: { "User-Agent": "UAS-Runtime-Orchestrator/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    return { healthy: res.ok, status: res.status };
  } catch (e: any) {
    return { healthy: false, error: e?.message || "Connection timeout or unreachable host" };
  }
}
