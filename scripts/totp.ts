/**
 * Print the current authenticator-app code for a secret, optionally showing every step.
 *
 *   npm run totp -- JBSWY3DPEHPK3PXP            # the code now, and seconds left
 *   npm run totp -- JBSWY3DPEHPK3PXP --explain  # each step of how it was made
 *   TOTP_SECRET=JBSWY3DPEHPK3PXP npm run totp   # keep the secret out of shell history
 *
 * Use it to test two-step verification without a phone, or to see how the algorithm works.
 * The secret is the "key to type by hand" shown during setup. Treat it like a password.
 * Cognito checks the codes at sign-in; this script is not part of the app.
 */

import { explainTotp, formatSecretForDisplay } from "../src/lib/totp";

function main() {
  const args = process.argv.slice(2);
  const explain = args.includes("--explain");
  const secret = args.find(a => !a.startsWith("--")) ?? process.env.TOTP_SECRET;
  if (!secret) {
    console.error("Usage: npm run totp -- <secret> [--explain]   (or set TOTP_SECRET)");
    process.exit(1);
  }

  let r;
  try {
    r = explainTotp(secret);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!explain) {
    console.log(`${r.code}   (changes in ${r.secondsLeft}s)`);
    return;
  }

  console.log(`Secret            ${formatSecretForDisplay(secret)}`);
  console.log(`1. Time           ${r.time} (seconds since 1970-01-01)`);
  console.log(`2. Counter        ${r.time} / ${r.step}s = ${r.counter}   (8 bytes: ${r.counterHex})`);
  console.log(`3. HMAC-SHA1      ${r.hmacHex}`);
  console.log(`                  the secret signs the counter; only someone with the secret can make this`);
  console.log(`4. Offset         ${r.offset}   (the low 4 bits of the last byte, ${r.hmacHex.slice(-2)})`);
  console.log(`5. Four bytes     ${r.truncatedBytesHex}   (read from byte ${r.offset}; top bit cleared)`);
  console.log(`6. As a number    ${r.binary}`);
  console.log(`7. Last 6 digits  ${r.code}   <- the code, valid for ${r.secondsLeft} more seconds`);
}

main();
