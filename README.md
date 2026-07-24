# Khana Banao CRM

Production-oriented CRM for Khana Banao’s lead-to-booking, payment, workforce, attendance,
expense, leave, meeting and payroll operations.

The application is a fresh Next.js App Router and Supabase implementation. The file at
`reference/legacy-crm.html` is a sanitized visual reference only; it is never imported by the
application and none of its browser-side persistence or authentication code is used.

## Stack

- Next.js App Router, React and strict TypeScript
- Supabase Auth, PostgreSQL, Storage, Realtime and Edge Functions
- TanStack Query and TanStack Table
- React Hook Form and Zod
- Chart.js and react-chartjs-2
- Vitest, React Testing Library and Playwright
- pnpm, ESLint and Prettier

## Local prerequisites

- Node.js 20.9 or newer
- pnpm 10
- Docker-compatible container runtime for the local Supabase stack
- Supabase CLI (installed as a development dependency)

## Environment

Copy `.env.example` to `.env.local` for Next.js development and provide values for the local
or dedicated remote Supabase project. Do not prefix service-role or provider secrets with
`NEXT_PUBLIC_`.

The Edge Function secrets are configured separately:

```bash
pnpm exec supabase secrets set --env-file supabase/.env.local
```

Never commit either environment file. Use separate Supabase projects for local, staging and
production.

## Local setup

```bash
pnpm install
pnpm supabase:start
pnpm supabase:reset
pnpm dev
```

`supabase:reset` applies every versioned migration and then development-only seed data. The
organization Director is not created by a public signup or first-visitor flow. Call the
deployment-secret-protected `bootstrap-organization` function once.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm supabase:test
pnpm test:e2e
pnpm build
```

## Production documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database, RLS and Storage](docs/DATABASE.md)
- [Roles and permissions](docs/ROLES_AND_PERMISSIONS.md)
- [Superfone integration status and activation](docs/SUPERFONE_INTEGRATION.md)
- [Deployment and operations](docs/DEPLOYMENT.md)
- [Testing and release validation](docs/TESTING.md)

## Production sequence

1. Create a dedicated production Supabase project.
2. Configure Auth with public signup disabled.
3. Link the Supabase CLI and apply reviewed migrations.
4. Configure Edge Function secrets.
5. Deploy all Edge Functions.
6. Invoke `bootstrap-organization` once with the one-time bootstrap secret.
7. Deploy the Next.js application with only the required public Supabase variables.
8. Log in as Director and create the role hierarchy through secured account functions.
9. Configure Superfone only after its official base URL, authentication, capabilities,
   webhook contract and signature scheme are supplied and verified.

Detailed feature status and validation evidence are tracked in `PROGRESS.md`.
