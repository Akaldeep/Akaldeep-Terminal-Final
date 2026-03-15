import YahooFinance from 'yahoo-finance2';
import OpenAI from "openai";
import { storage } from "./storage";
import { db } from "./db";
import { companyProfiles } from "@shared/schema";

const yahooFinance = new YahooFinance();
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

async function generateKeywords(text: string): Promise<string[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "Extract exactly 5 core business keywords from the following business summary. Return them as a comma-separated list of single words or short phrases.",
      },
      {
        role: "user",
        content: text,
      },
    ],
    max_completion_tokens: 50,
  });
  const content = response.choices[0].message.content || "";
  return content.split(",").map(k => k.trim().toLowerCase()).slice(0, 5);
}

async function precomputeProfile(ticker: string) {
  try {
    console.log(`Processing ${ticker}...`);
    const summary = await yahooFinance.quoteSummary(ticker, { modules: ['assetProfile'] }).catch(() => null);
    if (!summary?.assetProfile?.longBusinessSummary) {
      console.log(`No summary for ${ticker}`);
      return;
    }

    const description = summary.assetProfile.longBusinessSummary;
    const [embedding, keywords] = await Promise.all([
      getEmbedding(description),
      generateKeywords(description)
    ]);

    await storage.upsertCompanyProfile({ ticker, keywords, embedding });
    console.log(`Updated profile for ${ticker}`);
  } catch (error) {
    console.error(`Error for ${ticker}:`, error);
  }
}

async function run() {
  const tickers = process.argv.slice(2);
  if (tickers.length === 0) {
    console.log("Please provide tickers as arguments: npm run precompute -- RELIANCE.NS TCS.NS");
    return;
  }

  for (const ticker of tickers) {
    await precomputeProfile(ticker);
  }
  process.exit(0);
}

run();
