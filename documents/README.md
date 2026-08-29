# Synthetic document regression corpus

These fixtures exist **only for tests**. Every name, address, identifier, card number, token, and password is fictional. Do not treat any value as real personal data or a usable credential.

## What is here

| File | Kind |
|------|------|
| `fixtures/customer-case.docx` | Word narrative / customer-case |
| `fixtures/service-agreement.pdf` | PDF contract-style text |
| `fixtures/employee-register.xlsx` | Excel employees, credentials, and control sheet |
| `fixtures/support-tickets.csv` | Exported support tickets |
| `fixtures/incident-notes.txt` | Incident / security notes |
| `fixtures/app-config.json` | Nested application / API config |
| `expected-findings.json` | Categories expected under the default **balanced** policy |

Values intentionally include PII-shaped data, payment-card test numbers, AWS/GitHub token shapes, RFC1918 addresses, repeated identifiers, and harmless control text.

## Policy under test

Detection follows `src/lib/pii.ts` and the instance default (`balanced` + `DEFAULT_SAFE_TERMS`). That means:

- Email, SSN, Luhn-valid cards, phones, public IPv4, and high-signal secrets **are** redacted.
- RFC1918 addresses are **safe-listed** by default.
- Dates of birth, names, bank routing numbers, and ordinary passwords are **not** pattern families at balanced — they are control/negative examples, not missing-feature bugs.
- Street addresses require **high** sensitivity.

There is **no restore path**. Tests assert that the sanitized form is what would be persisted or sent to a model.

## Regenerating fixtures

```
npm run corpus:write
```

Automated coverage lives in `tests/document-regression.test.ts`.
