import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/).default("8787"),
  API_KEY: z.string().min(12).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
