import { pgTable, text, serial, timestamp, jsonb, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const searches = pgTable("searches", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  exchange: text("exchange").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  beta: doublePrecision("beta"),
  peers: jsonb("peers").$type<{ 
    ticker: string; 
    name: string; 
    beta: number | null; 
    sector: string;
    similarityScore?: number;
    keywords?: string[];
    confidence?: "High" | "Medium" | "Fallback";
  }[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const companyProfiles = pgTable("company_profiles", {
  ticker: text("ticker").primaryKey(),
  keywords: text("keywords").array().notNull(),
  embedding: doublePrecision("embedding").array().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSearchSchema = createInsertSchema(searches).omit({ id: true, createdAt: true });
export const insertCompanyProfileSchema = createInsertSchema(companyProfiles);

export type Search = typeof searches.$inferSelect;
export type InsertSearch = z.infer<typeof insertSearchSchema>;
export type CompanyProfile = typeof companyProfiles.$inferSelect;
export type InsertCompanyProfile = z.infer<typeof insertCompanyProfileSchema>;

// API Request/Response Types
export const calculateBetaSchema = z.object({
    ticker: z.string().min(1),
    exchange: z.enum(["NSE", "BSE"]),
    period: z.enum(["1Y", "3Y", "5Y"]).default("5Y"),
    startDate: z.string(), // ISO Date string
    endDate: z.string(),   // ISO Date string
});

export type CalculateBetaRequest = z.infer<typeof calculateBetaSchema>;

export const peerBetaSchema = z.object({
    ticker: z.string(),
    name: z.string(),
    industry: z.string().optional().nullable(),
    beta: z.number().nullable(),
    volatility: z.number().nullable(),
    alpha: z.number().nullable(),
    correlation: z.number().nullable(),
    rSquared: z.number().nullable(),
    marketCap: z.number().optional(),
    revenue: z.number().optional(),
    revenueDate: z.string().optional(),
    enterpriseValue: z.number().optional(),
    evRevenueMultiple: z.number().optional(),
    peRatio: z.number().optional().nullable(),
    pbRatio: z.number().optional().nullable(),
    dividendYield: z.number().optional().nullable(),
    ebitda: z.number().optional(),
    debtToEquity: z.number().optional().nullable(),
    profitMargin: z.number().optional().nullable(),
    grossMargin: z.number().optional().nullable(),
    operatingMargin: z.number().optional().nullable(),
    returnOnEquity: z.number().optional().nullable(),
    returnOnAssets: z.number().optional().nullable(),
    currentRatio: z.number().optional().nullable(),
    sector: z.string().optional(),
    sourceUrl: z.string().optional(),
    similarityScore: z.number().optional(),
    confidence: z.enum(["High", "Medium", "Fallback"]).optional(),
    error: z.string().optional()
});

export type PeerBeta = z.infer<typeof peerBetaSchema>;

export const calculateBetaResponseSchema = z.object({
    ticker: z.string(),
    name: z.string().optional(),
    marketIndex: z.string(),
    industry: z.string().optional().nullable(),
    sector: z.string().optional().nullable(),
    exchange: z.string().optional(),
    beta: z.number(),
    volatility: z.number().optional(),
    alpha: z.number().optional(),
    correlation: z.number().optional(),
    rSquared: z.number().optional().nullable(),
    period: z.string().optional(),
    dataPoints: z.number().optional(),
    marketCap: z.number().optional().nullable(),
    revenue: z.number().optional().nullable(),
    revenueDate: z.string().optional().nullable(),
    enterpriseValue: z.number().optional().nullable(),
    evRevenueMultiple: z.number().optional().nullable(),
    peRatio: z.number().optional().nullable(),
    pbRatio: z.number().optional().nullable(),
    dividendYield: z.number().optional().nullable(),
    ebitda: z.number().optional().nullable(),
    debtToEquity: z.number().optional().nullable(),
    profitMargin: z.number().optional().nullable(),
    grossMargin: z.number().optional().nullable(),
    operatingMargin: z.number().optional().nullable(),
    returnOnEquity: z.number().optional().nullable(),
    returnOnAssets: z.number().optional().nullable(),
    currentRatio: z.number().optional().nullable(),
    sourceUrl: z.string().optional().nullable(),
    peers: z.array(peerBetaSchema)
});

export type CalculateBetaResponse = z.infer<typeof calculateBetaResponseSchema>;
