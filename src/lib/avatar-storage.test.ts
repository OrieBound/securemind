import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);

describe("avatar disk store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sm-avatar-"));
    process.env.AVATAR_STORAGE_PATH = dir;
    delete process.env.AVATAR_S3_BUCKET;
    delete process.env.SECUREMIND_EDITION;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.AMPLIFY_HOSTING;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.AVATAR_STORAGE_PATH;
    delete process.env.SECUREMIND_EDITION;
  });

  it("round-trips bytes for the identity user only", async () => {
    const { writeAvatar, readAvatar, removeAvatar, resolveAvatarPublicUrl } = await import("@/lib/avatar-storage");
    const meta = await writeAvatar("user-a", PNG, "image/png");
    const stored = await readAvatar("user-a");
    expect(stored?.bytes.equals(PNG)).toBe(true);
    expect(stored?.meta.contentType).toBe("image/png");
    expect(await resolveAvatarPublicUrl("user-a")).toContain(encodeURIComponent(meta.updatedAt));
    expect(await readAvatar("user-b")).toBeNull();
    await removeAvatar("user-a");
    expect(await readAvatar("user-a")).toBeNull();
  });

  it("refuses disk writes on a hosted install without a bucket", async () => {
    process.env.SECUREMIND_EDITION = "cloud";
    const { writeAvatar } = await import("@/lib/avatar-storage");
    await expect(writeAvatar("user-a", PNG, "image/png")).rejects.toThrow(
      /object store is not configured/i,
    );
  });
});
