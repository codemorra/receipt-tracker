import { eq } from "drizzle-orm";
import type { Database } from "../db/database.js";
import {
  brands,
  productAliases,
  productGroups,
  products,
} from "../db/schema.js";
import type { ReceiptExtraction } from "../extraction/receipt-extraction.js";
import { normalizeAlias } from "./alias-normalizer.js";

type Item = ReceiptExtraction["items"][number];

// Interface representing a row in the products table along with related brand and product group information.
type ProductRow = {
  productId: number;
  name: string;
  brand: string | null;
  productGroup: string;
  packageAmount: number | null;
  packageUnit: string | null;
};

// Interface and function for matching products based on normalized aliases and other attributes.
export interface ProductCandidate extends ProductRow {
  score: number;
}

// Interface and function for representing the result of a product match.
export interface ProductMatch {
  status: "MATCHED" | "SUGGESTED" | "NEW";
  productId: number | null;
  candidates: ProductCandidate[];
}

// Interface for specifying options when matching products.
export interface ProductMatchOptions {
  minimumScore?: number;
  minimumMargin?: number;
}

function normalizedPackage(
  amount: number | null,
  unit: string | null,
): string | null {
  if (amount === null || unit === null) return null;
  if (unit === "kg" || unit === "l")
    return `${amount * 1000} ${unit === "kg" ? "g" : "ml"}`;
  return `${amount} ${unit}`;
}

function nameSimilarity(left: string, right: string): number {
  const leftName = normalizeAlias(left);
  const rightName = normalizeAlias(right);
  if (!leftName || !rightName) return 0;
  if (leftName === rightName) return 1;
  const leftTokens = new Set(leftName.split(" "));
  const rightTokens = new Set(rightName.split(" "));
  const shared = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  return shared / (leftTokens.size + rightTokens.size - shared);
}

function scoreProduct(item: Item, product: ProductRow): number | null {
  if (
    item.brand &&
    product.brand &&
    normalizeAlias(item.brand) !== normalizeAlias(product.brand)
  )
    return null;
  const itemPackage = normalizedPackage(item.packageAmount, item.packageUnit);
  const productPackage = normalizedPackage(
    product.packageAmount,
    product.packageUnit,
  );
  if (itemPackage && productPackage && itemPackage !== productPackage)
    return null;

  let score =
    nameSimilarity(item.normalizedName ?? item.rawName, product.name) * 0.6;
  let availableWeight = 0.6;
  if (item.brand && product.brand) {
    score += 0.15;
    availableWeight += 0.15;
  }
  if (item.productGroup && product.productGroup) {
    score += nameSimilarity(item.productGroup, product.productGroup) * 0.15;
    availableWeight += 0.15;
  }
  if (itemPackage && productPackage) {
    score += 0.1;
    availableWeight += 0.1;
  }
  return score / availableWeight;
}

export function matchProduct(
  db: Database,
  item: Item,
  options: ProductMatchOptions = {},
): ProductMatch {
  if (item.lineType !== "product")
    return { status: "NEW", productId: null, candidates: [] };

  const rows = db
    .select({
      productId: products.id,
      name: products.name,
      brand: brands.name,
      productGroup: productGroups.name,
      packageAmount: products.packageAmount,
      packageUnit: products.packageUnit,
    })
    .from(products)
    .innerJoin(productGroups, eq(products.productGroupId, productGroups.id))
    .leftJoin(brands, eq(products.brandId, brands.id))
    .all();
  const candidates = rows
    .map((row) => ({ row, score: scoreProduct(item, row) }))
    .filter(
      (candidate): candidate is { row: ProductRow; score: number } =>
        candidate.score !== null,
    )
    .map(({ row, score }) => ({ ...row, score }))
    .sort(
      (left, right) =>
        right.score - left.score || left.productId - right.productId,
    );

  const normalized = normalizeAlias(item.rawName);
  const aliasIds = normalized
    ? new Set(
        db
          .select({ productId: productAliases.productId })
          .from(productAliases)
          .where(eq(productAliases.normalizedAlias, normalized))
          .all()
          .map((row) => row.productId),
      )
    : new Set<number>();
  const aliasCandidates = candidates.filter((candidate) =>
    aliasIds.has(candidate.productId),
  );
  if (aliasCandidates.length === 1) {
    return {
      status: "MATCHED",
      productId: aliasCandidates[0].productId,
      candidates: aliasCandidates,
    };
  }

  const minimumScore = options.minimumScore ?? 0.85;
  const minimumMargin = options.minimumMargin ?? 0.1;
  if (
    candidates[0] &&
    candidates[0].score >= minimumScore &&
    candidates[0].score - (candidates[1]?.score ?? 0) >= minimumMargin
  ) {
    return { status: "SUGGESTED", productId: null, candidates };
  }
  return { status: "NEW", productId: null, candidates };
}
