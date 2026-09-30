import { z } from "zod";

const id = z.number().int().positive().refine(Number.isSafeInteger);
const cents = z.number().int().refine(Number.isSafeInteger);
const name = z.string().trim().min(1);
const optionalName = name.nullable();
const unit = z.enum(["pcs", "g", "kg", "ml", "l"]);
const date = z.iso.date();

// Warranty schema for validating warranty information
const warranty = z
  .strictObject({
    type: z.enum(["statutory", "manufacturer", "extended"]),
    startDate: date,
    endDate: date,
    notes: z.string().nullable(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "Warranty end date precedes start date",
  });

// Item schema for validating individual items in the receipt
const item = z.strictObject({
  rawName: name,
  productId: id.nullable(),
  productName: optionalName,
  brandId: id.nullable(),
  brandName: optionalName,
  productGroupId: id.nullable(),
  productGroupName: optionalName,
  categoryName: optionalName,
  packageAmount: z.number().positive().finite().nullable(),
  packageUnit: unit.nullable(),
  quantity: z.number().positive().finite(),
  unit: unit.nullable(),
  unitPriceCents: cents.nullable(),
  totalPriceCents: cents,
  lineType: z.enum(["product", "deposit", "fee", "other"]),
  warranties: z.array(warranty),
});

// Final save schema for validating the entire receipt
export const finalSaveSchema = z
  .strictObject({
    merchant: z.strictObject({
      id: id.nullable(),
      name,
      rawName: optionalName,
    }),
    purchaseDate: date,
    purchaseTime: z
      .string()
      .refine((value) => {
        if (value.length !== 5 || value[2] !== ":") return false;
        const digits = value.slice(0, 2) + value.slice(3);
        return (
          [...digits].every((digit) => "0123456789".includes(digit)) &&
          Number(value.slice(0, 2)) < 24 &&
          Number(value.slice(3)) < 60
        );
      })
      .nullable(),
    totalCents: cents,
    currency: z
      .string()
      .length(3)
      .refine((value) =>
        [...value].every((letter) =>
          "ABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(letter),
        ),
      ),
    items: z.array(item).min(1),
    duplicateOverride: z.boolean().optional(),
    discounts: z.array(
      z.strictObject({
        description: z.string().nullable(),
        amountCents: cents.positive(),
        appliesToItemIndex: z.number().int().nonnegative().nullable(),
      }),
    ),
  })
  .superRefine((receipt, context) => {
    receipt.items.forEach((entry, index) => {
      if (entry.lineType !== "product") {
        if (entry.productId !== null || entry.warranties.length > 0) {
          context.addIssue({
            code: "custom",
            path: ["items", index],
            message: "Only product lines may have products or warranties",
          });
        }
        return;
      }
      if (entry.productId === null) {
        if (
          !entry.productName ||
          !entry.productGroupName ||
          !entry.categoryName
        ) {
          context.addIssue({
            code: "custom",
            path: ["items", index],
            message: "New products need a name, product group, and category",
          });
        }
        if ((entry.packageAmount === null) !== (entry.packageUnit === null)) {
          context.addIssue({
            code: "custom",
            path: ["items", index],
            message: "Package amount and unit must be provided together",
          });
        }
      }
    });
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
  });

export type FinalSaveDto = z.infer<typeof finalSaveSchema>;
