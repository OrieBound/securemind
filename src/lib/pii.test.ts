import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAFE_TERMS,
  NON_EXEMPTIBLE_CATEGORIES,
  categoriesAddedAtTier,
  categoriesForTier,
  cidrContains,
  isSafeTerm,
  omitRetiredDefaultSafeTerms,
  parsePiiSensitivityTier,
  passesCanadianSin,
  passesLuhn,
  scrubPII,
  sensitivityTier,
  validateSafeTerm,
  type SafeTerm,
} from "./pii";

/** Categories detected in a scrub, for concise assertions. */
function categories(text: string, options?: Parameters<typeof scrubPII>[1]): string[] {
  return scrubPII(text, options).scrubEvents.map(e => e.category).sort();
}

describe("detection — true positives", () => {
  it("detects an email address", () => {
    const r = scrubPII("ping me at alice.smith@acme.io tomorrow");
    expect(r.hadRedactions).toBe(true);
    expect(r.sanitized).toBe("ping me at [email redacted] tomorrow");
  });

  it("detects a hyphenated SSN", () => {
    expect(categories("ssn 123-45-6789")).toContain("SSN");
  });

  it("detects a space-separated SSN", () => {
    expect(categories("ssn 123 45 6789")).toContain("SSN");
  });

  it("detects a hyphenated Canadian SIN", () => {
    // Synthetic checksum-valid SIN (not a real person).
    expect(categories("sin 046-454-286")).toContain("SIN");
  });

  it("detects a space-separated Canadian SIN", () => {
    expect(categories("sin 046 454 286")).toContain("SIN");
  });

  it("detects a bare 9-digit Canadian SIN", () => {
    expect(categories("sin 046454286")).toContain("SIN");
  });

  it("does not classify a US SSN shape as a Canadian SIN", () => {
    expect(categories("ssn 123-45-6789")).not.toContain("SIN");
  });

  it("detects a Luhn-valid card number", () => {
    // 4242 4242 4242 4242 is the canonical Stripe test card and passes Luhn.
    expect(categories("card 4242424242424242")).toContain("card number");
  });

  it("detects a Luhn-valid card number with separators", () => {
    expect(categories("card 4242 4242 4242 4242")).toContain("card number");
  });

  it("detects a parenthesised phone number", () => {
    expect(categories("call (415) 555-0142")).toContain("phone");
  });

  it("detects a bare 10-digit phone number", () => {
    expect(categories("call 4155550142")).toContain("phone");
  });

  it("detects a public IPv4 address", () => {
    expect(categories("origin 8.8.8.8 timed out")).toContain("IP address");
  });

  it("detects a street address at balanced sensitivity", () => {
    expect(categories("ship to 1600 Amphitheatre Parkway", { sensitivity: "balanced" }))
      .toContain("address");
  });

  it("detects an ID-shaped token at high sensitivity", () => {
    expect(categories("passport AB1234567", { sensitivity: "high" }))
      .toContain("ID number");
  });

  it("detects multiple distinct categories in one message", () => {
    const found = categories("mail bob@acme.io or call (415) 555-0142");
    expect(found).toEqual(["email", "phone"]);
  });

  it("detects an AWS access key id", () => {
    expect(categories("key AKIAIOSFODNN7EXAMPLE used")).toContain("secret");
  });

  it("detects an AWS temporary access key id (ASIA)", () => {
    expect(categories("key ASIAIOSFODNN7EXAMPLE used")).toContain("secret");
  });

  it("detects an AWS secret access key assignment", () => {
    // Exactly 40 chars — AWS secret access key length.
    const key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".slice(0, 40);
    const line = `AWS_SECRET_ACCESS_KEY=${key}`;
    expect(key).toHaveLength(40);
    expect(categories(line)).toContain("secret");
  });

  it("detects a JSON-style SecretAccessKey assignment", () => {
    const key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".slice(0, 40);
    const line = `"SecretAccessKey": "${key}"`;
    expect(categories(line)).toContain("secret");
  });

  it("detects an AWS session token assignment", () => {
    const token = "A".repeat(100) + "exampleSessionTokenSuffix==";
    expect(categories(`AWS_SESSION_TOKEN=${token}`)).toContain("secret");
  });

  it("detects a GitHub personal access token", () => {
    expect(categories("token ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toContain("secret");
  });

  it("detects a Stripe live secret key", () => {
    expect(categories("stripe sk_live_abcdefghijklmnopqrstuv")).toContain("secret");
  });

  it("detects a PEM private key block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn\n-----END RSA PRIVATE KEY-----";
    expect(categories(pem)).toContain("secret");
  });

  it("detects secrets even at the lowest sensitivity tier", () => {
    expect(categories("key AKIAIOSFODNN7EXAMPLE", { sensitivity: "low" })).toContain("secret");
  });

  it("counts repeated hits of the same category", () => {
    const r = scrubPII("a@x.io and b@y.io and c@z.io");
    expect(r.scrubEvents.find(e => e.category === "email")?.count).toBe(3);
  });
});

describe("detection — false positives", () => {
  it("does not flag a 16-digit trace id that fails Luhn", () => {
    expect(categories("trace 1234567890123456")).not.toContain("card number");
  });

  it("does not flag a long request id", () => {
    expect(categories("req 9987654321098765432")).not.toContain("card number");
  });

  it("does not flag a semver-like version string as an IP", () => {
    expect(categories("upgraded to 1.2.3 today")).not.toContain("IP address");
  });

  it("does not flag ordinary prose", () => {
    const r = scrubPII("the deploy finished and the queue drained normally");
    expect(r.hadRedactions).toBe(false);
    expect(r.sanitized).toBe("the deploy finished and the queue drained normally");
  });

  it("does not flag a bare 10-digit id starting with 1", () => {
    expect(categories("order 1234567890")).not.toContain("phone");
  });

  it("does not flag the word secret alone", () => {
    expect(categories("rotate the secret after deploy")).not.toContain("secret");
  });

  it("does not flag a short sk- prefix without enough entropy", () => {
    expect(categories("prefix sk-short")).not.toContain("secret");
  });

  it("does not flag an incomplete AKIA prefix", () => {
    expect(categories("look for AKIA-prefixed access keys")).not.toContain("secret");
  });

  it("does not flag a bare 40-char string without an AWS secret key name", () => {
    const key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".slice(0, 40);
    expect(categories(`token ${key} alone`)).not.toContain("secret");
  });

  it("does not flag a 9-digit run that fails the SIN checksum", () => {
    expect(categories("ref 123456789")).not.toContain("SIN");
  });

  it("does not flag all-identical digits as a SIN", () => {
    expect(categories("code 111111111")).not.toContain("SIN");
  });
});

describe("sensitivity tiers", () => {
  it("maps slider values to tiers", () => {
    expect(sensitivityTier(0)).toBe("low");
    expect(sensitivityTier(0.5)).toBe("balanced");
    expect(sensitivityTier(0.75)).toBe("high");
    expect(sensitivityTier(1)).toBe("high");
  });

  it("maps stored extreme to high", () => {
    expect(parsePiiSensitivityTier("extreme")).toBe("high");
    expect(categories("passport AB1234567", { sensitivity: "extreme" })).toContain("ID number");
  });

  it("runs fewer pattern families at low than at high", () => {
    expect(categoriesForTier("low").length).toBeLessThan(categoriesForTier("high").length);
  });

  it("adds ID-shaped tokens at high, not at balanced", () => {
    expect(categoriesAddedAtTier("high")).toEqual(
      expect.arrayContaining(["Passport / national ID patterns"]),
    );
    expect(categoriesForTier("balanced")).not.toContain("Passport / national ID patterns");
    expect(categoriesForTier("high")).toContain("Passport / national ID patterns");
  });

  it("adds street addresses at balanced, not only at high", () => {
    expect(categoriesAddedAtTier("balanced")).toEqual(
      expect.arrayContaining(["Phone numbers", "IPv4 addresses", "Street addresses"]),
    );
    expect(categoriesForTier("balanced")).toEqual(expect.arrayContaining(["Street addresses"]));
    expect(categoriesForTier("low")).not.toContain("Street addresses");
  });

  it("skips IP detection at low sensitivity", () => {
    expect(categories("origin 8.8.8.8", { sensitivity: "low" })).not.toContain("IP address");
  });

  it("catches IP detection at balanced sensitivity", () => {
    expect(categories("origin 8.8.8.8", { sensitivity: "balanced" })).toContain("IP address");
  });

  it("skips street addresses at low sensitivity", () => {
    expect(categories("ship to 1600 Amphitheatre Parkway", { sensitivity: "low" }))
      .not.toContain("address");
  });

  it("always detects email, even at the lowest tier", () => {
    expect(categories("bob@acme.io", { sensitivity: "low" })).toContain("email");
  });

  it("redacts RFC 2606 documentation mailboxes under shipped defaults", () => {
    expect(categories("jordan.test@example.com", { safeTerms: DEFAULT_SAFE_TERMS }))
      .toContain("email");
    expect(categories("billing@example.org", { safeTerms: DEFAULT_SAFE_TERMS }))
      .toContain("email");
    expect(categories("morgan.sample@example.net", { safeTerms: DEFAULT_SAFE_TERMS }))
      .toContain("email");
  });

  it("defaults to balanced when no sensitivity is supplied", () => {
    expect(categories("origin 8.8.8.8")).toEqual(categories("origin 8.8.8.8", { sensitivity: "balanced" }));
  });
});

describe("safe terms", () => {
  const cidr: SafeTerm[] = [{ id: "t1", kind: "cidr", value: "10.0.0.0/8" }];

  it("suppresses an IP inside a declared CIDR range", () => {
    expect(categories("host 10.0.1.42 is down", { safeTerms: cidr })).not.toContain("IP address");
  });

  it("still flags an IP outside the declared range", () => {
    expect(categories("host 8.8.8.8 is down", { safeTerms: cidr })).toContain("IP address");
  });

  it("discloses which safe term suppressed a detection", () => {
    const r = scrubPII("hosts 10.0.1.42 and 10.0.1.43", { safeTerms: cidr });
    expect(r.safeTermMatches).toEqual([{ termId: "t1", category: "IP address", count: 2 }]);
  });

  it("never includes the suppressed value in the disclosure", () => {
    const r = scrubPII("host 10.0.1.42", { safeTerms: cidr });
    expect(JSON.stringify(r.safeTermMatches)).not.toContain("10.0.1.42");
  });

  it("suppresses an email on a declared domain", () => {
    const terms: SafeTerm[] = [{ id: "t2", kind: "domain", value: "acme.io" }];
    expect(categories("bob@acme.io", { safeTerms: terms })).not.toContain("email");
  });

  it("does not let a domain term match a lookalike domain", () => {
    const terms: SafeTerm[] = [{ id: "t3", kind: "domain", value: "acme.io" }];
    expect(categories("bob@notacme.io", { safeTerms: terms })).toContain("email");
  });

  it("matches a wildcard subdomain term", () => {
    const terms: SafeTerm[] = [{ id: "t4", kind: "domain", value: "*.internal.acme.io" }];
    expect(categories("svc@api.internal.acme.io", { safeTerms: terms })).not.toContain("email");
  });

  it("matches a literal term case-insensitively", () => {
    const terms: SafeTerm[] = [{ id: "t5", kind: "literal", value: "BOB@ACME.IO" }];
    expect(categories("bob@acme.io", { safeTerms: terms })).not.toContain("email");
  });

  it("matches a prefix term", () => {
    expect(isSafeTerm("arn:aws:s3:::acme-logs-prod", [
      { id: "t6", kind: "prefix", value: "arn:aws:s3:::acme-logs-*" },
    ])).not.toBeNull();
  });

  it("cannot exempt a non-exemptible category", () => {
    const terms: SafeTerm[] = [{ id: "t7", kind: "literal", value: "123-45-6789" }];
    expect(categories("ssn 123-45-6789", { safeTerms: terms })).toContain("SSN");
  });

  it("ships RFC 1918 ranges as defaults", () => {
    expect(categories("host 192.168.1.10", { safeTerms: DEFAULT_SAFE_TERMS }))
      .not.toContain("IP address");
  });

  it("does not ship RFC 2606 example.* domains as defaults", () => {
    expect(DEFAULT_SAFE_TERMS.some(t => /example\.(com|org|net)/i.test(t.value))).toBe(false);
  });

  it("drops stored RFC 2606 example.* terms from a prior default list", () => {
    const mixed: SafeTerm[] = [
      ...DEFAULT_SAFE_TERMS,
      { id: "default-example-com", kind: "domain", value: "example.com", label: "RFC 2606 reserved domain" },
    ];
    expect(omitRetiredDefaultSafeTerms(mixed).some(t => t.value === "example.com")).toBe(false);
  });
});

describe("cidrContains", () => {
  it("includes an address inside the range", () => {
    expect(cidrContains("10.0.0.0/8", "10.255.3.1")).toBe(true);
  });

  it("excludes an address outside the range", () => {
    expect(cidrContains("10.0.0.0/8", "11.0.0.1")).toBe(false);
  });

  it("handles a /32 host route", () => {
    expect(cidrContains("10.0.0.5/32", "10.0.0.5")).toBe(true);
    expect(cidrContains("10.0.0.5/32", "10.0.0.6")).toBe(false);
  });

  it("rejects malformed input rather than throwing", () => {
    expect(cidrContains("not-a-cidr", "10.0.0.1")).toBe(false);
    expect(cidrContains("10.0.0.0/8", "999.1.1.1")).toBe(false);
  });
});

describe("passesCanadianSin", () => {
  it("accepts a checksum-valid SIN", () => {
    expect(passesCanadianSin("046-454-286")).toBe(true);
  });

  it("rejects a checksum-invalid 9-digit run", () => {
    expect(passesCanadianSin("123456789")).toBe(false);
  });

  it("rejects all zeros", () => {
    expect(passesCanadianSin("000000000")).toBe(false);
  });
});

describe("passesLuhn", () => {
  it("accepts a valid card number", () => {
    expect(passesLuhn("4242424242424242")).toBe(true);
  });

  it("rejects an invalid checksum", () => {
    expect(passesLuhn("4242424242424241")).toBe(false);
  });

  it("rejects runs that are too short", () => {
    expect(passesLuhn("42424242")).toBe(false);
  });
});

describe("validateSafeTerm", () => {
  it("accepts a well-formed CIDR range", () => {
    expect(validateSafeTerm("10.0.0.0/8", "cidr").ok).toBe(true);
  });

  it("rejects malformed CIDR notation", () => {
    expect(validateSafeTerm("10.0.0.0", "cidr").ok).toBe(false);
  });

  it("rejects an SSN as a literal safe term", () => {
    const result = validateSafeTerm("123-45-6789", "literal");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/social security/i);
  });

  it("rejects a Luhn-valid card number as a literal safe term", () => {
    expect(validateSafeTerm("4242424242424242", "literal").ok).toBe(false);
  });

  it("rejects an empty value", () => {
    expect(validateSafeTerm("   ", "literal").ok).toBe(false);
  });

  it("rejects an RFC 2606 documentation domain as a safe term", () => {
    const result = validateSafeTerm("example.com", "domain");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/example\.com/i);
  });

  it("accepts an ordinary hostname literal", () => {
    expect(validateSafeTerm("svc-payments-prod", "literal").ok).toBe(true);
  });

  it("exposes the non-exemptible category list", () => {
    expect(NON_EXEMPTIBLE_CATEGORIES).toEqual(
      expect.arrayContaining(["SSN", "SIN", "card number", "secret"]),
    );
  });

  it("rejects a Canadian SIN as a literal safe term", () => {
    const result = validateSafeTerm("046-454-286", "literal");
    expect(result.ok).toBe(false);
  });

  it("rejects an AWS access key as a literal safe term", () => {
    const result = validateSafeTerm("AKIAIOSFODNN7EXAMPLE", "literal");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/api keys/i);
  });
});

describe("no raw value escapes the scrubber", () => {
  const SECRETS = [
    { text: "email me at victim@private.io", raw: "victim@private.io" },
    { text: "ssn 123-45-6789",               raw: "123-45-6789" },
    { text: "sin 046-454-286",               raw: "046-454-286" },
    { text: "card 4242424242424242",         raw: "4242424242424242" },
    { text: "call (415) 555-0142",           raw: "(415) 555-0142" },
    { text: "origin 8.8.8.8",                raw: "8.8.8.8" },
    { text: "key AKIAIOSFODNN7EXAMPLE",      raw: "AKIAIOSFODNN7EXAMPLE" },
    { text: "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", raw: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  ];

  for (const { text, raw } of SECRETS) {
    it(`omits ${raw} from every field of the result`, () => {
      const r = scrubPII(text, { sensitivity: "high" });

      expect(r.sanitized).not.toContain(raw);
      expect(JSON.stringify(r.scrubEvents)).not.toContain(raw);
      expect(JSON.stringify(r.safeTermMatches)).not.toContain(raw);

      // Redacted segments carry a category only — never the value.
      for (const seg of r.segments) {
        if (seg.redacted) {
          expect(Object.keys(seg).sort()).toEqual(["category", "redacted"]);
        } else {
          expect(seg.text).not.toContain(raw);
        }
      }

      // Belt and braces: the serialized result must not contain the value anywhere.
      expect(JSON.stringify(r)).not.toContain(raw);
    });
  }
});

describe("structural safety", () => {
  it("preserves surrounding text exactly", () => {
    const r = scrubPII("before bob@acme.io after");
    expect(r.sanitized).toBe("before [email redacted] after");
  });

  it("handles overlapping matches without duplicating text", () => {
    const r = scrubPII("123-45-6789", { sensitivity: "high" });
    expect(r.sanitized.match(/redacted/g)?.length).toBe(1);
  });

  it("returns the input unchanged when nothing matches", () => {
    const input = "nothing sensitive here";
    expect(scrubPII(input).sanitized).toBe(input);
  });

  it("handles an empty string", () => {
    const r = scrubPII("");
    expect(r.sanitized).toBe("");
    expect(r.hadRedactions).toBe(false);
  });

  it("is stable across repeated calls (no regex lastIndex leakage)", () => {
    const input = "a@x.io and b@y.io";
    const first  = scrubPII(input).sanitized;
    const second = scrubPII(input).sanitized;
    expect(second).toBe(first);
  });
});
