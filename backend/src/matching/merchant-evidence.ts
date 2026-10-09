import { eq } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { merchantAliases, merchants } from "../db/schema.js";
import { normalizeAlias } from "./alias-normalizer.js";

// Interface for a merchant candidate.
export interface MerchantCandidate {
  merchantId: number;
  name: string;
}

/**
 * Collect exact alias and canonical-name evidence without choosing an identity.
 * @param db - The database connection to use for queries.
 * @param rawName - The raw alias name to look up.
 * @param canonicalName - The canonical name to look up.
 * @returns An object containing aliases, names, candidates, and conflict status.
 */
export function findMerchantEvidence(
  db: Pick<Database, "select">,
  rawName: string | null,
  canonicalName: string | null,
) {
  const raw = normalizeAlias(rawName ?? "");
  const canonical = normalizeAlias(canonicalName ?? "");
  const aliases = raw
    ? db
        .select({ merchantId: merchants.id, name: merchants.name })
        .from(merchantAliases)
        .innerJoin(merchants, eq(merchantAliases.merchantId, merchants.id))
        .where(eq(merchantAliases.normalizedAlias, raw))
        .all()
    : [];
  const uniqueAliases = uniqueMerchants(aliases);
  const names = canonical
    ? db
        .select({ merchantId: merchants.id, name: merchants.name })
        .from(merchants)
        .all()
        .filter((row) => normalizeAlias(row.name) === canonical)
    : [];
  const candidates = uniqueMerchants([...uniqueAliases, ...names]);
  const conflict =
    uniqueAliases.length > 1 ||
    names.length > 1 ||
    (uniqueAliases.length === 1 &&
      names.length === 1 &&
      uniqueAliases[0].merchantId !== names[0].merchantId);
  return { aliases: uniqueAliases, names, candidates, conflict };
}

function uniqueMerchants(rows: MerchantCandidate[]): MerchantCandidate[] {
  return [...new Map(rows.map((row) => [row.merchantId, row])).values()];
}
