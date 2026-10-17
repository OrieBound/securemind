# Two-step verification (authenticator-app codes)

Two-step verification adds a second proof at sign-in: your password, plus a 6-digit code from an app on your phone. If someone steals the password, they still cannot sign in without the phone. It is optional for every account, and strongly recommended for anyone who administers an install.

It works on the **hosted edition with real Amazon Cognito**. The local sign-in used by Docker does not implement codes, so the profile page says so instead of offering a switch that would not work.

## How a code is made

The codes are TOTP (time-based one-time passwords, RFC 6238). Nothing is sent to your phone when you sign in. Your phone and the server each work the code out on their own, and they agree because they share a secret.

1. **Setup shares a secret once.** The server makes a random secret and shows it as a QR code (or as text to type). Your app stores it. Anyone who gets this secret can make your codes, so it is shown once and never again.
2. **Both sides count 30-second steps.** The "counter" is the number of 30-second steps since 1 January 1970.
3. **Both sign the counter with the secret.** HMAC-SHA1(secret, counter) gives 20 bytes that only someone holding the secret can produce.
4. **Both shorten that to six digits.** The last 4 bits of the final byte pick a starting point, 4 bytes are read from there, the top bit is cleared, and the last six decimal digits are the code.
5. **The code changes every 30 seconds.** The server also accepts the step before and after, to forgive a clock that is a little off.

You can watch every step happen for any secret:

```bash
npm run totp -- JBSWY3DPEHPK3PXP --explain
```

The algorithm is written out in [src/lib/totp.ts](../src/lib/totp.ts) and checked against the official test vectors in the RFCs. **Cognito, not this file, checks codes at sign-in.** The file exists so the method is readable, so tests can act as an authenticator app, and so you can get a code without a phone while testing.

## What you see

**Turning it on (My Profile, Two-step verification):**

1. Choose "Set up two-step verification". The server asks Cognito for a new secret for you and shows a QR code and the same secret as text.
2. Scan it with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy).
3. Type the code the app shows. Cognito checks it, and only then turns the second step on. A wrong code leaves it off.

**Signing in afterwards:**

1. Email and password, as before.
2. If the account has two-step verification on, the sign-in does not finish. The screen asks for the code. No session exists yet.
3. Type the code. The browser sends it with a one-time sign-in session to `/api/auth/login/mfa`. If Cognito accepts it, you are signed in.

The sign-in session lasts about three minutes and works only together with a valid code. A wrong code can be retried, and Cognito rate-limits repeated failures.

**Turning it off** needs your password again, so a stolen browser session alone cannot remove the second step.

## Setting it up on an install

`modules/auth_cognito` sets the user pool to `OPTIONAL` with authenticator-app codes. Applying that is safe: nobody is forced to enrol and nobody is locked out. Existing sign-ins keep working.

```bash
terraform -chdir=infra/terraform apply
npm run infra:wire       # always run this straight after an apply
```

Then **sign in as the Owner first and turn it on**, so the account that can do the most is protected first. Other admins follow. There is a banner on the profile page of anyone who can manage people and keys until they do.

SMS codes are deliberately not offered. They need extra AWS setup and are weaker, because phone numbers can be taken over.

To require it for everyone later, set `mfa_configuration = "ON"`. Do that only after every user has enrolled, because a user without a device cannot sign in under `ON`.

## Lost phone

There are no recovery codes in Cognito's authenticator-app flow, so recovery is done by an administrator.

- **Someone else lost their phone:** an Owner or Admin opens Admin, finds the person, and chooses **Reset 2-step**. They sign in with their password and set it up again. Check the request really comes from them first, because this removes the second step.
- **The only Owner lost their phone:** nobody in the app can reset them, by design. Use the AWS CLI with an identity that has Cognito admin access:

```bash
aws cognito-idp admin-set-user-mfa-preference \
  --user-pool-id <your-user-pool-id> \
  --username <owner-email> \
  --software-token-mfa-settings Enabled=false,PreferredMfa=false \
  --profile <your-aws-profile>
```

Then sign in with the password and turn it on again with the new phone.

## What it does not do

- **It does not sign out sessions that already exist.** Turning it on protects the next sign-in. Access tokens last about an hour.
- **It is not required.** Each person chooses, unless an operator sets `ON`.
- **It does not protect the AWS console or the CLI.** Those need their own MFA.
- **It does not work with the local Docker sign-in.** That sign-in checks a password only.
- **There is no "remember this device".** Every password sign-in asks for a code.

## Where the code is

| Piece | File |
|---|---|
| Code algorithm, checked against the RFC vectors | `src/lib/totp.ts` |
| Cognito calls and error mapping | `src/lib/cognito.ts` |
| Public code step of sign-in | `src/app/api/auth/login/mfa/route.ts` |
| Signed-in status, setup, verify, turn off | `src/app/api/auth/mfa/**` |
| Admin reset | `adminResetDirectoryUserMfa` in `src/lib/cognito-admin.ts` |
| Login screen and profile screen | `src/components/app/auth-gate.tsx`, `mfa-settings.tsx` |
| User pool setting | `infra/terraform/modules/auth_cognito/main.tf` |
