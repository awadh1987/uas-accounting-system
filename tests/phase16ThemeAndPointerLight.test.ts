import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  THEME_PRESETS,
  buildTenantAccentVars,
  buildThemeBootInlineScript,
  normalizeThemePreset,
  parseHexColor,
  resolveThemeMode,
} from "../src/lib/themeEngine";
import { parseAccountingSettings } from "../src/lib/accountingSettings";

const REPO_ROOT = path.resolve(__dirname, "..");

describe("Phase 16 — Light & Dark Theme Presets, Tenant Brand Accents & Pointer-Reactive Light", () => {
  it("normalizes and resolves light, dark, system, emerald, and royal theme presets", () => {
    assert.equal(normalizeThemePreset("light"), "light");
    assert.equal(normalizeThemePreset("dark"), "dark");
    assert.equal(normalizeThemePreset("system"), "system");
    assert.equal(normalizeThemePreset("royal"), "royal");
    assert.equal(normalizeThemePreset("invalid-x"), "emerald");

    assert.equal(resolveThemeMode("light", true), "light");
    assert.equal(resolveThemeMode("emerald", true), "light");
    assert.equal(resolveThemeMode("royal", true), "light");
    assert.equal(resolveThemeMode("dark", false), "dark");
    assert.equal(resolveThemeMode("system", true), "dark");
    assert.equal(resolveThemeMode("system", false), "light");

    assert.ok(THEME_PRESETS.some((p) => p.id === "light"));
    assert.ok(THEME_PRESETS.some((p) => p.id === "dark"));
    assert.ok(THEME_PRESETS.some((p) => p.id === "system"));

    const settingsLight = parseAccountingSettings({ defaultTheme: "light" });
    const settingsSystem = parseAccountingSettings({ defaultTheme: "system" });
    assert.equal(settingsLight.defaultTheme, "light");
    assert.equal(settingsSystem.defaultTheme, "system");
  });

  it("computes tenant brand accent CSS custom properties with accessible contrast and zero invalid hex leakage", () => {
    assert.equal(parseHexColor("not-a-color"), null);
    assert.deepEqual(parseHexColor("#abc"), { r: 170, g: 187, b: 204, hex: "#aabbcc" });

    const darkAccent = buildTenantAccentVars("#1d4ed8", "light");
    assert.equal(darkAccent["--tenant-accent"], "#1d4ed8");
    assert.equal(darkAccent["--accent"], "#1d4ed8");
    assert.equal(darkAccent["--accent-contrast"], "#ffffff");
    assert.ok(darkAccent["--accent-soft"]?.includes("rgba(29, 78, 216,"));

    const brightAccent = buildTenantAccentVars("#facc15", "dark");
    assert.equal(brightAccent["--accent-contrast"], "#0f172a");
    assert.deepEqual(buildTenantAccentVars("javascript:alert(1)", "light"), {});
  });

  it("provides zero-flash boot script and pointer-light CSS guarded for hover:hover, pointer:fine, prefers-reduced-motion, and print", () => {
    const bootScript = buildThemeBootInlineScript();
    assert.ok(bootScript.includes("uas_theme_preset_v1"));
    assert.ok(bootScript.includes("uas_portal_theme_preset_v1"));
    assert.ok(bootScript.includes("prefers-color-scheme: dark"));

    const css = fs.readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
    assert.ok(css.includes("@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)"));
    assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
    assert.ok(css.includes("@media print"));
    assert.ok(css.includes("display: none !important"));
    assert.ok(css.includes("--uas-ptr-x"));
    assert.ok(css.includes("--uas-ptr-y"));

    const ptrCtrl = fs.readFileSync(
      path.join(REPO_ROOT, "src/components/PointerLightController.tsx"),
      "utf8"
    );
    assert.ok(ptrCtrl.includes("(hover: hover) and (pointer: fine)"));
    assert.ok(ptrCtrl.includes("(prefers-reduced-motion: reduce)"));
    assert.ok(ptrCtrl.includes("requestAnimationFrame"));
  });
});
