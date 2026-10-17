# One static website: a private S3 bucket behind CloudFront, an HTTPS certificate, DNS records,
# and a role GitHub Actions can assume (OIDC, no stored keys) to upload files and clear the cache.
# Off unless the root module is given a `static_sites` entry. Nothing here knows about any one site.

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = ">= 6.25.0, < 7.0.0"
      configuration_aliases = [aws.cloudfront_cert]
    }
  }
}

variable "name" {
  type        = string
  description = "Short name for this site, used in resource names (for example marketing, sample)."
}

variable "env_name" {
  type = string
}

variable "zone_id" {
  type        = string
  description = "Route53 hosted zone that holds every host name in aliases."
}

variable "aliases" {
  type        = list(string)
  description = "Host names served by this site. The first is the main address."
  validation {
    condition     = length(var.aliases) > 0
    error_message = "Give at least one host name."
  }
}

variable "redirect_others_to_first" {
  type        = bool
  default     = false
  description = "Send every other alias (such as www) to the first one with a 301. The path is kept."
}

variable "github_subject_prefix" {
  type        = string
  description = "Repository part of the GitHub OIDC subject, for example repo:owner@123/name@456. Read it with: gh api repos/OWNER/REPO/actions/oidc/customization/sub"
}

variable "github_branch" {
  type    = string
  default = "main"
}

# Names of resources that already exist and are being brought under Terraform (see the import
# steps in docs/deploy/static-sites.md). Leave empty for a new site. Names cannot change in place
# for some of these, so adopting under the old name avoids replacing them.
variable "existing" {
  type = object({
    bucket_name   = optional(string)
    role_name     = optional(string)
    function_name = optional(string)
    oac_name      = optional(string)
  })
  default = {}
}

variable "oidc_provider_arn" {
  type        = string
  description = "ARN of the account's GitHub OIDC provider (token.actions.githubusercontent.com)."
}

locals {
  primary = var.aliases[0]
  prefix  = "securemind-${var.env_name}-${var.name}"
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
    Site    = var.name
  }
}

data "aws_caller_identity" "current" {}

# --- Bucket ------------------------------------------------------------------------------------

resource "aws_s3_bucket" "site" {
  bucket = coalesce(var.existing.bucket_name, "${local.prefix}-${data.aws_caller_identity.current.account_id}")
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.site.arn, "${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.site.id
  policy     = data.aws_iam_policy_document.bucket.json
  depends_on = [aws_s3_bucket_public_access_block.site]
}

# --- Certificate (CloudFront only reads certificates from us-east-1) ---------------------------

resource "aws_acm_certificate" "site" {
  provider                  = aws.cloudfront_cert
  domain_name               = local.primary
  subject_alternative_names = slice(var.aliases, 1, length(var.aliases))
  validation_method         = "DNS"
  tags                      = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.site.domain_validation_options : o.domain_name => {
      name   = o.resource_record_name
      type   = o.resource_record_type
      record = o.resource_record_value
    }
  }
  zone_id         = var.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  provider                = aws.cloudfront_cert
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

# --- CloudFront --------------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = coalesce(var.existing.oac_name, "${local.prefix}-oac")
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Maps /about and /about/ onto about/index.html (URIs with a file extension pass through).
# With redirect_others_to_first, any host other than the main one gets a 301 to the main one.
locals {
  redirect_js = !var.redirect_others_to_first ? "" : join("\n", [
    "  var host = request.headers.host ? request.headers.host.value : '';",
    "  if (host !== '${local.primary}') {",
    "    var qs = Object.keys(request.querystring).map(function (k) {",
    "      var q = request.querystring[k];",
    "      return q.value === '' ? k : k + '=' + q.value;",
    "    }).join('&');",
    "    return {",
    "      statusCode: 301,",
    "      statusDescription: 'Moved Permanently',",
    "      headers: { location: { value: 'https://${local.primary}' + uri + (qs ? '?' + qs : '') } }",
    "    };",
    "  }",
  ])
}

resource "aws_cloudfront_function" "rewrite" {
  name    = coalesce(var.existing.function_name, "${local.prefix}-rewrite")
  runtime = "cloudfront-js-2.0"
  publish = true
  comment = "Serve index.html for static export routes."
  code = join("\n", [
    "function handler(event) {",
    "  var request = event.request;",
    "  var uri = request.uri;",
    local.redirect_js,
    "  if (uri.charAt(uri.length - 1) === '/') {",
    "    request.uri = uri + 'index.html';",
    "  } else if (uri.split('/').pop().indexOf('.') === -1) {",
    "    request.uri = uri + '/index.html';",
    "  }",
    "  return request;",
    "}",
  ])
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  price_class         = "PriceClass_100"
  default_root_object = "index.html"
  aliases             = var.aliases
  comment             = "SecureMind ${var.name} site (${var.env_name})"
  tags                = local.tags

  origin {
    origin_id                = "site-bucket"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "site-bucket"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # Managed: CachingOptimized, and SecurityHeadersPolicy.
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    response_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.rewrite.arn
    }
  }

  # A private bucket answers 403 for a missing key.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 10
  }
  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# --- DNS ---------------------------------------------------------------------------------------

resource "aws_route53_record" "alias_a" {
  for_each        = toset(var.aliases)
  zone_id         = var.zone_id
  name            = each.value
  type            = "A"
  allow_overwrite = true
  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_aaaa" {
  for_each        = toset(var.aliases)
  zone_id         = var.zone_id
  name            = each.value
  type            = "AAAA"
  allow_overwrite = true
  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

# --- GitHub deploy role ------------------------------------------------------------------------

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_subject_prefix}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "ListBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
  }
  statement {
    sid       = "WriteObjects"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
  }
  statement {
    sid       = "Invalidate"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
}

resource "aws_iam_role" "deploy" {
  name                 = coalesce(var.existing.role_name, "${local.prefix}-github-deploy")
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600
  tags                 = local.tags
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy-site"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

output "site_url" {
  value = "https://${local.primary}"
}

output "bucket_name" {
  value = aws_s3_bucket.site.id
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}
