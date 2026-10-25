import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

const bootstrap = read("infra/terraform/bootstrap/main.tf");

/** The text of the data "aws_iam_policy_document" block with this name. */
function document(name: string): string {
  const start = bootstrap.indexOf(`data "aws_iam_policy_document" "${name}" {`);
  expect(start, `document ${name}`).toBeGreaterThan(-1);
  const end = bootstrap.indexOf("\n}\n", start);
  return bootstrap.slice(start, end + 3);
}

/** Each top-level `statement { ... }` of a policy document, keyed by its sid. */
function statements(doc: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = doc.split("\n");
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^ {2}statement \{/.test(line)) current = [line];
    else if (current) {
      current.push(line);
      if (/^ {2}\}/.test(line)) {
        const body = current.join("\n");
        const sid = /sid\s*=\s*"([^"]+)"/.exec(body)?.[1] ?? `anonymous-${out.size}`;
        out.set(sid, body);
        current = null;
      }
    }
  }
  return out;
}

describe("the deploy role is trusted by one repository and one environment", () => {
  const trust = document("gha_trust");

  it("matches the subject exactly, never with a wildcard", () => {
    const sub = /variable\s*=\s*"token\.actions\.githubusercontent\.com:sub"/.exec(trust);
    expect(sub).not.toBeNull();
    const condition = trust.slice(trust.lastIndexOf("condition {", sub!.index));
    expect(condition).toMatch(/test\s*=\s*"StringEquals"/);
    expect(trust).not.toMatch(/StringLike/);
    expect(trust).not.toMatch(/\*/);
  });

  it("pins the GitHub Environment as well as the repository", () => {
    expect(trust).toMatch(/\$\{var\.github_subject_prefix\}:environment:\$\{var\.github_environment\}/);
  });

  it("only accepts a subject that carries the numeric owner and repository IDs", () => {
    expect(bootstrap).toMatch(/variable "github_subject_prefix"/);
    expect(bootstrap).toMatch(/\^repo:\[A-Za-z0-9_\.-\]\+@\[0-9\]\+\/\[A-Za-z0-9_\.-\]\+@\[0-9\]\+\$/);
    expect(bootstrap).not.toMatch(/variable "github_repository"/);
  });

  it("requires the audience claim", () => {
    expect(trust).toMatch(/token\.actions\.githubusercontent\.com:aud[\s\S]*?sts\.amazonaws\.com/);
  });
});

describe("what the deploy role can do is narrow", () => {
  const deploy = statements(document("gha_deploy"));

  it("allows a resource of * only for reads and for creating a tagged user pool", () => {
    const wildcard = [...deploy].filter(([, body]) => /resources\s*=\s*\["\*"\]/.test(body) && !/effect\s*=\s*"Deny"/.test(body));
    expect(wildcard.map(([sid]) => sid).sort()).toEqual(["CreateTaggedUserPools", "ReadForPlan"]);
  });

  it("reaches user pools only when they are tagged Project = SecureMind", () => {
    // In an account shared with other projects, this keeps the role away from their pools.
    const create = deploy.get("CreateTaggedUserPools")!;
    expect(create).toMatch(/actions\s*=\s*\["cognito-idp:CreateUserPool"\]/);
    expect(create).toMatch(/variable\s*=\s*"aws:RequestTag\/Project"[\s\S]*?"SecureMind"/);
    const pools = deploy.get("UserPools")!;
    expect(pools).toMatch(/variable\s*=\s*"aws:ResourceTag\/Project"[\s\S]*?"SecureMind"/);
    expect(pools).not.toMatch(/resources\s*=\s*\["\*"\]/);
    // Reading the list of pools is the only user-pool action allowed everywhere.
    const reads = deploy.get("ReadForPlan")!;
    expect(reads).toMatch(/cognito-idp:ListUserPools/);
    expect(reads).not.toMatch(/cognito-idp:(Describe|Get|List)\*/);
  });

  it("never grants a whole service on every resource", () => {
    for (const [sid, body] of deploy) {
      if (sid === "CreateTaggedUserPools" || sid === "ReadForPlan") continue;
      if (/effect\s*=\s*"Deny"/.test(body)) continue;
      expect(body, sid).not.toMatch(/resources\s*=\s*\["\*"\]/);
    }
  });

  it("only creates or changes roles that carry the permission boundary", () => {
    for (const sid of ["CreateBoundedRoles", "ChangeBoundedRoles", "AttachKnownPolicies", "SetTheBoundary"]) {
      const body = deploy.get(sid);
      expect(body, sid).toBeDefined();
      expect(body, sid).toMatch(/variable\s*=\s*"iam:PermissionsBoundary"[\s\S]*?aws_iam_policy\.boundary\.arn/);
      expect(body, sid).toMatch(/role\/securemind-\*|local\.role_glob/);
    }
  });

  it("attaches only the known managed policies and its own named policies", () => {
    const body = deploy.get("AttachKnownPolicies")!;
    expect(body).toMatch(/variable\s*=\s*"iam:PolicyARN"/);
    expect(body).toMatch(/AdministratorAccess-Amplify/);
    expect(body).toMatch(/AWSLambdaBasicExecutionRole/);
    expect(body).not.toMatch(/AdministratorAccess"/);
  });

  it("passes roles only to the app's own services", () => {
    const body = deploy.get("PassRolesToTheAppServices")!;
    expect(body).toMatch(/iam:PassedToService/);
    expect(body).toMatch(/local\.role_glob/);
    expect(document("gha_deploy")).not.toMatch(/"iam:\*"/);
  });

  it("can never edit itself, the boundary or the identity provider, or drop a boundary", () => {
    for (const sid of ["NeverChangeItself", "NeverChangeTheBoundary", "NeverRemoveABoundary", "NeverChangeTheIdentityProvider"]) {
      const body = deploy.get(sid);
      expect(body, sid).toBeDefined();
      expect(body, sid).toMatch(/effect\s*=\s*"Deny"/);
    }
    expect(deploy.get("NeverChangeItself")).toMatch(/aws_iam_role\.gha\.arn/);
    expect(deploy.get("NeverChangeItself")).toMatch(/iam:PutRolePolicy/);
  });

  it("keeps Terraform's state and the avatar bucket as its only S3 access", () => {
    expect(deploy.get("TerraformState")).toMatch(/aws_s3_bucket\.state\.arn/);
    expect(deploy.get("AvatarBucket")).toMatch(/securemind-avatars-\*/);
  });
});

describe("the permission boundary", () => {
  const boundary = statements(document("boundary"));

  it("denies every IAM change, whatever else a bounded role is given", () => {
    const body = boundary.get("NeverChangeIdentity");
    expect(body).toBeDefined();
    expect(body).toMatch(/effect\s*=\s*"Deny"/);
    expect(body).toMatch(/"iam:\*"/);
  });

  it("grants nothing on IAM", () => {
    for (const [sid, body] of boundary) {
      if (sid === "NeverChangeIdentity") continue;
      expect(body, sid).not.toMatch(/"iam:/);
    }
  });

  it("keeps data access to securemind-named tables, parameters and the avatar bucket", () => {
    expect(boundary.get("AppTables")).toMatch(/table\/securemind-\*/);
    expect(boundary.get("AppParameters")).toMatch(/parameter\/securemind\/\*/);
    expect(boundary.get("Avatars")).toMatch(/securemind-avatars-\*/);
  });
});

describe("the app stack follows the boundary", () => {
  it("lets every role it creates carry the boundary", () => {
    expect(read("infra/terraform/modules/api/main.tf")).toMatch(/aws_iam_role" "lambda"[\s\S]*?permissions_boundary\s*=\s*var\.permissions_boundary_arn != ""/);
    expect(read("infra/terraform/modules/amplify/main.tf")).toMatch(/aws_iam_role" "amplify"[\s\S]*?permissions_boundary\s*=\s*var\.permissions_boundary_arn != ""/);
    expect(read("infra/terraform/main.tf")).toMatch(/variable "permissions_boundary_arn"/);
  });

  it("no longer lets CI rewrite the deploy role's own policy", () => {
    const api = read("infra/terraform/modules/api/main.tf");
    expect(api).not.toMatch(/gha_avatars/);
    expect(api).not.toMatch(/aws_iam_role" "gha"/);
  });

  it("passes the boundary to CI from a repository variable", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci.match(/TF_VAR_permissions_boundary_arn:\s*\$\{\{\s*vars\.PERMISSIONS_BOUNDARY_ARN\s*\}\}/g)?.length).toBe(2);
  });
});
