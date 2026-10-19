import { NextRequest } from "next/server";
import { cognitoConfigured } from "@/lib/cognito";
import { publicSignupAllowed } from "@/lib/setup-claim";

export const runtime = "nodejs";

/**
 * Self-serve Cognito SignUp is disabled. Empty directories use POST /api/setup/claim.
 * Later users are created by an Admin (AdminCreateUser).
 */
export async function POST(req: NextRequest) {
  void req;
  if (!cognitoConfigured()) {
    return Response.json(
      { error: "Cognito is not configured. Run node scripts/floci-cognito-setup.mjs and set .env.local." },
      { status: 503 },
    );
  }

  if (!publicSignupAllowed()) {
    return Response.json(
      {
        error:
          "Public sign-up is off. When the directory is empty, use first-run setup. After that, an Admin invites users.",
      },
      { status: 403 },
    );
  }

  return Response.json({ error: "Public sign-up is off." }, { status: 403 });
}
