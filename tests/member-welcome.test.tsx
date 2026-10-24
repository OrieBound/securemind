/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AppTour, tourStorageKey, tourSteps } from "@/components/app/app-tour";
import { defaultWorkspaceHello, isAdminSetupHello, memberWorkspaceHello, noModelAssistantReply } from "@/lib/onboarding";

const getIdentity = vi.fn();
const loadSession = vi.fn();

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return { ...actual, getIdentity: (...a: unknown[]) => getIdentity(...a) };
});
vi.mock("@/lib/workspaces/store", () => ({ loadSession: (...a: unknown[]) => loadSession(...a) }));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("opening message", () => {
  it("members do not get the connect-a-model setup steps", () => {
    const text = memberWorkspaceHello("Mindy Locke");
    expect(text).toContain("Mindy Locke");
    expect(text).not.toMatch(/Bedrock|Do this next|Chat needs a model first|acknowledg/i);
    expect(text).toMatch(/Insights/);
    expect(text).toMatch(/administrator/);
  });

  it("recognises the Admin setup message only", () => {
    expect(isAdminSetupHello(defaultWorkspaceHello("Mindy", "cloud"))).toBe(true);
    expect(isAdminSetupHello(defaultWorkspaceHello("Mindy", "local"))).toBe(true);
    expect(isAdminSetupHello(memberWorkspaceHello("Mindy"))).toBe(false);
  });

  it("members are told to ask their administrator when no model is connected", () => {
    expect(noModelAssistantReply("cloud", false)).toMatch(/ask them/);
    expect(noModelAssistantReply("cloud", false)).not.toMatch(/Bedrock/);
    expect(noModelAssistantReply("cloud", true)).toMatch(/Bedrock/);
  });
});

describe("GET /api/session shows each role its own opening message", () => {
  const payload = () => ({
    sessionId: "s1",
    workspaceId: "w1",
    messages: [{ id: "m1", role: "assistant", content: defaultWorkspaceHello("Mindy Locke", "cloud") }],
  });
  const call = async () => {
    const { GET } = await import("@/app/api/session/route");
    return GET(new NextRequest("http://localhost/api/session?workspaceId=w1"));
  };

  it("replaces the setup guide for a member", async () => {
    getIdentity.mockResolvedValue({ userId: "u1", role: "member" });
    loadSession.mockResolvedValue(payload());
    const body = await (await call()).json();
    expect(body.messages[0].content).toBe(memberWorkspaceHello("Mindy Locke"));
  });

  it("keeps the setup guide for an Admin", async () => {
    getIdentity.mockResolvedValue({ userId: "a1", role: "admin" });
    loadSession.mockResolvedValue(payload());
    const body = await (await call()).json();
    expect(body.messages[0].content).toContain("Chat needs a model first");
  });
});

describe("first-run tour", () => {
  it("keeps Admin-only wording out of the member version", () => {
    const member = JSON.stringify(tourSteps(false));
    expect(member).not.toMatch(/provider keys|manage models|As an Admin/i);
    expect(JSON.stringify(tourSteps(true))).toMatch(/As an Admin/);
  });

  it("offers the tour, runs through every step, and reports done", () => {
    const onClose = vi.fn();
    const onStart = vi.fn();
    const { rerender } = render(<AppTour invite active={false} isAdmin={false} onStart={onStart} onClose={onClose} />);
    fireEvent.click(screen.getByText("Show me around"));
    expect(onStart).toHaveBeenCalled();

    rerender(<AppTour invite={false} active isAdmin={false} onStart={onStart} onClose={onClose} />);
    const steps = tourSteps(false);
    for (let i = 0; i < steps.length - 1; i++) {
      expect(screen.getByText(steps[i].title)).toBeTruthy();
      fireEvent.click(screen.getByText("Next"));
    }
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalledWith("done");
  });

  it("keys the seen flag per account", () => {
    expect(tourStorageKey("A@Example.com")).toBe(tourStorageKey("a@example.com"));
    expect(tourStorageKey("a@example.com")).not.toBe(tourStorageKey("b@example.com"));
  });
});
