/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MfaSettings, qrDataUrl } from "@/components/app/mfa-settings";

type Reply = { status?: number; body: unknown };
const routes = new Map<string, Reply[]>();
const calls: Array<{ url: string; body: unknown }> = [];

function reply(url: string, ...replies: Reply[]) {
  routes.set(url, replies);
}

beforeEach(() => {
  routes.clear();
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const queue = routes.get(url) ?? [];
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (!next) return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("qrDataUrl", () => {
  it("makes an image the page can show without any network request", () => {
    expect(qrDataUrl("otpauth://totp/SecureMind:me%40example.com?secret=JBSWY3DPEHPK3PXP")).toMatch(/^data:image\/gif;base64,/);
  });
});

describe("MfaSettings", () => {
  it("explains, instead of showing controls, where Cognito codes are not available", async () => {
    reply("/api/auth/mfa", { body: { available: false, enabled: false, recommended: false } });
    render(<MfaSettings />);
    expect(await screen.findByText(/local sign-in/i)).toBeTruthy();
    expect(screen.queryByText(/Set up two-step verification/)).toBeNull();
  });

  it("describes it as optional for an ordinary member", async () => {
    reply("/api/auth/mfa", { body: { available: true, enabled: false, recommended: false } });
    render(<MfaSettings />);
    expect(await screen.findByText(/It is optional/)).toBeTruthy();
    expect(screen.queryByText(/Highly recommended/)).toBeNull();
    expect(screen.getByRole("button", { name: "Set up two-step verification" })).toBeTruthy();
  });

  it("strongly recommends it to someone who manages the install", async () => {
    reply("/api/auth/mfa", { body: { available: true, enabled: false, recommended: true } });
    render(<MfaSettings />);
    expect(await screen.findByText(/Highly recommended for your account/)).toBeTruthy();
  });

  it("walks through setup: QR code, typeable key, then a confirming code", async () => {
    reply("/api/auth/mfa", { body: { available: true, enabled: false, recommended: true } });
    reply("/api/auth/mfa/setup", {
      body: { otpauthUri: "otpauth://totp/SecureMind:me%40example.com?secret=JBSWY3DPEHPK3PXP", secret: "JBSW Y3DP EHPK 3PXP" },
    });
    reply("/api/auth/mfa/verify", { body: { ok: true, enabled: true } });
    render(<MfaSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Set up two-step verification" }));
    const qr = (await screen.findByAltText("QR code for your authenticator app")) as HTMLImageElement;
    expect(qr.src).toMatch(/^data:image\/gif;base64,/);
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeTruthy();

    const input = screen.getByLabelText("6-digit code from your authenticator app");
    const turnOn = screen.getByRole("button", { name: "Turn on" }) as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "123456" } });
    expect(turnOn.disabled).toBe(false);
    fireEvent.click(turnOn);

    await waitFor(() => expect(screen.getByText(/Two-step verification is on/)).toBeTruthy());
    expect(calls.find(c => c.url === "/api/auth/mfa/verify")?.body).toEqual({ code: "123456" });
  });

  it("keeps setup open and clears the field when the code is wrong", async () => {
    reply("/api/auth/mfa", { body: { available: true, enabled: false, recommended: false } });
    reply("/api/auth/mfa/setup", { body: { otpauthUri: "otpauth://totp/x?secret=AAAA", secret: "AAAA" } });
    reply("/api/auth/mfa/verify", { status: 422, body: { error: "That code did not work.", code: "invalid_code" } });
    render(<MfaSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up two-step verification" }));
    const input = (await screen.findByLabelText("6-digit code from your authenticator app")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/did not work/);
    expect(input.value).toBe("");
    expect(screen.getByAltText("QR code for your authenticator app")).toBeTruthy();
  });

  it("lets the person cancel setup", async () => {
    reply("/api/auth/mfa", { body: { available: true, enabled: false, recommended: false } });
    reply("/api/auth/mfa/setup", { body: { otpauthUri: "otpauth://totp/x?secret=AAAA", secret: "AAAA" } });
    render(<MfaSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up two-step verification" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Set up two-step verification" })).toBeTruthy();
    expect(screen.queryByAltText("QR code for your authenticator app")).toBeNull();
  });

  it("shows when it is on and how to recover a lost phone", async () => {
    reply("/api/auth/mfa", { body: { available: true, enabled: true, recommended: false } });
    render(<MfaSettings />);
    expect(await screen.findByText(/You are asked for a code at sign-in/)).toBeTruthy();
    expect(screen.getByText(/Lost your phone\?/)).toBeTruthy();
  });

  it("turns it off only after the password is entered", async () => {
    reply("/api/auth/mfa", { body: { available: true, enabled: true, recommended: false } });
    reply("/api/auth/mfa/disable", { body: { ok: true, enabled: false } });
    render(<MfaSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off…" }));
    const turnOff = screen.getByRole("button", { name: "Turn off" }) as HTMLButtonElement;
    expect(turnOff.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "hunter2-hunter2" } });
    fireEvent.click(turnOff);
    await waitFor(() => expect(screen.getByText(/Two-step verification is off/)).toBeTruthy());
    expect(calls.find(c => c.url === "/api/auth/mfa/disable")?.body).toEqual({ password: "hunter2-hunter2" });
  });

  it("stays on when the password is wrong", async () => {
    reply("/api/auth/mfa", { body: { available: true, enabled: true, recommended: false } });
    reply("/api/auth/mfa/disable", { status: 403, body: { error: "That password is not correct." } });
    render(<MfaSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off…" }));
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not correct/);
    expect(screen.getByRole("button", { name: "Keep it on" })).toBeTruthy();
  });

  it("falls back to the explanation if the status request fails", async () => {
    reply("/api/auth/mfa", { status: 500, body: { error: "boom" } });
    render(<MfaSettings />);
    expect(await screen.findByText(/local sign-in/i)).toBeTruthy();
  });
});
