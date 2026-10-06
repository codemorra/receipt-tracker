import { z } from "zod";

const identifier = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().positive().refine(Number.isSafeInteger));

/** Analytics uses inclusive calendar dates, never timestamps. */
export const spendingQuerySchema = z
  .strictObject({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    merchantId: identifier.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to);

export type SpendingQuery = z.infer<typeof spendingQuerySchema>;
