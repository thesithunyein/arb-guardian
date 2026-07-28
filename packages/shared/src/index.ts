import { z } from "zod";

export const severitySchema = z.enum(["low", "medium", "high", "critical"]);

export const riskRuleMatchSchema = z.object({
  ruleId: z.string(),
  reason: z.string(),
  severity: severitySchema,
  scoreDelta: z.number().int()
});

export const riskAssessmentSchema = z.object({
  txHash: z.string(),
  wallet: z.string(),
  destination: z.string(),
  method: z.string(),
  totalScore: z.number().int(),
  blocked: z.boolean(),
  matches: z.array(riskRuleMatchSchema),
  generatedAt: z.string()
});

export const incidentStatusSchema = z.enum(["open", "mitigated", "ignored"]);

export const incidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  details: z.string(),
  wallet: z.string(),
  severity: severitySchema,
  status: incidentStatusSchema,
  recommendedPlaybook: z.string(),
  evidence: z.array(z.string()),
  createdAt: z.string()
});

export const riskAssessmentInputSchema = z.object({
  txHash: z.string().min(3),
  wallet: z.string().min(3),
  destination: z.string().min(3),
  method: z.string().min(1),
  amountWei: z.string().regex(/^\d+$/),
  allowlisted: z.boolean(),
  dailyLimitWei: z.string().regex(/^\d+$/),
  spentTodayWei: z.string().regex(/^\d+$/)
});

export const incidentActionSchema = z.object({
  action: z.enum(["acknowledge", "mitigate", "ignore"]),
  actor: z.string().min(2)
});

export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;
export type Incident = z.infer<typeof incidentSchema>;
