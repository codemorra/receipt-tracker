import { z } from "zod";

const identifier = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().positive().refine(Number.isSafeInteger));

/** Analytics uses inclusive calendar dates, never timestamps. */
const filterSchema = z.strictObject({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  merchantId: identifier.optional(),
});

const orderedDates = (query: { from?: string; to?: string }) =>
  !query.from || !query.to || query.from <= query.to;

export const spendingQuerySchema = filterSchema.refine(orderedDates);
export const priceHistoryQuerySchema = filterSchema
  .extend({ productId: identifier })
  .refine(orderedDates);

export type SpendingQuery = z.infer<typeof spendingQuerySchema>;
export type PriceHistoryQuery = z.infer<typeof priceHistoryQuerySchema>;
