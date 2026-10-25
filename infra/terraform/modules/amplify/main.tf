terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.25.0, < 7.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6.0"
    }
  }
}

variable "env_name" {
  type = string
}

variable "app_name" {
  type    = string
  default = "securemind"
}

variable "api_base_url" {
  type    = string
  default = ""
}

variable "cognito_user_pool_id" {
  type = string
}

variable "cognito_user_pool_arn" {
  type = string
}

variable "cognito_client_id" {
  type = string
}

variable "cognito_region" {
  type = string
}

variable "cognito_issuer" {
  type = string
}

variable "auth_mode" {
  type    = string
  default = "cognito"
}

variable "fragments_table_name" {
  type    = string
  default = ""
}

variable "fragments_table_arn" {
  type    = string
  default = ""
}

variable "permissions_boundary_arn" {
  type        = string
  default     = ""
  description = "Optional permission boundary for the Amplify role. Required when the role is created from CI."
}

variable "access_contact_url" {
  type        = string
  default     = ""
  description = "Optional page that says how to ask for an invitation. Shown on the sign-in screen."
}

variable "vendor_keys_param_name" {
  type = string
}

variable "vendor_keys_param_arn" {
  type = string
}

variable "avatar_s3_bucket_name" {
  type = string
}

variable "branch_name" {
  type    = string
  default = "main"
}

variable "ssr_log_retention_days" {
  type        = number
  default     = 30
  description = "Days to keep the Next.js server logs (/aws/amplify/<app id>). Amplify creates the group with no expiry."
}

variable "transcribe_stream_region" {
  type        = string
  default     = ""
  description = "Region for direct live captions (the browser talks to Amazon Transcribe itself). Empty turns the feature off."
}

data "aws_iam_policy_document" "amplify_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["amplify.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "amplify" {
  name                 = "securemind-amplify-${var.env_name}"
  assume_role_policy   = data.aws_iam_policy_document.amplify_assume.json
  permissions_boundary = var.permissions_boundary_arn != "" ? var.permissions_boundary_arn : null
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

# Runtime role for the Next.js server (Amplify compute). Kept separate from the service role above
# so code running in the app does not inherit permission to manage Amplify itself.
resource "aws_iam_role" "compute" {
  name                 = "securemind-amplify-compute-${var.env_name}"
  assume_role_policy   = data.aws_iam_policy_document.amplify_assume.json
  permissions_boundary = var.permissions_boundary_arn != "" ? var.permissions_boundary_arn : null
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

resource "aws_iam_role_policy_attachment" "amplify" {
  role       = aws_iam_role.amplify.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess-Amplify"
}

# AdministratorAccess-Amplify does not include CloudWatch Logs. Without this,
# compute crashes (HTTP 500) leave `/aws/amplify/<app>` at 0 bytes.
data "aws_iam_policy_document" "amplify_logs" {
  statement {
    sid     = "AmplifySSRLogs"
    actions = ["logs:CreateLogGroup", "logs:DescribeLogGroups"]
    resources = [
      "arn:aws:logs:*:*:log-group:/aws/amplify/*",
    ]
  }
  statement {
    sid     = "AmplifySSRLogStreams"
    actions = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [
      "arn:aws:logs:*:*:log-group:/aws/amplify/*:log-stream:*",
    ]
  }
}

resource "aws_iam_role_policy" "amplify_logs" {
  name   = "securemind-amplify-logs-${var.env_name}"
  role   = aws_iam_role.compute.id
  policy = data.aws_iam_policy_document.amplify_logs.json
}

# First-run claim uses AdminCreateUser from Amplify compute (not Lambda).
data "aws_iam_policy_document" "amplify_cognito_admin" {
  statement {
    sid = "FirstAdminClaim"
    actions = [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:AdminResetUserPassword",
      "cognito-idp:AdminSetUserMFAPreference",
      "cognito-idp:AdminUserGlobalSignOut",
      "cognito-idp:ListUsers",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:AdminGetUser",
    ]
    resources = [var.cognito_user_pool_arn]
  }
}

resource "aws_iam_role_policy" "amplify_cognito_admin" {
  name   = "securemind-amplify-cognito-admin-${var.env_name}"
  role   = aws_iam_role.compute.id
  policy = data.aws_iam_policy_document.amplify_cognito_admin.json
}

# Hosted workspaces / sessions / messages live on the fragments table (app# partition).
data "aws_iam_policy_document" "amplify_dynamodb" {
  statement {
    sid = "HostedAppRecords"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:BatchWriteItem",
      "dynamodb:DescribeTable",
    ]
    resources = compact([
      var.fragments_table_arn,
      var.fragments_table_arn != "" ? "${var.fragments_table_arn}/index/*" : "",
    ])
  }
}

resource "aws_iam_role_policy" "amplify_dynamodb" {
  name   = "securemind-amplify-dynamodb-${var.env_name}"
  role   = aws_iam_role.compute.id
  policy = data.aws_iam_policy_document.amplify_dynamodb.json
}

# Catalog, Models → Test, image extract, and voice STT run on Amplify compute.
# Chat invoke stays on the API Lambda role. Attach to the existing Amplify
# role — operators do not create a second role by hand.
data "aws_iam_policy_document" "amplify_bedrock" {
  statement {
    sid    = "BedrockInvoke"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:*:*:inference-profile/*",
    ]
  }
  statement {
    sid    = "BedrockList"
    effect = "Allow"
    actions = [
      "bedrock:ListFoundationModels",
      "bedrock:GetFoundationModel",
      "bedrock:GetFoundationModelAvailability",
      "bedrock:ListInferenceProfiles",
      "transcribe:StartStreamTranscription",
    ]
    resources = ["*"]
  }
}

# Direct live captions. The browser opens its own WebSocket to Amazon Transcribe using an address the
# server signs with temporary credentials from THIS role, not from the compute role. It can do one
# thing: start a Transcribe streaming connection. The compute role may only assume it.
locals {
  direct_captions = var.transcribe_stream_region != ""
}

data "aws_iam_policy_document" "transcribe_stream_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.compute.arn]
    }
  }
}

resource "aws_iam_role" "transcribe_stream" {
  count                = local.direct_captions ? 1 : 0
  name                 = "securemind-transcribe-stream-${var.env_name}"
  description          = "Signs short-lived Amazon Transcribe streaming addresses for the browser. Nothing else."
  assume_role_policy   = data.aws_iam_policy_document.transcribe_stream_trust.json
  permissions_boundary = var.permissions_boundary_arn != "" ? var.permissions_boundary_arn : null
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

data "aws_iam_policy_document" "transcribe_stream" {
  statement {
    sid       = "OpenTranscribeStream"
    actions   = ["transcribe:StartStreamTranscriptionWebSocket"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "transcribe_stream" {
  count  = local.direct_captions ? 1 : 0
  name   = "securemind-transcribe-stream-${var.env_name}"
  role   = aws_iam_role.transcribe_stream[0].id
  policy = data.aws_iam_policy_document.transcribe_stream.json
}

data "aws_iam_policy_document" "amplify_assume_transcribe_stream" {
  count = local.direct_captions ? 1 : 0
  statement {
    sid       = "AssumeTranscribeStreamRole"
    actions   = ["sts:AssumeRole"]
    resources = [aws_iam_role.transcribe_stream[0].arn]
  }
}

resource "aws_iam_role_policy" "amplify_assume_transcribe_stream" {
  count  = local.direct_captions ? 1 : 0
  name   = "securemind-amplify-assume-transcribe-stream-${var.env_name}"
  role   = aws_iam_role.compute.id
  policy = data.aws_iam_policy_document.amplify_assume_transcribe_stream[0].json
}

resource "aws_iam_role_policy" "amplify_bedrock" {
  name   = "securemind-amplify-bedrock-${var.env_name}"
  role   = aws_iam_role.compute.id
  policy = data.aws_iam_policy_document.amplify_bedrock.json
}

data "aws_iam_policy_document" "amplify_vendor_keys" {
  statement {
    sid = "VendorKeysParameter"
    actions = [
      "ssm:GetParameter",
      "ssm:PutParameter",
    ]
    resources = [var.vendor_keys_param_arn]
  }
}

resource "aws_iam_role_policy" "amplify_vendor_keys" {
  name   = "securemind-amplify-vendor-keys-${var.env_name}"
  role   = aws_iam_role.compute.id
  policy = data.aws_iam_policy_document.amplify_vendor_keys.json
}

data "aws_iam_policy_document" "amplify_avatars" {
  statement {
    sid = "ProfilePhotos"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${var.avatar_s3_bucket_name}/*"]
  }
  statement {
    sid       = "ProfilePhotosList"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.avatar_s3_bucket_name}"]
  }
}

resource "aws_iam_role_policy" "amplify_avatars" {
  name   = "securemind-amplify-avatars-${var.env_name}"
  role   = aws_iam_role.compute.id
  policy = data.aws_iam_policy_document.amplify_avatars.json
}

resource "random_id" "instance_encryption" {
  byte_length = 32
}

# Printed once via `terraform output -raw setup_claim_secret`. Never put on the public page.
resource "random_password" "setup_claim" {
  length  = 32
  special = false
}

# The instance encryption key and the first-run setup code used to be plain Amplify
# environment variables, readable by anyone with console access. They now live in one
# Parameter Store SecureString (a standard parameter has no monthly charge) that only the
# Amplify compute role can read. The values are the same random resources as before, so
# nothing is rotated and stored vendor keys stay readable. The app loads the parameter at
# startup (src/instrumentation.ts).
resource "aws_ssm_parameter" "app_secrets" {
  name        = "/securemind/${var.env_name}/app-secrets"
  description = "Instance encryption key and first-run setup code. Read by the Amplify compute role only."
  type        = "SecureString"
  value = jsonencode({
    instanceEncryptionKey = random_id.instance_encryption.hex
    setupClaimSecret      = random_password.setup_claim.result
  })
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

data "aws_iam_policy_document" "amplify_app_secrets" {
  statement {
    sid       = "ReadAppSecrets"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.app_secrets.arn]
  }
}

resource "aws_iam_role_policy" "amplify_app_secrets" {
  name   = "securemind-amplify-app-secrets-${var.env_name}"
  role   = aws_iam_role.compute.id
  policy = data.aws_iam_policy_document.amplify_app_secrets.json
}

resource "aws_amplify_app" "this" {
  name                 = "${var.app_name}-${var.env_name}"
  description          = "SecureMind UI (API stays on API Gateway + Lambda)"
  platform             = "WEB_COMPUTE"
  iam_service_role_arn = aws_iam_role.amplify.arn
  # Distinct from the service role: injected into Next.js compute. It has no Amplify management rights.
  compute_role_arn = aws_iam_role.compute.arn

  # The repository's amplify.yml is the one build spec; Amplify reads that file at build time anyway.
  build_spec = file("${path.module}/../../../../amplify.yml")

  environment_variables = merge({
    AUTH_MODE                 = var.auth_mode
    AUTH_ALLOW_LOCAL_FALLBACK = "false"
    COGNITO_USER_POOL_ID      = var.cognito_user_pool_id
    COGNITO_CLIENT_ID         = var.cognito_client_id
    COGNITO_REGION            = var.cognito_region
    COGNITO_ISSUER            = var.cognito_issuer
    NEXT_PUBLIC_API_BASE_URL  = var.api_base_url
    SECUREMIND_EDITION        = "cloud"
    STORAGE_BACKEND           = "dynamodb"
    APP_SECRETS_PARAM         = aws_ssm_parameter.app_secrets.name
    DYNAMODB_FRAGMENTS_TABLE  = var.fragments_table_name
    VENDOR_KEYS_PARAM         = var.vendor_keys_param_name
    AVATAR_S3_BUCKET          = var.avatar_s3_bucket_name
    }, var.access_contact_url != "" ? { NEXT_PUBLIC_ACCESS_CONTACT_URL = var.access_contact_url } : {},
    local.direct_captions ? {
      TRANSCRIBE_STREAM_ROLE_ARN = aws_iam_role.transcribe_stream[0].arn
      TRANSCRIBE_STREAM_REGION   = var.transcribe_stream_region
  } : {})

  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }

  # Operator connects GitHub in the Amplify console (GitHub App). Never store a PAT here.
  lifecycle {
    ignore_changes = [repository, access_token, oauth_token]
  }
}

# Amplify writes the server logs here. Managing the group sets an expiry; an install that already
# has it imports it once (infra/README.md, "Server logs").
resource "aws_cloudwatch_log_group" "ssr" {
  name              = "/aws/amplify/${aws_amplify_app.this.id}"
  retention_in_days = var.ssr_log_retention_days
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

output "app_id" {
  value = aws_amplify_app.this.id
}

output "default_domain" {
  value = aws_amplify_app.this.default_domain
}

output "console_url" {
  value = "https://console.aws.amazon.com/amplify/home#/${aws_amplify_app.this.id}"
}

output "branch_name" {
  value = var.branch_name
}

output "app_secrets_param_name" {
  value = aws_ssm_parameter.app_secrets.name
}

output "setup_claim_secret" {
  value     = random_password.setup_claim.result
  sensitive = true
}
