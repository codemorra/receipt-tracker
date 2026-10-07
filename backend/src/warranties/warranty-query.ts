import { z } from "zod";
import { warrantyStatuses } from "./warranty-status.js";

// Schema and type definition for warranty query parameters.
export const warrantyQuerySchema = z.strictObject({
  search: z.string().optional(),
  status: z.enum(warrantyStatuses).optional(),
  type: z.enum(["statutory", "manufacturer", "extended"]).optional(),
  page: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().positive().refine(Number.isSafeInteger))
    .optional(),
});
export type WarrantyQuery = z.infer<typeof warrantyQuerySchema>;
