/**
 * Where to send someone who needs an invitation. Set NEXT_PUBLIC_ACCESS_CONTACT_URL to a page
 * that says how to reach the person who runs this install. It is read at build time and shown
 * on the sign-in screen of the hosted edition. Only http(s) links are accepted, so a typo or a
 * hostile value can never become a script link.
 */
export function parseAccessContactUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function accessContactUrl(): string | null {
  // The variable name has to appear literally for Next.js to inline it into the browser bundle.
  return parseAccessContactUrl(process.env.NEXT_PUBLIC_ACCESS_CONTACT_URL);
}
