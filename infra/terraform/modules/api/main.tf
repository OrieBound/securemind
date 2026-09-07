terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.25.0, < 7.0.0"
    }
  }
}

variable "env_name" {
  type = string
}

variable "allowed_origin" {
  type    = string
  default = "http://localhost:3000"
}

variable "chat_zip_path" {
  type = string
}

variable "warm_zip_path" {
  type = string
}

variable "fragments_table_name" {
  type = string
}

variable "fragments_table_arn" {
  type = string
}

variable "fragments_secret_arn" {
  type = string
}

variable "groq_secret_arn" {
  type    = string
  default = ""
}

variable "vendor_keys_secret_arn" {
  type    = string
  default = ""
}

variable "auth_mode" {
  type    = string
  default = "cognito"
}

variable "cognito_user_pool_id" {
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

variable "embed_provider" {
  type    = string
  default = "bedrock"
}

variable "embed_dimensions" {
  type    = string
  default = "1024"
}

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "avatars" {
  bucket = "securemind-avatars-${var.env_name}-${data.aws_caller_identity.current.account_id}"
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

resource "aws_s3_bucket_public_access_block" "avatars" {
  bucket                  = aws_s3_bucket.avatars.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "avatars" {
  bucket = aws_s3_bucket.avatars.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_ownership_controls" "avatars" {
  bucket = aws_s3_bucket.avatars.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

locals {
  env_vars = {
    NODE_OPTIONS               = "--enable-source-maps"
    DATABASE_MODE              = "dynamodb"
    STORAGE_BACKEND            = "dynamodb"
    AUTH_MODE                  = var.auth_mode
    AUTH_ALLOW_LOCAL_FALLBACK  = "false"
    COGNITO_USER_POOL_ID       = var.cognito_user_pool_id
    COGNITO_CLIENT_ID          = var.cognito_client_id
    COGNITO_REGION             = var.cognito_region
    COGNITO_ISSUER             = var.cognito_issuer
    EMBED_PROVIDER             = var.embed_provider
    EMBED_DIMENSIONS           = var.embed_dimensions
    ALLOWED_ORIGIN             = var.allowed_origin
    DOCUMENT_INGEST_SYNC       = "true"
    ENV_NAME                   = var.env_name
    DYNAMODB_FRAGMENTS_TABLE   = var.fragments_table_name
    FRAGMENTS_TABLE_SECRET_ARN = var.fragments_secret_arn
    GROQ_SECRET_ARN            = var.groq_secret_arn
    VENDOR_KEYS_SECRET_ARN     = var.vendor_keys_secret_arn
    AVATAR_S3_BUCKET           = aws_s3_bucket.avatars.bucket
    SECUREMIND_EDITION         = "cloud"
  }
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "securemind-api-${var.env_name}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda" {
  name = "securemind-api-${var.env_name}"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Effect = "Allow"
          Action = [
            "bedrock:InvokeModel",
            "bedrock:InvokeModelWithResponseStream",
            "bedrock:ListFoundationModels",
            "bedrock:GetFoundationModel",
            "bedrock:GetFoundationModelAvailability",
            "bedrock:ListInferenceProfiles",
          ]
          Resource = "*"
        },
        {
          Effect = "Allow"
          Action = [
            "dynamodb:PutItem",
            "dynamodb:GetItem",
            "dynamodb:Query",
            "dynamodb:DeleteItem",
            "dynamodb:DescribeTable",
            "dynamodb:SearchVectors",
          ]
          Resource = [
            var.fragments_table_arn,
            "${var.fragments_table_arn}/index/*",
          ]
        },
        {
          Effect   = "Allow"
          Action   = ["secretsmanager:GetSecretValue"]
          Resource = compact([var.fragments_secret_arn, var.groq_secret_arn, var.vendor_keys_secret_arn])
        },
        {
          Effect = "Allow"
          Action = [
            "s3:GetObject",
            "s3:PutObject",
            "s3:DeleteObject",
          ]
          Resource = "arn:aws:s3:::${aws_s3_bucket.avatars.bucket}/*"
        },
        {
          Effect   = "Allow"
          Action   = ["s3:ListBucket"]
          Resource = "arn:aws:s3:::${aws_s3_bucket.avatars.bucket}"
        },
      ],
    )
  })
}

resource "aws_cloudwatch_log_group" "chat" {
  name              = "/aws/lambda/securemind-chat-${var.env_name}"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "warm" {
  name              = "/aws/lambda/securemind-warm-${var.env_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "warm" {
  function_name    = "securemind-warm-${var.env_name}"
  role             = aws_iam_role.lambda.arn
  filename         = var.warm_zip_path
  source_code_hash = filebase64sha256(var.warm_zip_path)
  handler          = "handler.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 10
  memory_size      = 128
  environment {
    variables = local.env_vars
  }
  depends_on = [aws_cloudwatch_log_group.warm]
}

resource "aws_lambda_function" "chat" {
  function_name    = "securemind-chat-${var.env_name}"
  role             = aws_iam_role.lambda.arn
  filename         = var.chat_zip_path
  source_code_hash = filebase64sha256(var.chat_zip_path)
  handler          = "handler.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  timeout          = 300
  memory_size      = 1536
  environment {
    variables = local.env_vars
  }
  depends_on = [aws_cloudwatch_log_group.chat]
}

resource "aws_api_gateway_rest_api" "this" {
  name = "securemind-api-${var.env_name}"
  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_resource" "chat" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "chat"
}

resource "aws_api_gateway_resource" "warm" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "warm"
}

resource "aws_api_gateway_method" "chat_post" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.chat.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "chat_options" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.chat.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "warm_any" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.warm.id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "chat_post" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.chat.id
  http_method             = aws_api_gateway_method.chat_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.chat.response_streaming_invoke_arn
  response_transfer_mode  = "STREAM"
  timeout_milliseconds    = 290000
}

resource "aws_api_gateway_integration" "chat_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.chat.id
  http_method = aws_api_gateway_method.chat_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = jsonencode({ statusCode = 200 })
  }
}

resource "aws_api_gateway_method_response" "chat_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.chat.id
  http_method = aws_api_gateway_method.chat_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "chat_options" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.chat.id
  http_method = aws_api_gateway_method.chat_options.http_method
  status_code = aws_api_gateway_method_response.chat_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.allowed_origin}'"
  }
  depends_on = [aws_api_gateway_integration.chat_options]
}

resource "aws_api_gateway_integration" "warm" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.warm.id
  http_method             = aws_api_gateway_method.warm_any.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = "arn:aws:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${aws_lambda_function.warm.arn}/invocations"
}

resource "aws_lambda_permission" "chat_invoke" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.chat.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*"
}

resource "aws_lambda_permission" "chat_stream" {
  statement_id  = "AllowApiGatewayStream"
  action        = "lambda:InvokeFunctionWithResponseStream"
  function_name = aws_lambda_function.chat.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*"
}

resource "aws_lambda_permission" "warm" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.warm.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*"
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.chat.id,
      aws_api_gateway_resource.warm.id,
      aws_api_gateway_method.chat_post.id,
      aws_api_gateway_method.chat_options.id,
      aws_api_gateway_method.warm_any.id,
      aws_api_gateway_integration.chat_post.id,
      aws_api_gateway_integration.chat_options.id,
      aws_api_gateway_integration_response.chat_options.id,
      aws_api_gateway_integration.warm.id,
    ]))
  }
  lifecycle {
    create_before_destroy = true
  }
  depends_on = [
    aws_api_gateway_integration.chat_post,
    aws_api_gateway_integration.chat_options,
    aws_api_gateway_integration.warm,
  ]
}

resource "aws_api_gateway_stage" "prod" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = "prod"
}

output "api_base_url" {
  value = "https://${aws_api_gateway_rest_api.this.id}.execute-api.${data.aws_region.current.name}.amazonaws.com/${aws_api_gateway_stage.prod.stage_name}"
}

output "chat_function_name" {
  value = aws_lambda_function.chat.function_name
}

output "warm_function_name" {
  value = aws_lambda_function.warm.function_name
}

output "avatar_bucket_name" {
  value = aws_s3_bucket.avatars.bucket
}

output "avatar_bucket_arn" {
  value = aws_s3_bucket.avatars.arn
}

output "chat_function_arn" {
  value = aws_lambda_function.chat.arn
}
