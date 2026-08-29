#!/usr/bin/env node
/** Validate Terraform (local only — no AWS apply). */

import path from "node:path";
import { ROOT, TF_DIR, run, terraform } from "./lib.mjs";

run("node", [path.join(ROOT, "infra/scripts/package-lambda.mjs")]);
terraform(["fmt", "-recursive", "-check"]);
terraform(["init", "-backend=false", "-input=false"]);
terraform(["validate"]);
console.log(`OK ${path.relative(ROOT, TF_DIR)}`);
