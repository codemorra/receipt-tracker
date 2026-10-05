import { eq } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { merchantAliases, merchants } from "../db/schema.js";
import { normalizeAlias } from "./alias-normalizer.js";

// Interface and function for matching merchants based on normalized aliases.
export interface MerchantMatch {
  status: "MATCHED" | "SUGGESTED" | "NEW";
  merchantId: number | null;
  candidates: { merchantId: number; name: string }[];
}

/**
 * Matches a merchant based on the provided raw name by normalizing it and checking against known aliases and merchant names.
 * @param db - The database instance to use for querying merchants and aliases.
 * @param rawName - The raw name of the merchant to match.
 * @returns An object representing the match status, the matched merchant ID if applicable, and candidate merchants.
 */
export function matchMerchant(
  db: Database,
  rawName: string | null,
): MerchantMatch {
  const normalized = normalizeAlias(rawName ?? "");
  if (!normalized) return { status: "NEW", merchantId: null, candidates: [] };

  const aliases = db
    .select({ merchantId: merchants.id, name: merchants.name })
    .from(merchantAliases)
    .innerJoin(merchants, eq(merchantAliases.merchantId, merchants.id))
    .where(eq(merchantAliases.normalizedAlias, normalized))
    .all();
  const uniqueAliases = [
    ...new Map(aliases.map((row) => [row.merchantId, row])).values(),
  ];
  if (uniqueAliases.length === 1) {
    return {
      status: "MATCHED",
      merchantId: uniqueAliases[0].merchantId,
      candidates: uniqueAliases,
    };
  }
  if (uniqueAliases.length > 1) {
    return { status: "SUGGESTED", merchantId: null, candidates: uniqueAliases };
  }

  const names = db
    .select({ merchantId: merchants.id, name: merchants.name })
    .from(merchants)
    .all();
  const candidates = names.filter(
    (row) => normalizeAlias(row.name) === normalized,
  );
  return {
    status: candidates.length ? "SUGGESTED" : "NEW",
    merchantId: null,
    candidates,
  };
}
