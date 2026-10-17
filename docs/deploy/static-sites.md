# Static websites (marketing page, demo)

The hosted edition can also serve plain static sites from the same domain: a marketing page, a demo, a docs site. Each one gets a private S3 bucket behind CloudFront, its own HTTPS certificate, DNS records in your Route53 zone, and an IAM role that one GitHub repository can use to upload files. There are no stored keys.

It is off unless you set `static_sites`. It needs the Route53 zone from [custom-domain.md](custom-domain.md).

## Add a site

1. Build the site as static files (for Next.js, `output: "export"`), and give its repository a deploy workflow that syncs the output folder to S3 and clears the CloudFront cache. The `securemind-sample` repository has one.
2. Read the repository's GitHub subject: `gh api repos/OWNER/REPO/actions/oidc/customization/sub` (use `sub_claim_prefix`).
3. Add it to `static_sites` in your tfvars (see `infra/terraform/domain.tfvars.example`). The first alias is the main address. With `redirect_others_to_first = true`, the others (such as `www`) redirect to it.
4. Apply Terraform. The `static_sites` output lists, per site, the four values to put in that repository's Actions variables: `AWS_REGION`, `AWS_ROLE_ARN` (`role_arn`), `S3_BUCKET` (`s3_bucket`) and `CLOUDFRONT_DISTRIBUTION_ID` (`distribution_id`).
5. Push to the repository. The workflow publishes the site.

Day to day you only push files. Run Terraform again only when the infrastructure changes.

## Bring an existing site under Terraform

If the same bucket and distribution were built some other way, such as an earlier CloudFormation stack, Terraform can adopt them instead of creating a second copy:

1. Set `existing` on the site (`bucket_name`, `role_name`, `function_name`, `oac_name`) so Terraform uses the current names. Some of these cannot be renamed in place.
2. Write temporary `import` blocks for each resource in a git-ignored `import-<site>.tf`.
3. If CloudFormation owns the resources, first mark them `DeletionPolicy: Retain` and delete the stack, so deleting the stack leaves them in place.
4. Plan and read it. Expect imports and in-place updates, with no deletes or replacements. Apply, then delete the import file.
