# replit.md

## Overview

This is a **Stock Beta Calculator** application designed for Indian stock markets (NSE/BSE). The application allows users to calculate the beta coefficient of stocks relative to market indices, with peer comparison features. It fetches historical stock data, computes beta values using return regression analysis, and displays results with visual indicators for volatility levels.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state and data fetching
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **Animations**: Framer Motion for smooth transitions and reveals
- **Forms**: React Hook Form with Zod validation
- **Build Tool**: Vite with custom development plugins for Replit integration

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **API Design**: RESTful endpoints with Zod schema validation
- **Data Fetching**: Yahoo Finance API (yahoo-finance2) for historical stock data
- **Web Scraping**: Cheerio for HTML parsing (likely for peer data extraction)

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Schema Management**: Drizzle Kit for migrations (`db:push` command)
- **Session Storage**: connect-pg-simple for PostgreSQL-backed sessions

### Shared Code Architecture
- **Location**: `/shared` directory contains code used by both client and server
- **Schema Definitions**: Drizzle schema and Zod validation schemas in `shared/schema.ts`
- **API Contracts**: Type-safe API route definitions in `shared/routes.ts`
- **Path Aliases**: `@shared/*` resolves to shared directory

### Build System
- **Development**: Vite dev server with HMR proxied through Express
- **Production**: esbuild bundles server code; Vite builds client to `dist/public`
- **Server Dependencies**: Selective bundling of allowlisted packages for faster cold starts

### Key Design Patterns
1. **Type-safe API contracts**: Zod schemas define request/response types shared between client and server
2. **Monorepo structure**: Client (`/client`), server (`/server`), and shared (`/shared`) directories
3. **Component composition**: shadcn/ui components with CVA (class-variance-authority) for variants
4. **Error handling**: Structured error responses with validation and internal error schemas

## External Dependencies

### APIs and Data Services
- **Yahoo Finance API**: Historical stock price data via `yahoo-finance2` package
- **Market Indices**: Uses NSE/BSE market indices (like NIFTY, SENSEX) as benchmarks for beta calculation

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **Drizzle ORM**: Type-safe database queries and schema management

### UI Framework Dependencies
- **Radix UI**: Accessible primitive components (dialogs, dropdowns, forms, etc.)
- **Lucide React**: Icon library
- **date-fns**: Date manipulation utilities
- **embla-carousel-react**: Carousel component
- **recharts**: Charting library for data visualization
- **vaul**: Drawer component

### Development Tools (Replit-specific)
- `@replit/vite-plugin-runtime-error-modal`: Error overlay in development
- `@replit/vite-plugin-cartographer`: Development tooling
- `@replit/vite-plugin-dev-banner`: Development banner display