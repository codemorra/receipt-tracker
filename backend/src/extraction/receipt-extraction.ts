import { z } from "zod";

// Schema definitions for receipt extraction, including merchants, items, discounts, and the overall receipt structure.
export const extractionUnitSchema = z.enum(["pcs", "g", "kg", "ml", "l"]);

const sourceLineIndexesSchema = z.array(z.number().int().nonnegative());
const centsSchema = z.number().int();

// Schema definition for the merchant information on the receipt.
const merchantSchema = z.strictObject({
  rawName: z.string().nullable(),
  normalizedName: z.string().nullable(),
});

// Schema definition for individual items on the receipt.
const itemSchema = z.strictObject({
  rawName: z.string(),
  normalizedName: z.string().nullable(),
  brand: z.string().nullable(),
  productGroup: z.string().nullable(),
  category: z.string().nullable(),
  packageAmount: z.number().positive().nullable(),
  packageUnit: extractionUnitSchema.nullable(),
  quantity: z.number().positive(),
  unit: extractionUnitSchema.nullable(),
  unitPriceCents: centsSchema.nullable(),
  totalPriceCents: centsSchema.nullable(),
  lineType: z.enum(["product", "deposit", "fee", "other"]),
  sourceLineIndexes: sourceLineIndexesSchema,
});

// Schema definition for discounts applied to the receipt.
const discountSchema = z.strictObject({
  rawName: z.string(),
  description: z.string().nullable(),
  amountCents: centsSchema.positive(),
  appliesToItemIndex: z.number().int().nonnegative().nullable(),
  sourceLineIndexes: sourceLineIndexesSchema,
});

/**
 * Checks if a given string represents a valid purchase time in the format "HH:MM".
 * @param value The string to check.
 * @returns True if the string is a valid purchase time, false otherwise.
 */
function isPurchaseTime(value: string): boolean {
  if (value.length !== 5 || value[2] !== ":") return false;
  const hours = value.slice(0, 2);
  const minutes = value.slice(3);
  return (
    [...hours, ...minutes].every((digit) => "0123456789".includes(digit)) &&
    Number(hours) < 24 &&
    Number(minutes) < 60
  );
}

/**
 * Creates a Zod schema for extracting receipt data, validating merchants, items, discounts, and overall receipt structure.
 * @param categoryNames An array of valid category names for item validation.
 * @returns A Zod schema for receipt extraction.
 */
export function createReceiptExtractionSchema(
  categoryNames: readonly string[],
  ocrLineIndexes?: readonly number[],
) {
  const availableIndexes =
    ocrLineIndexes === undefined ? undefined : new Set(ocrLineIndexes);
  return (
    z
      .strictObject({
        merchant: merchantSchema,
        purchaseDate: z.iso.date().nullable(),
        purchaseTime: z.string().refine(isPurchaseTime).nullable(),
        currency: z
          .string()
          .length(3)
          .refine((value) =>
            [...value].every((character) =>
              "ABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(character),
            ),
          )
          .nullable(),
        totalCents: centsSchema.nullable(),
        items: z.array(
          itemSchema.refine(
            (item) =>
              item.category === null || categoryNames.includes(item.category),
            { path: ["category"], message: "Unknown category" },
          ),
        ),
        discounts: z.array(discountSchema),
      })
      // Super refinement to validate OCR line indexes and discount item references.
      .superRefine((receipt, context) => {
        if (availableIndexes !== undefined) {
          for (const field of ["items", "discounts"] as const) {
            receipt[field].forEach((entry, entryIndex) => {
              entry.sourceLineIndexes.forEach((lineIndex, referenceIndex) => {
                if (!availableIndexes.has(lineIndex)) {
                  context.addIssue({
                    code: "custom",
                    path: [
                      field,
                      entryIndex,
                      "sourceLineIndexes",
                      referenceIndex,
                    ],
                    message: "Unknown OCR line index",
                  });
                }
              });
            });
          }
        }
        receipt.discounts.forEach((discount, index) => {
          if (
            discount.appliesToItemIndex !== null &&
            discount.appliesToItemIndex >= receipt.items.length
          ) {
            context.addIssue({
              code: "custom",
              path: ["discounts", index, "appliesToItemIndex"],
              message: "Item index is out of range",
            });
          }
        });
      })
  );
}

// Type representing the structure of extracted receipt data based on the schema.
export type ReceiptExtraction = z.infer<
  ReturnType<typeof createReceiptExtractionSchema>
>;
