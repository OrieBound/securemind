/**
 * @vitest-environment happy-dom
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  REMEMBERED_PLACE_LOCAL_KEYS,
  REMEMBERED_PLACE_SESSION_KEYS,
  resetRememberedPlace,
  shouldLeaveForMainPage,
} from "@/lib/client/fresh-start";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name) && !path.endsWith("fresh-start.ts")) out.push(path);
  }
  return out;
}

describe("fresh start after sign-in", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("forgets the remembered place but not the preferences people set", () => {
    localStorage.setItem("sm_settings_section", "admin");
    localStorage.setItem("sm_insights_subject", "someone");
    sessionStorage.setItem("sm_open_settings", "providers");
    sessionStorage.setItem("sm_pending_work_nav", "memory");
    localStorage.setItem("sm_theme", "light");
    localStorage.setItem("sm_active_workspace", "w1");
    localStorage.setItem("sm_left_sidebar_w", "320");

    resetRememberedPlace();

    expect(localStorage.getItem("sm_settings_section")).toBeNull();
    expect(localStorage.getItem("sm_insights_subject")).toBeNull();
    expect(sessionStorage.getItem("sm_open_settings")).toBeNull();
    expect(sessionStorage.getItem("sm_pending_work_nav")).toBeNull();
    expect(localStorage.getItem("sm_theme")).toBe("light");
    expect(localStorage.getItem("sm_active_workspace")).toBe("w1");
    expect(localStorage.getItem("sm_left_sidebar_w")).toBe("320");
  });

  it("sends Insights pages back to the main page and leaves other addresses alone", () => {
    expect(shouldLeaveForMainPage("/analytics/cost")).toBe(true);
    expect(shouldLeaveForMainPage("/analytics")).toBe(true);
    expect(shouldLeaveForMainPage("/")).toBe(false);
    expect(shouldLeaveForMainPage("/getting-started")).toBe(false);
    expect(shouldLeaveForMainPage("/analyticsx")).toBe(false);
  });

  it("only lists keys the app still uses, so a rename cannot silently break the reset", () => {
    const all = sourceFiles("src").map(f => readFileSync(f, "utf8")).join("\n");
    for (const key of [...REMEMBERED_PLACE_LOCAL_KEYS, ...REMEMBERED_PLACE_SESSION_KEYS]) {
      expect(all.includes(`"${key}"`), key).toBe(true);
    }
  });
});
