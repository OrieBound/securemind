import type { NextConfig } from "next";
import { securityHeaders, securityOptionsFromEnv } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Standalone for Docker and Amplify WEB_COMPUTE. Skipping it got under
  // 220 MB but left compute unable to boot (HTTP 500, empty body).
  output: "standalone",

  // Move the dev-tools badge away from the sidebar (default is bottom-left which
  // overlaps the sidebar Settings button). Use bottom-right instead.
  // The badge cannot be fully hidden while the slow-filesystem warning is active.
  // Run scripts\fix-defender.ps1 as Administrator once to silence that warning,
  // then set devIndicators: false to hide the badge entirely.
  devIndicators: { position: "bottom-right" },

  // Turbopack file-system cache is disabled (in-memory only).
  // D:\ benchmarks at ~200ms which triggers Next.js's "slow filesystem" warning
  // and causes cache files to land in C:\Temp, breaking cross-drive resolution.
  // In-memory cache = same incremental speed, zero disk I/O overhead, no warning.
  // To re-enable disk caching: add D:\Projects\web\securemind and its
  // node_modules/.next sub-folders to Windows Defender exclusions (run
  // scripts\fix-defender.ps1 as Administrator), then flip the flag back to true.
  distDir: ".next",

  // pdf-parse uses require() + fs.readdirSync internally to load test fixtures.
  // If webpack bundles it, those fs calls fail. Marking it external means Node.js
  // loads it directly from node_modules at runtime instead — correct behaviour.
  serverExternalPackages: ["pdf-parse", "mammoth", "exceljs"],

  // Amplify Hosting compute is capped at 220 MB. Keep build-only natives and
  // repo trees that are not the Next server out of the traced bundle.
  outputFileTracingExcludes: {
    "/*": [
      "infra/**",
      "tests/**",
      "docs/**",
      "lambda/**",
      "scripts/**",
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "Dockerfile",
      "docker-compose.yml",
      "amplify.yml",
      "node_modules/esbuild/**",
      "node_modules/@esbuild/**",
      "node_modules/@swc/core/**",
      "node_modules/@swc/core-linux-x64-gnu/**",
      "node_modules/@swc/core-linux-x64-musl/**",
      "node_modules/typescript/**",
      "node_modules/eslint/**",
      "node_modules/@next/swc-linux-x64-gnu/**",
      "node_modules/@next/swc-linux-x64-musl/**",
    ],
    "/api/**": [
      "infra/**",
      "tests/**",
      "docs/**",
      "lambda/**",
      "scripts/**",
      "node_modules/esbuild/**",
      "node_modules/@esbuild/**",
      "node_modules/@swc/core/**",
    ],
  },

  experimental: {
    turbopackFileSystemCacheForDev: false,
  },

  // Security headers on every response: a Content-Security-Policy that limits what the
  // page can load and connect to, clickjacking and sniffing protection, a strict referrer
  // policy, and HSTS on the cloud edition. See src/lib/security-headers.ts for what the
  // policy does and does not cover.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(securityOptionsFromEnv()) }];
  },
};

export default nextConfig;
