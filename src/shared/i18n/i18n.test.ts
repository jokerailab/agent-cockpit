import { afterEach, describe, expect, it } from "vitest";
import { en } from "./en";
import { zhCN } from "./zh-CN";
import { getLocale, resolveLocale, setLocale, t } from "./index";

afterEach(() => setLocale("en"));

describe("dictionaries", () => {
  it("cover exactly the same key set", () => {
    // the type system already enforces this; asserted at runtime too because a
    // stale build or a loosened type would otherwise ship blank labels
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty translations", () => {
    for (const [key, value] of Object.entries(zhCN)) {
      expect(value.trim(), `zh-CN.${key} is empty`).not.toBe("");
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en.${key} is empty`).not.toBe("");
    }
  });

  it("uses matching placeholders in both locales", () => {
    const holders = (s: string): string[] => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(holders(zhCN[key]), `placeholder mismatch on "${key}"`).toEqual(holders(en[key]));
    }
  });

  it("keeps English as the default locale", () => {
    expect(getLocale()).toBe("en");
  });
});

describe("t", () => {
  it("returns the template when no params are needed", () => {
    expect(t("activity.working")).toBe("Working");
  });

  it("interpolates named placeholders", () => {
    expect(t("health.diag.degenerate", { run: 8420 })).toBe("Repetition loop (same token ×8420)");
  });

  it("interpolates every occurrence of a repeated placeholder", () => {
    expect(t("common.turns", { n: 3 })).toBe("3 turns");
  });

  it("leaves a placeholder verbatim when its value is missing", () => {
    // surfaces the wiring bug instead of rendering "undefined" mid-sentence
    expect(t("health.diag.degenerate")).toBe("Repetition loop (same token ×{run})");
    expect(t("health.diag.errorProne", {})).toBe("Frequent tool errors ({pct}%)");
  });

  it("accepts string and numeric params alike", () => {
    expect(t("time.ago", { v: "5m" })).toBe("5m ago");
    expect(t("alert.context.title", { pct: 87 })).toBe("Context 87%");
  });

  it("switches dictionaries when the locale changes", () => {
    setLocale("zh-CN");
    expect(t("activity.working")).toBe("进行中");
    expect(t("health.diag.degenerate", { run: 8420 })).toBe("复读退化（同词 ×8420）");
    setLocale("en");
    expect(t("activity.working")).toBe("Working");
  });
});

describe("resolveLocale", () => {
  it("honours an explicit preference over the system locale", () => {
    expect(resolveLocale("en", "zh-CN")).toBe("en");
    expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN");
  });

  it("maps any Chinese system locale to zh-CN under auto", () => {
    for (const sys of ["zh", "zh-CN", "zh-Hans", "zh-TW", "ZH-hk"]) {
      expect(resolveLocale("auto", sys)).toBe("zh-CN");
    }
  });

  it("falls back to English for everything else under auto", () => {
    for (const sys of ["en-US", "de-DE", "ja-JP", "", "fr"]) {
      expect(resolveLocale("auto", sys)).toBe("en");
    }
  });
});
