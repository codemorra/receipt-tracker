export type MatchStatus = "MATCHED" | "SUGGESTED" | "NEW";
export type Unit = "pcs" | "g" | "kg" | "ml" | "l";
export type LineType = "product" | "deposit" | "fee" | "other";
export type WarrantyType = "statutory" | "manufacturer" | "extended";

// Types and interfaces for handling duplicate candidates in the receipt review process.
export interface DuplicateCandidate {
  receiptId: number;
  merchantId: number;
  merchantName: string;
  purchaseDate: string;
  purchaseTime: string | null;
  totalCents: number;
  currency: string;
  imagePath: string;
  items: {
    position: number;
    rawName: string;
    quantity: number;
    unit: string | null;
    unitPriceCents: number | null;
    totalPriceCents: number;
    lineType: string;
    productId: number | null;
  }[];
}

// Types and interfaces for managing the state of the receipt review process.
export interface ReviewDto {
  scanId: string;
  archiveUrl: string;
  merchant: {
    rawName: string | null;
    normalizedName: string | null;
    match: {
      status: MatchStatus;
      merchantId: number | null;
      candidates: { merchantId: number; name: string }[];
    };
  };
  purchaseDate: string | null;
  purchaseTime: string | null;
  currency: string | null;
  totalCents: number | null;
  items: {
    rawName: string;
    normalizedName: string | null;
    brand: string | null;
    productGroup: string | null;
    category: string | null;
    packageAmount: number | null;
    packageUnit: Unit | null;
    quantity: number;
    unit: Unit | null;
    unitPriceCents: number | null;
    totalPriceCents: number | null;
    lineType: LineType;
    sourceLineIndexes: number[];
    match: {
      status: MatchStatus;
      productId: number | null;
      candidates: {
        productId: number;
        name: string;
        brand: string | null;
        productGroup: string;
        packageAmount: number | null;
        packageUnit: string | null;
        score: number;
      }[];
    } | null;
  }[];
  discounts: {
    rawName: string;
    description: string | null;
    amountCents: number;
    appliesToItemIndex: number | null;
    sourceLineIndexes: number[];
  }[];
  duplicateCandidates: DuplicateCandidate[];
  warnings: ("possible_duplicate" | "sum_mismatch" | "sum_incomplete")[];
}

// Draft representation of a warranty within the review process.
export interface WarrantyDraft {
  id: string;
  type: WarrantyType;
  startDate: string;
  endDate: string;
  notes: string;
}

// Draft representation of a product selection within the review process.
export interface ProductSelection {
  id: number;
  name: string;
  brandName?: string | null;
  productGroupName?: string;
  categoryName?: string;
  packageAmount?: number | null;
  packageUnit?: string | null;
}

// Draft representation of an item within the review process.
export interface ItemDraft {
  id: string;
  rawName: string;
  normalizedName: string;
  productId: number | null;
  selectedProductName: string | null;
  selectedProductDetails?: Omit<ProductSelection, "id" | "name"> | null;
  matchStatus: MatchStatus | null;
  matchCandidates: ReviewDto["items"][number]["match"];
  brand: string;
  brandId: number | null;
  productGroup: string;
  productGroupId: number | null;
  category: string;
  packageAmount: string;
  packageUnit: Unit | "";
  quantity: string;
  unit: Unit | "";
  unitPrice: string;
  totalPrice: string;
  lineType: LineType;
  sourceLineIndexes: number[];
  warranties: WarrantyDraft[];
}

// Draft representation of a discount within the review process.
export interface DiscountDraft {
  id: string;
  rawName: string;
  description: string;
  amount: string;
  appliesToItemIndex: number | null;
  sourceLineIndexes: number[];
}

// Draft representation of the entire review within the review process.
export interface ReviewDraft {
  merchantRawName: string;
  merchantName: string;
  merchantId: number | null;
  merchantMatchStatus: MatchStatus | null;
  merchantCandidates: ReviewDto["merchant"]["match"]["candidates"];
  purchaseDate: string;
  purchaseTime: string;
  currency: string;
  total: string;
  items: ItemDraft[];
  discounts: DiscountDraft[];
}

/**
 * Formats a number of cents into a string representation with two decimal places.
 * @param cents The number of cents to format.
 * @returns A string representation of the amount in dollars with two decimal places.
 */
export function formatCents(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

/**
 * Parses a string representation of an amount in dollars into a number of cents.
 * Returns null if the input is invalid or cannot be parsed.
 * @param value The string representation of the amount in dollars.
 * @returns The number of cents, or null if the input is invalid.
 */
export function parseCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parts = normalized.split(".");
  if (parts.length > 2 || (parts[1]?.length ?? 0) > 2) return null;
  const unsigned = normalized.startsWith("-")
    ? normalized.slice(1)
    : normalized;
  if (
    !unsigned ||
    [...unsigned].some((character) => !"0123456789.".includes(character)) ||
    !parts[0] ||
    parts[0] === "-"
  )
    return null;
  const amount = Number(normalized);
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Creates a draft representation of the entire review for editing purposes.
 * @param review The original review data transfer object (DTO).
 * @returns A draft representation of the review suitable for editing.
 */
export function createReviewDraft(review: ReviewDto): ReviewDraft {
  return {
    merchantRawName: review.merchant.rawName ?? "",
    merchantName:
      review.merchant.normalizedName ?? review.merchant.rawName ?? "",
    merchantId: review.merchant.match.merchantId,
    merchantMatchStatus: review.merchant.match.status,
    merchantCandidates: review.merchant.match.candidates,
    purchaseDate: review.purchaseDate ?? "",
    purchaseTime: review.purchaseTime ?? "",
    currency: review.currency ?? "",
    total: formatCents(review.totalCents),
    items: review.items.map((item) => {
      const matched =
        item.match?.status === "MATCHED"
          ? item.match.candidates.find(
              (candidate) => candidate.productId === item.match?.productId,
            )
          : undefined;
      return {
        id: crypto.randomUUID(),
        rawName: item.rawName,
        normalizedName: item.normalizedName ?? item.rawName,
        productId: item.match?.productId ?? null,
        selectedProductName: matched?.name ?? null,
        selectedProductDetails: matched
          ? {
              brandName: matched.brand,
              productGroupName: matched.productGroup,
              packageAmount: matched.packageAmount,
              packageUnit: matched.packageUnit,
            }
          : null,
        matchStatus: item.match?.status ?? null,
        matchCandidates: item.match,
        brand: item.brand ?? "",
        brandId: null,
        productGroup: item.productGroup ?? "",
        productGroupId: null,
        category: item.category ?? "",
        packageAmount:
          item.packageAmount === null ? "" : String(item.packageAmount),
        packageUnit: item.packageUnit ?? "",
        quantity: String(item.quantity),
        unit: item.unit ?? "",
        unitPrice: formatCents(item.unitPriceCents),
        totalPrice: formatCents(item.totalPriceCents),
        lineType: item.lineType,
        sourceLineIndexes: [...item.sourceLineIndexes],
        warranties: [],
      };
    }),
    discounts: review.discounts.map((discount) => ({
      id: crypto.randomUUID(),
      rawName: discount.rawName,
      description: discount.description ?? "",
      amount: formatCents(discount.amountCents),
      appliesToItemIndex: discount.appliesToItemIndex,
      sourceLineIndexes: [...discount.sourceLineIndexes],
    })),
  };
}

/**
 * Creates an empty item draft with default values.
 * @returns A new item draft object.
 */
export function createEmptyItem(): ItemDraft {
  return {
    id: crypto.randomUUID(),
    rawName: "",
    normalizedName: "",
    productId: null,
    selectedProductName: null,
    matchStatus: null,
    matchCandidates: null,
    brand: "",
    brandId: null,
    productGroup: "",
    productGroupId: null,
    category: "",
    packageAmount: "",
    packageUnit: "",
    quantity: "1",
    unit: "",
    unitPrice: "",
    totalPrice: "",
    lineType: "product",
    sourceLineIndexes: [],
    warranties: [],
  };
}

/**
 * Removes an item from the review draft by its ID and updates the discount references accordingly.
 * @param draft - The current review draft.
 * @param id - The ID of the item to remove.
 * @returns The updated review draft with the item removed and discount references adjusted.
 */
export function removeReviewItem(draft: ReviewDraft, id: string): ReviewDraft {
  const index = draft.items.findIndex((item) => item.id === id);
  if (index === -1) return draft;
  return {
    ...draft,
    items: draft.items.filter((item) => item.id !== id),
    discounts: draft.discounts.map((discount) => ({
      ...discount,
      appliesToItemIndex:
        discount.appliesToItemIndex === index
          ? null
          : discount.appliesToItemIndex !== null &&
              discount.appliesToItemIndex > index
            ? discount.appliesToItemIndex - 1
            : discount.appliesToItemIndex,
    })),
  };
}

/**
 * Chooses a product for a given item draft, updating its product ID, selected product name, and match status.
 * @param item The item draft to update.
 * @param product The product to choose, or null to clear the selection.
 * @returns The updated item draft.
 */
export function chooseProduct(
  item: ItemDraft,
  product: ProductSelection | null,
): ItemDraft {
  return {
    ...item,
    productId: product?.id ?? null,
    selectedProductName: product?.name ?? null,
    selectedProductDetails: product
      ? {
          brandName: product.brandName,
          productGroupName: product.productGroupName,
          categoryName: product.categoryName,
          packageAmount: product.packageAmount,
          packageUnit: product.packageUnit,
        }
      : null,
    matchStatus: null,
  };
}

/**
 * Changes the line type of an item draft, updating related fields accordingly.
 * @param item The item draft to update.
 * @param lineType The new line type to set.
 * @returns The updated item draft.
 */
export function changeLineType(item: ItemDraft, lineType: LineType): ItemDraft {
  return {
    ...item,
    lineType,
    productId: lineType === "product" ? item.productId : null,
    selectedProductName:
      lineType === "product" ? item.selectedProductName : null,
    selectedProductDetails:
      lineType === "product" ? item.selectedProductDetails : null,
    matchStatus: lineType === "product" ? item.matchStatus : null,
    warranties: lineType === "product" ? item.warranties : [],
  };
}

/**
 * Determines the sum status of the review draft by comparing the total with the sum of item totals minus discounts.
 * @param draft The review draft to evaluate.
 * @returns "MATCH" if the totals match, "MISMATCH" if they don't, or "INCOMPLETE" if the data is insufficient.
 */
export function reviewSumStatus(
  draft: ReviewDraft,
): "MATCH" | "MISMATCH" | "INCOMPLETE" {
  if (draft.items.length === 0) return "INCOMPLETE";
  const total = parseCents(draft.total);
  const itemAmounts = draft.items.map((item) => parseCents(item.totalPrice));
  const discounts = draft.discounts.map((discount) =>
    parseCents(discount.amount),
  );
  if (total === null || itemAmounts.includes(null) || discounts.includes(null))
    return "INCOMPLETE";
  const itemSum = itemAmounts.reduce<number>((sum, amount) => sum + amount!, 0);
  const discountSum = discounts.reduce<number>(
    (sum, amount) => sum + amount!,
    0,
  );
  return Math.abs(itemSum - discountSum - total) <= 1 ? "MATCH" : "MISMATCH";
}

/**
 * Checks if a given string represents a valid date in the format YYYY-MM-DD.
 * @param value The string to validate.
 * @returns True if the string is a valid date, false otherwise.
 */
export function isValidDate(value: string): boolean {
  if (value.length !== 10 || value[4] !== "-" || value[7] !== "-") return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/**
 * Determines if there is an issue with the dates of a warranty.
 * @param warranty The warranty draft to check.
 * @returns "missing" if either date is missing, "invalid" if either date is invalid, "range" if the end date is before the start date, or null if there are no issues.
 */
export function warrantyDateIssue(
  warranty: Pick<WarrantyDraft, "startDate" | "endDate">,
): "missing" | "invalid" | "range" | null {
  if (!warranty.startDate || !warranty.endDate) return "missing";
  if (!isValidDate(warranty.startDate) || !isValidDate(warranty.endDate))
    return "invalid";
  return warranty.endDate < warranty.startDate ? "range" : null;
}

// Review issue codes and their corresponding interface.
export type ReviewIssueCode =
  | "merchant"
  | "purchaseDate"
  | "purchaseTime"
  | "currency"
  | "total"
  | "items"
  | "rawName"
  | "quantity"
  | "unitPrice"
  | "itemTotal"
  | "packageAmount"
  | "productName"
  | "productGroup"
  | "category"
  | "packageUnit"
  | "warranty"
  | "discountAmount";

// Represents a single issue found in the review draft, including its code and optional item number.
export interface ReviewIssue {
  code: ReviewIssueCode;
  number?: number;
}

/**
 * Checks if a given string represents a positive decimal number.
 * @param value The string to validate.
 * @returns True if the string is a positive decimal, false otherwise.
 */
function isPositiveDecimal(value: string): boolean {
  const normalized = value.trim().replace(",", ".");
  if (
    !normalized ||
    [...normalized].some((character) => !"0123456789.".includes(character)) ||
    normalized.split(".").length > 2
  )
    return false;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0;
}

/**
 * Determines the issues present in a review draft.
 * @param draft The review draft to check.
 * @returns An array of review issues found in the draft.
 */
export function reviewIssues(draft: ReviewDraft): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (!draft.merchantName.trim()) issues.push({ code: "merchant" });
  if (!isValidDate(draft.purchaseDate)) issues.push({ code: "purchaseDate" });
  if (
    draft.purchaseTime &&
    (draft.purchaseTime.length !== 5 ||
      draft.purchaseTime[2] !== ":" ||
      ![
        ...draft.purchaseTime.slice(0, 2),
        ...draft.purchaseTime.slice(3),
      ].every((character) => "0123456789".includes(character)) ||
      Number(draft.purchaseTime.slice(0, 2)) > 23 ||
      Number(draft.purchaseTime.slice(3)) > 59)
  )
    issues.push({ code: "purchaseTime" });
  if (
    draft.currency.length !== 3 ||
    [...draft.currency].some(
      (character) => !"ABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(character),
    )
  )
    issues.push({ code: "currency" });
  if (parseCents(draft.total) === null) issues.push({ code: "total" });
  if (draft.items.length === 0) issues.push({ code: "items" });
  draft.items.forEach((item, index) => {
    const number = index + 1;
    if (!item.rawName.trim()) issues.push({ code: "rawName", number });
    if (!isPositiveDecimal(item.quantity))
      issues.push({ code: "quantity", number });
    if (item.unitPrice && parseCents(item.unitPrice) === null)
      issues.push({ code: "unitPrice", number });
    if (parseCents(item.totalPrice) === null)
      issues.push({ code: "itemTotal", number });
    if (item.packageAmount && !isPositiveDecimal(item.packageAmount))
      issues.push({ code: "packageAmount", number });
    if (item.lineType === "product" && item.productId === null) {
      if (!item.normalizedName.trim())
        issues.push({ code: "productName", number });
      if (!item.productGroup.trim())
        issues.push({ code: "productGroup", number });
      if (!item.category.trim()) issues.push({ code: "category", number });
      if (Boolean(item.packageAmount) !== Boolean(item.packageUnit))
        issues.push({ code: "packageUnit", number });
    }
    if (item.warranties.length > 0 && item.lineType !== "product")
      issues.push({ code: "warranty", number });
    if (
      item.warranties.some((warranty) => warrantyDateIssue(warranty) !== null)
    )
      issues.push({ code: "warranty", number });
  });
  draft.discounts.forEach((discount, index) => {
    const amount = parseCents(discount.amount);
    if (amount === null || amount <= 0)
      issues.push({ code: "discountAmount", number: index + 1 });
  });
  return issues;
}

// Build the final save DTO for the receipt, returning null if there are any review issues.
export function buildFinalSaveDto(draft: ReviewDraft) {
  if (reviewIssues(draft).length > 0) return null;
  const optionalText = (value: string) => value.trim() || null;
  return {
    merchant: {
      id: draft.merchantId,
      name: draft.merchantName.trim(),
      rawName: optionalText(draft.merchantRawName),
    },
    purchaseDate: draft.purchaseDate,
    purchaseTime: optionalText(draft.purchaseTime),
    totalCents: parseCents(draft.total)!,
    currency: draft.currency,
    items: draft.items.map((item) => ({
      rawName: item.rawName.trim(),
      productId: item.lineType === "product" ? item.productId : null,
      productName: optionalText(item.normalizedName),
      brandId: item.brandId,
      brandName: optionalText(item.brand),
      productGroupId: item.productGroupId,
      productGroupName: optionalText(item.productGroup),
      categoryName: optionalText(item.category),
      packageAmount: item.packageAmount
        ? Number(item.packageAmount.replace(",", "."))
        : null,
      packageUnit: item.packageUnit || null,
      quantity: Number(item.quantity.replace(",", ".")),
      unit: item.unit || null,
      unitPriceCents: item.unitPrice ? parseCents(item.unitPrice) : null,
      totalPriceCents: parseCents(item.totalPrice)!,
      lineType: item.lineType,
      warranties: item.warranties.map((warranty) => ({
        type: warranty.type,
        startDate: warranty.startDate,
        endDate: warranty.endDate,
        notes: optionalText(warranty.notes),
      })),
    })),
    discounts: draft.discounts.map((discount) => ({
      description: optionalText(discount.description || discount.rawName),
      amountCents: parseCents(discount.amount)!,
      appliesToItemIndex: discount.appliesToItemIndex,
    })),
  };
}
