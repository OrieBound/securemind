import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  explainTotp,
  formatSecretForDisplay,
  hotp,
  otpauthUri,
  totp,
  verifyTotp,
} from "./totp";

// RFC 4226 Appendix D and RFC 6238 Appendix B use this ASCII secret.
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_SECRET_B32 = base32Encode(RFC_SECRET);

describe("base32", () => {
  it("round-trips and ignores spacing, dashes and case", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode("mzxw 6ytb-oi").toString()).toBe("foobar");
    for (const text of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
      expect(base32Decode(base32Encode(Buffer.from(text))).toString()).toBe(text);
    }
  });

  it("rejects characters that are not in the alphabet", () => {
    expect(() => base32Decode("MZXW1")).toThrow(/base32/);
  });
});

describe("HOTP (RFC 4226 test vectors)", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  it.each(expected.map((code, counter) => [counter, code] as const))("counter %i is %s", (counter, code) => {
    expect(hotp(RFC_SECRET, counter)).toBe(code);
  });
});

describe("TOTP (RFC 6238 test vectors, 8 digits)", () => {
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  it.each(vectors)("at %i the code is %s", (time, code) => {
    expect(totp(RFC_SECRET_B32, { time, digits: 8 })).toBe(code);
  });

  it("gives six digits by default, the last six of the eight", () => {
    expect(totp(RFC_SECRET_B32, { time: 59 })).toBe("287082");
  });

  it("changes every 30 seconds and not within a step", () => {
    const a = totp(RFC_SECRET_B32, { time: 30 });
    expect(totp(RFC_SECRET_B32, { time: 59 })).toBe(a);
    expect(totp(RFC_SECRET_B32, { time: 60 })).not.toBe(a);
  });
});

describe("verifyTotp", () => {
  const now = 1_700_000_000;
  const code = totp(RFC_SECRET_B32, { time: now });

  it("accepts the current code and one step of drift either way", () => {
    expect(verifyTotp(RFC_SECRET_B32, code, { time: now })).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code, { time: now + 30 })).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code, { time: now - 30 })).toBe(true);
  });

  it("rejects a code two steps old, a wrong code and malformed input", () => {
    expect(verifyTotp(RFC_SECRET_B32, code, { time: now + 90 })).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, "000000", { time: now })).toBe(code === "000000");
    for (const bad of ["", "12345", "1234567", "12345a", " 123456"]) {
      expect(verifyTotp(RFC_SECRET_B32, bad, { time: now }), JSON.stringify(bad)).toBe(false);
    }
  });

  it("widens or narrows the window on request", () => {
    expect(verifyTotp(RFC_SECRET_B32, code, { time: now + 90, window: 3 })).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code, { time: now + 30, window: 0 })).toBe(false);
  });
});

describe("explainTotp", () => {
  it("shows the same code the plain function gives, with every step on the way", () => {
    const time = 1_700_000_000;
    const r = explainTotp(RFC_SECRET_B32, { time });
    expect(r.code).toBe(totp(RFC_SECRET_B32, { time }));
    expect(r.counter).toBe(Math.floor(time / 30));
    expect(r.counterHex).toHaveLength(16);
    expect(r.hmacHex).toHaveLength(40);
    expect(r.truncatedBytesHex).toHaveLength(8);
    expect(r.offset).toBeGreaterThanOrEqual(0);
    expect(r.offset).toBeLessThanOrEqual(15);
    expect(r.binary % 1_000_000).toBe(Number(r.code));
    // The offset really is the low 4 bits of the last HMAC byte.
    expect(r.offset).toBe(parseInt(r.hmacHex.slice(-2), 16) & 0x0f);
  });

  it("counts down to the next code", () => {
    expect(explainTotp(RFC_SECRET_B32, { time: 60 }).secondsLeft).toBe(30);
    expect(explainTotp(RFC_SECRET_B32, { time: 89 }).secondsLeft).toBe(1);
  });

  it("matches the RFC 6238 vector at time 59", () => {
    const r = explainTotp(RFC_SECRET_B32, { time: 59, digits: 8 });
    expect(r.code).toBe("94287082");
    expect(r.counter).toBe(1);
  });
});

describe("authenticator link", () => {
  it("builds the otpauth link an app reads from the QR code", () => {
    const uri = otpauthUri({ secret: "jbsw y3dp-ehpk 3pxp", account: "me@example.com", issuer: "SecureMind" });
    expect(uri).toBe(
      "otpauth://totp/SecureMind:me%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=SecureMind&algorithm=SHA1&digits=6&period=30",
    );
  });

  it("escapes characters that would break the link", () => {
    const uri = otpauthUri({ secret: "AAAA", account: "a b&c@example.com", issuer: "Secure Mind" });
    expect(uri).toContain("Secure%20Mind:a%20b%26c%40example.com");
    expect(uri).not.toContain(" ");
  });

  it("groups a secret for typing", () => {
    expect(formatSecretForDisplay("jbswy3dpehpk3pxp")).toBe("JBSW Y3DP EHPK 3PXP");
  });
});
