/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "@/components/app/auth-gate";

const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplace }) }));

const SESSION = "s".repeat(40);
const setupStatus = {
  authMode: "cognito",
  edition: "cloud",
  cognitoConfigured: true,
  directoryEmpty: false,
  claimAvailable: false,
  claimRequiresCode: true,
  codeConfigured: true,
  setupComplete: true,
  preferredStorage: "dynamodb",
  minPasswordLength: 12,
};

type Scripted = { status?: number; body: unknown };
const state = { authed: false, login: [] as Scripted[], mfa: [] as Scripted[] };
const posted: Array<{ url: string; body: Record<string, unknown> }> = [];

function json(s: Scripted) {
  return new Response(JSON.stringify(s.body), { status: s.status ?? 200 });
}

beforeEach(() => {
  routerReplace.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  state.authed = false;
  state.login = [];
  state.mfa = [];
  posted.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") {
        return state.authed
          ? new Response(
              JSON.stringify({ userId: "u1", authenticated: true, email: "me@example.com", mode: "cognito", role: "member" }),
              { status: 200 },
            )
          : new Response("{}", { status: 401 });
      }
      if (url === "/api/setup/status") return new Response(JSON.stringify(setupStatus), { status: 200 });
      if (url === "/api/auth/logout") return new Response("{}", { status: 200 });
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      posted.push({ url, body });
      if (url === "/api/auth/login") {
        const next = state.login.shift() ?? { status: 500, body: { error: "unscripted" } };
        if (next.status === undefined || next.status === 200) {
          if (!(next.body as { mfaRequired?: boolean }).mfaRequired) state.authed = true;
        }
        return json(next);
      }
      if (url === "/api/auth/login/mfa") {
        const next = state.mfa.shift() ?? { status: 500, body: { error: "unscripted" } };
        if (next.status === undefined || next.status === 200) state.authed = true;
        return json(next);
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function signIn() {
  render(
    <AuthGate>
      <p>THE APP</p>
    </AuthGate>,
  );
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "me@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-long-password-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("AuthGate two-step sign-in", () => {
  it("still signs in with just a password when the account has no second step", async () => {
    state.login = [{ body: { ok: true, accessToken: "t", expiresIn: 1800 } }];
    await signIn();
    expect(await screen.findByText("THE APP")).toBeTruthy();
    expect(posted.map(p => p.url)).toEqual(["/api/auth/login"]);
  });

  it("asks for the code after the password, and does not keep the password on screen", async () => {
    state.login = [{ body: { mfaRequired: true, session: SESSION } }];
    await signIn();
    expect(await screen.findByLabelText("6-digit authentication code")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Two-step verification" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByText("me@example.com")).toBeTruthy();
    expect(screen.queryByText("THE APP")).toBeNull();
  });

  it("signs in once the right code is sent with the session and email", async () => {
    state.login = [{ body: { mfaRequired: true, session: SESSION } }];
    state.mfa = [{ body: { ok: true, accessToken: "t", expiresIn: 1800 } }];
    await signIn();
    fireEvent.change(await screen.findByLabelText("6-digit authentication code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByText("THE APP")).toBeTruthy();
    expect(posted.find(p => p.url === "/api/auth/login/mfa")?.body).toEqual({
      email: "me@example.com",
      session: SESSION,
      code: "123456",
    });
  });

  it("shows a wrong code and lets the person try again without retyping the password", async () => {
    state.login = [{ body: { mfaRequired: true, session: SESSION } }];
    state.mfa = [{ status: 422, body: { error: "That code did not work.", code: "invalid_code", restart: false } }];
    await signIn();
    const input = (await screen.findByLabelText("6-digit authentication code")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/did not work/);
    expect(input.value).toBe("");
    expect(screen.getByLabelText("6-digit authentication code")).toBeTruthy();
    expect(screen.queryByText("THE APP")).toBeNull();
  });

  it("returns to the password step when the sign-in attempt expired", async () => {
    state.login = [{ body: { mfaRequired: true, session: SESSION } }];
    state.mfa = [{ status: 401, body: { error: "That sign-in attempt expired. Enter your email and password again.", restart: true } }];
    await signIn();
    fireEvent.change(await screen.findByLabelText("6-digit authentication code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/expired/);
    await waitFor(() => expect(screen.getByLabelText("Password")).toBeTruthy());
  });

  it("lets the person back out to the password step", async () => {
    state.login = [{ body: { mfaRequired: true, session: SESSION } }];
    await signIn();
    fireEvent.click(await screen.findByRole("button", { name: "Back to sign in" }));
    expect(await screen.findByLabelText("Password")).toBeTruthy();
    expect(screen.queryByLabelText("6-digit authentication code")).toBeNull();
  });

  it("accepts only digits and spaces in the code box", async () => {
    state.login = [{ body: { mfaRequired: true, session: SESSION } }];
    await signIn();
    const input = (await screen.findByLabelText("6-digit authentication code")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12ab 34-56" } });
    expect(input.value).toBe("12 3456");
  });

  it("starts a fresh session on sign-in: forgets the remembered place and leaves Insights", async () => {
    localStorage.setItem("sm_settings_section", "admin");
    sessionStorage.setItem("sm_open_settings", "providers");
    window.history.pushState({}, "", "/analytics/cost");
    state.login.push({ body: { accessToken: "t" } });

    render(<AuthGate><p>app</p></AuthGate>);
    fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/"));
    expect(localStorage.getItem("sm_settings_section")).toBeNull();
    expect(sessionStorage.getItem("sm_open_settings")).toBeNull();
    window.history.pushState({}, "", "/");
  });

  it("keeps its place when the page is reloaded with a live session", async () => {
    localStorage.setItem("sm_settings_section", "admin");
    window.history.pushState({}, "", "/analytics/cost");
    state.authed = true;

    render(<AuthGate><p>app</p></AuthGate>);
    expect(await screen.findByText("app")).toBeTruthy();

    expect(routerReplace).not.toHaveBeenCalled();
    expect(localStorage.getItem("sm_settings_section")).toBe("admin");
    window.history.pushState({}, "", "/");
  });
});
