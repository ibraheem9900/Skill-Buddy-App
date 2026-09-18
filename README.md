# Skill Buddy App

Skill Buddy App is a full-stack mobile-first marketplace platform for discovering and booking skilled service providers. The project combines a modern Expo-based mobile app, a TypeScript API server, and a database layer designed for structured service discovery, booking flows, job management, and user interactions.

## Overview

This repository is organized as a pnpm monorepo and includes:

- A React Native / Expo client for the end-user experience
- An Express API for core business logic and data access
- A PostgreSQL + Drizzle data layer
- OpenAPI-based API contract generation and typed client code generation
- Shared workspace tooling and project automation

The app is designed around real-world service marketplace workflows such as browsing categories, filtering services, viewing provider profiles, checking job or booking details, and interacting with service-related requests.

## Features

- Service discovery and category browsing
- Search and filtering across services and providers
- Booking and quote-request workflows
- Provider/job-related screens and flows
- Notifications, bookmarks, and profile management
- Multi-language and theme-aware UI support
- API-first architecture with generated contracts and typed clients
- Monorepo setup for clean separation between app, server, schema, and tooling

## Tech Stack

- TypeScript
- pnpm workspaces
- Node.js
- Express 5
- PostgreSQL
- Drizzle ORM
- Zod validation
- Orval API code generation
- Expo / React Native
- React Query
- TypeScript project references and shared build pipeline

## Architecture

The repository is structured as a multi-package workspace:

```text
.
├── artifacts/
│   ├── api-server/        Express backend service
│   └── skillbuddy/        Expo React Native app
├── lib/
│   ├── api-client-react/  Generated API client layer
│   ├── api-spec/          OpenAPI spec + codegen config
│   └── db/                Drizzle database package and schema
├── scripts/               Utility scripts and automation
├── .gitignore
├── .npmrc
├── .replit
├── .replitignore
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
├── replit.md
├── skillbuddy-qr.html
└── README.md
```

### Application flow

- The mobile app lives in `artifacts/skillbuddy`
- The API server lives in `artifacts/api-server`
- Shared database and schema definitions live in `lib/db`
- API contracts and code generation live in `lib/api-spec`
- Workspace-level scripts and TypeScript setup are managed at the root

## Prerequisites

Before running the project locally, make sure you have the following installed:

- Node.js 20+ or compatible version
- pnpm
- PostgreSQL database
- A terminal environment capable of running workspace scripts

## Getting Started

Clone the repository and install dependencies:

```bash
git clone https://github.com/ibraheem9900/Skill-Buddy-App.git
cd Skill-Buddy-App
pnpm install
```

## Environment Variables

The project expects environment configuration for the backend and database:

```bash
PORT=5000
DATABASE_URL=postgresql://user:password@localhost:5432/skillbuddy
```

The backend service requires `PORT`, and the database layer is configured around PostgreSQL via `DATABASE_URL`.

## Running the Project

### 1) Run the API server

```bash
pnpm --filter @workspace/api-server run dev
```

This starts the Express server on the configured port (typically `5000`).

### 2) Run the mobile app

```bash
pnpm --filter @workspace/skillbuddy run dev
```

This starts the Expo app for local development.

### 3) Run full type checking

```bash
pnpm run typecheck
```

### 4) Run production build

```bash
pnpm run build
```

## Database and API Layer

The data model is managed with Drizzle and lives under:

- `lib/db/src/schema`
- `lib/db/src/index.ts`

The API contract is maintained in:

- `lib/api-spec/openapi.yaml`

The project includes code generation tooling to rebuild typed API clients and validation schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This keeps the server contract, frontend typing, and validation layer aligned.

## Scripts

Useful workspace scripts:

```bash
pnpm run build
pnpm run typecheck
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/db run push
```

## Project Notes

This is a service marketplace application with a strong emphasis on UX polish and product workflows. The repository includes both app and backend concerns, making it suitable for a product prototype or a larger iteration of a service-booking platform.

The codebase includes workspace automation and structured package boundaries to support scaling, separation of concerns, and maintainability over time.

## Contributing

Contributions are welcome. To contribute:

1. Fork the repository
2. Create a feature branch
3. Make changes with clear, focused commits
4. Run type checks and relevant validations
5. Submit a pull request with a clear summary

## License

This repository does not currently declare a license in the project metadata. If you plan to distribute or reuse the code publicly, it is recommended to add an appropriate open-source license.

## Contact

For questions or collaboration, visit the repository:

- https://github.com/ibraheem9900/Skill-Buddy-App
