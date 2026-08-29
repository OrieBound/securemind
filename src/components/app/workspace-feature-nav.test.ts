import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_FEATURE_ORDER,
  normalizeWorkspaceFeatureOrder,
  reorderWorkspaceFeature,
} from "@/components/app/workspace-feature-nav";

describe("normalizeWorkspaceFeatureOrder", () => {
  it("keeps a valid custom order", () => {
    expect(
      normalizeWorkspaceFeatureOrder([
        "memory",
        "thread",
        "bookmarks",
        "documents",
        "workspace-settings",
      ]),
    ).toEqual([
      "memory",
      "thread",
      "bookmarks",
      "documents",
      "workspace-settings",
    ]);
  });

  it("fills missing features", () => {
    expect(normalizeWorkspaceFeatureOrder(["bookmarks"])).toEqual([
      "bookmarks",
      ...DEFAULT_WORKSPACE_FEATURE_ORDER.filter(id => id !== "bookmarks"),
    ]);
  });
});

describe("reorderWorkspaceFeature", () => {
  it("moves Chat below Knowledge", () => {
    expect(
      reorderWorkspaceFeature([...DEFAULT_WORKSPACE_FEATURE_ORDER], "thread", 2),
    ).toEqual([
      "documents",
      "thread",
      "memory",
      "bookmarks",
      "workspace-settings",
    ]);
  });
});
