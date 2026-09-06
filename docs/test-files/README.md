# Test files (synthetic Knowledge corpus)

These files exist **only for tests**. Every name, address, identifier, card number, token, and password is fictional. Do not treat any value as real personal data or a usable credential.

## What is here

| File | Kind |
|------|------|
| `customer-case.docx` | Word narrative / customer-case |
| `SecureMind_Synthetic_Residential_Tenancy_Agreement.docx` | Word tenancy / lease narrative |
| `service-agreement.pdf` | PDF contract-style text |
| `employee-register.xlsx` | Excel employees, credentials, and control sheet |
| `support-tickets.csv` | Exported support tickets |
| `incident-notes.txt` | Incident / security notes |
| `app-config.json` | Nested application / API config |
| `expected-findings.json` | Categories expected under the default **balanced** policy |

Values intentionally include PII-shaped data, payment-card test numbers, AWS/GitHub token shapes, RFC1918 addresses, repeated identifiers, and harmless control text.

## Policy under test

Detection follows `src/lib/pii.ts` and the instance default (`balanced` + `DEFAULT_SAFE_TERMS`). That means:

- Email, SSN, Luhn-valid cards, phones, public IPv4, street addresses, and high-signal secrets **are** redacted.
- RFC1918 addresses are **safe-listed** by default. RFC 2606 `example.com` / `.org` / `.net` mailboxes are **not** exempted.
- Dates of birth, names, bank routing numbers, and ordinary passwords are **not** pattern families at balanced — they are control/negative examples, not missing-feature bugs.
- Passport / national ID patterns require **high** sensitivity.

There is **no restore path**. Tests assert that the sanitized form is what would be persisted or sent to a model.

## Regenerating test files

```
npm run corpus:write
```

Automated coverage lives in `tests/document-regression.test.ts`.
