import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  serverExternalPackages: ["pdf-parse", "mammoth"],

  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
