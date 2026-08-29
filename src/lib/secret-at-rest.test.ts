import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secret-at-rest";

describe("secret-at-rest", () => {
  const prevKey = process.env.INSTANCE_ENCRYPTION_KEY;
  const prevFile = process.env.INSTANCE_KEY_FILE;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sm-enc-"));
    process.env.INSTANCE_ENCRYPTION_KEY = "a".repeat(64);
    delete process.env.INSTANCE_KEY_FILE;
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.INSTANCE_ENCRYPTION_KEY;
    else process.env.INSTANCE_ENCRYPTION_KEY = prevKey;
    if (prevFile === undefined) delete process.env.INSTANCE_KEY_FILE;
    else process.env.INSTANCE_KEY_FILE = prevFile;
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a vendor key and never stores plaintext", () => {
    const enc = encryptSecret("gsk_test_secret_value_1234");
    expect(enc).toMatch(/^smenc:v1:/);
    expect(enc).not.toContain("gsk_test");
    expect(isEncryptedSecret(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe("gsk_test_secret_value_1234");
  });

  it("leaves already-encrypted and empty values alone", () => {
    expect(encryptSecret(null)).toBeNull();
    expect(decryptSecret("plain-legacy-key")).toBe("plain-legacy-key");
    const once = encryptSecret("abc");
    expect(encryptSecret(once)).toBe(once);
  });
});
