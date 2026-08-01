import { describe, expect, it } from "vitest";
import { getIdentity, LOCAL_USER_ID } from "./identity";

describe("getIdentity", () => {
  it("returns the fixed local identity", async () => {
    const id = await getIdentity(new Request("http://localhost/api/anything"));
    expect(id.userId).toBe(LOCAL_USER_ID);
  });

  it("ignores a userId in the query string", async () => {
    const id = await getIdentity(new Request("http://localhost/api/x?userId=attacker"));
    expect(id.userId).toBe(LOCAL_USER_ID);
  });

  it("ignores a client-supplied identity header", async () => {
    const id = await getIdentity(new Request("http://localhost/api/x", {
      headers: { "x-user-id": "attacker", "authorization": "Bearer forged" },
    }));
    expect(id.userId).toBe(LOCAL_USER_ID);
  });

  it("ignores a userId in the request body", async () => {
    const id = await getIdentity(new Request("http://localhost/api/x", {
      method: "POST",
      body: JSON.stringify({ userId: "attacker" }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(id.userId).toBe(LOCAL_USER_ID);
  });

  it("does not consume the request body", async () => {
    const req = new Request("http://localhost/api/x", {
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    await getIdentity(req);
    await expect(req.json()).resolves.toEqual({ message: "hello" });
  });
});
