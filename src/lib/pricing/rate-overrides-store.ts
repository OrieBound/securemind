/**
 * Persist list-rate overrides without a Prisma migration:
 * hosted Dynamo InstanceConfig JSON, local `.data/pricing-overrides.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hostedInstanceConfig } from "@/lib/instance-config-hosted";
import { isHostedRuntime } from "@/lib/runtime-env";
import { parseRateOverrides, type RateOverrideMap } from "./rate-overrides";

function localOverridesPath(): string {
  if (process.env.PRICING_OVERRIDES_FILE?.trim()) {
    return process.env.PRICING_OVERRIDES_FILE.trim();
  }
  return join(".data", "pricing-overrides.json");
}

function readLocalOverridesFile(): RateOverrideMap {
  const file = localOverridesPath();
  if (!existsSync(file)) return {};
  try {
    return parseRateOverrides(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

function writeLocalOverridesFile(map: RateOverrideMap): void {
  const file = localOverridesPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

export async function getPricingRateOverrides(): Promise<RateOverrideMap> {
  try {
    if (isHostedRuntime()) {
      const row = await hostedInstanceConfig().get();
      return parseRateOverrides(row?.pricingRateOverrides);
    }
    return readLocalOverridesFile();
  } catch {
    return {};
  }
}

export async function savePricingRateOverrides(
  map: RateOverrideMap,
  updatedByUserId: string,
): Promise<RateOverrideMap> {
  if (isHostedRuntime()) {
    const row = await hostedInstanceConfig().merge({
      pricingRateOverrides: map,
      updatedByUserId,
    });
    return parseRateOverrides(row.pricingRateOverrides);
  }
  writeLocalOverridesFile(map);
  return map;
}
