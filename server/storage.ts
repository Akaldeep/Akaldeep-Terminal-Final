import { searches, companyProfiles, type InsertSearch, type Search, type InsertCompanyProfile, type CompanyProfile } from "@shared/schema";

export interface IStorage {
  createSearch(search: InsertSearch): Promise<Search>;
  getRecentSearches(): Promise<Search[]>;
  getCompanyProfile(ticker: string): Promise<CompanyProfile | undefined>;
  upsertCompanyProfile(profile: InsertCompanyProfile): Promise<CompanyProfile>;
}

export class MemStorage implements IStorage {
  private searches: Map<number, Search>;
  private companyProfiles: Map<string, CompanyProfile>;
  private nextId: number;

  constructor() {
    this.searches = new Map();
    this.companyProfiles = new Map();
    this.nextId = 1;
  }

  async createSearch(search: InsertSearch): Promise<Search> {
    const id = this.nextId++;
    const newSearch: Search = { 
      ...search, 
      id, 
      beta: search.beta ?? null,
      createdAt: new Date() 
    };
    this.searches.set(id, newSearch);
    return newSearch;
  }

  async getRecentSearches(): Promise<Search[]> {
    return Array.from(this.searches.values()).sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime()).slice(0, 10);
  }

  async getCompanyProfile(ticker: string): Promise<CompanyProfile | undefined> {
    return this.companyProfiles.get(ticker);
  }

  async upsertCompanyProfile(profile: InsertCompanyProfile): Promise<CompanyProfile> {
    const updatedProfile: CompanyProfile = { ...profile, updatedAt: new Date() };
    this.companyProfiles.set(profile.ticker, updatedProfile);
    return updatedProfile;
  }
}

export const storage = new MemStorage();
