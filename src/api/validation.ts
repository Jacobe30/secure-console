import { z } from "zod";

export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(256),
  })
  .strict();

export const bootstrapSchema = loginSchema
  .extend({
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();

const selectedOfferSchema = z
  .record(z.unknown())
  .refine((value) => !containsSensitiveKey(value), "Selected offer contains a prohibited field.");

export const publicQuoteSchema = z
  .object({
    customerName: z.string().trim().min(1).max(120),
    customerEmail: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    customerPhone: z.string().trim().min(5).max(32).optional(),
    insuranceType: z.string().trim().min(1).max(60).optional(),
    vehicleYear: z.coerce.number().int().min(1990).max(2100).optional(),
    vehicleMakeModel: z.string().trim().min(1).max(160).optional(),
    vehicleValue: z.coerce.number().nonnegative().max(100_000_000).optional(),
    usagePurpose: z.string().trim().min(1).max(100).optional(),
    policyStartDate: z.string().date().optional(),
    repairLocation: z.string().trim().min(1).max(80).optional(),
    selectedOffer: selectedOfferSchema.optional(),
    website: z.string().max(0).optional(),
  })
  .strict();

export const reviewSchema = z
  .object({
    status: z.enum(["accepted", "declined"]),
    internalNote: z.string().trim().max(2000).optional(),
  })
  .strict();

const prohibitedKey =
  /(card|cvv|cvc|otp|password|passcode|pin|token|authorization|secret|national.?id)/i;

function containsSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => prohibitedKey.test(key) || containsSensitiveKey(nested),
  );
}
