/**
 * Time-based one-time passwords (TOTP), the six-digit codes in an authenticator app.
 *
 * WHO USES THIS: Amazon Cognito checks the codes at sign-in, not this file. It is here so
 * the algorithm is readable in the repo, so tests can act as an authenticator app, and for
 * `npm run totp`, which prints the current code for a secret (handy when a phone is not
 * around while you test). It is never used to decide whether a person may sign in.
 *
 * HOW IT WORKS (RFC 6238, built on RFC 4226):
 *   1. Setup shares a secret, a random string, between the server and your phone. It
 *      travels once, in the QR code. Anyone who has the secret can make valid codes.
 *   2. Both sides count the number of 30-second steps since 1970-01-01 (the "counter").
 *   3. Both compute HMAC-SHA1(secret, counter), a 20-byte value only they can produce.
 *   4. "Dynamic truncation" turns those 20 bytes into a 31-bit number, and the last six
 *      decimal digits of it are the code.
 *   Because the counter changes every 30 seconds, a code is useful for about 30 seconds.
 *   A server also accepts the steps just before and after, to forgive small clock drift.
 */

import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, which authenticator apps use for secrets. Spaces, dashes and case are ignored. */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error(`Not a base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(value >> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Every intermediate value of one HOTP computation, so the steps can be shown. */
export type HotpParts = {
  /** The 8-byte counter that was signed. */
  message: Buffer;
  /** HMAC-SHA1(secret, message): 20 bytes only someone with the secret can make. */
  hmac: Buffer;
  /** Which byte the truncation starts at: the low 4 bits of the last HMAC byte. */
  offset: number;
  /** The 31-bit number read from 4 bytes of the HMAC starting at `offset`. */
  binary: number;
  code: string;
};

export function hotpParts(secret: Buffer, counter: number, digits = 6): HotpParts {
  const message = Buffer.alloc(8);
  // The counter is an 8-byte big-endian integer. Split it, since JS bit ops are 32-bit.
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", secret).update(message).digest();

  // Dynamic truncation: the low 4 bits of the last byte choose where to read 4 bytes.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];

  return { message, hmac, offset, binary, code: String(binary % 10 ** digits).padStart(digits, "0") };
}

/** HOTP (RFC 4226): the code for one counter value. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  return hotpParts(secret, counter, digits).code;
}

export type TotpOptions = {
  /** Unix time in seconds. Defaults to now. */
  time?: number;
  /** Seconds per code. Authenticator apps use 30. */
  step?: number;
  digits?: number;
};

/** TOTP (RFC 6238): the code for a base32 secret at a moment in time. */
export function totp(secretBase32: string, opts: TotpOptions = {}): string {
  const time = opts.time ?? Math.floor(Date.now() / 1000);
  const step = opts.step ?? 30;
  return hotp(base32Decode(secretBase32), Math.floor(time / step), opts.digits ?? 6);
}

/** A code and every value on the way to it, for teaching and for debugging a mismatch. */
export function explainTotp(secretBase32: string, opts: TotpOptions = {}) {
  const time = opts.time ?? Math.floor(Date.now() / 1000);
  const step = opts.step ?? 30;
  const digits = opts.digits ?? 6;
  const counter = Math.floor(time / step);
  const parts = hotpParts(base32Decode(secretBase32), counter, digits);
  return {
    time,
    step,
    counter,
    secondsLeft: step - (time % step),
    counterHex: parts.message.toString("hex"),
    hmacHex: parts.hmac.toString("hex"),
    offset: parts.offset,
    truncatedBytesHex: parts.hmac.subarray(parts.offset, parts.offset + 4).toString("hex"),
    binary: parts.binary,
    code: parts.code,
  };
}

/**
 * Check a code, accepting `window` steps either side of now for clock drift.
 * Compares in constant time. Not used for sign-in: Cognito does that.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: TotpOptions & { window?: number } = {},
): boolean {
  const time = opts.time ?? Math.floor(Date.now() / 1000);
  const step = opts.step ?? 30;
  const digits = opts.digits ?? 6;
  const window = opts.window ?? 1;
  if (!/^\d+$/.test(code) || code.length !== digits) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(time / step);
  let ok = false;
  for (let drift = -window; drift <= window; drift++) {
    const expected = hotp(secret, counter + drift, digits);
    let diff = 0;
    for (let i = 0; i < digits; i++) diff |= expected.charCodeAt(i) ^ code.charCodeAt(i);
    if (diff === 0) ok = true;
  }
  return ok;
}

/**
 * The otpauth:// link an authenticator app reads from a QR code. `account` is shown in the
 * app (use the email). `issuer` is the product name, shown above it.
 */
export function otpauthUri(opts: { secret: string; account: string; issuer: string }): string {
  const issuer = encodeURIComponent(opts.issuer);
  const label = `${issuer}:${encodeURIComponent(opts.account)}`;
  const secret = opts.secret.replace(/[\s=-]+/g, "").toUpperCase();
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

/** Group a secret for reading aloud or typing: ABCD EFGH IJKL. */
export function formatSecretForDisplay(secret: string): string {
  return secret.replace(/[\s=-]+/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
}
