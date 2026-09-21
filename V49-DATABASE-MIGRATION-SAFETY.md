# YEGNA BINGO V49 — Production Database Migration Safety

V49 adds an operator-run, transaction-safe PostgreSQL migration runner. It does **not** run database mutations automatically during every Netlify deploy.

## Why this design

Netlify deploys can be repeated, rolled back, or run concurrently. Database migrations should therefore be explicit, serialized, checksum-verified, and independent of frontend deployment.

## Required environment

- `DATABASE_URL` — PostgreSQL connection string.
- `DATABASE_SSL=disable` is optional for local development only. Otherwise SSL verification is enabled with the deployment-compatible PostgreSQL configuration used by the project.

## Commands

```bash
npm run db:status
npm run db:migrate
npm run db:migrate -- --to=47
```

The runner:

1. Creates `schema_migrations` if needed.
2. Takes a PostgreSQL advisory lock so two migration runners cannot execute simultaneously.
3. Applies migrations in numeric order.
4. Runs each migration inside its own transaction.
5. Records filename + SHA-256 checksum.
6. Refuses to continue if an already-applied migration file was modified.
7. Is safe to re-run after a successful deployment.

## Existing production database

If the production database was already upgraded manually before V49, **do not blindly run every historical migration**. First inspect the database and compare it with the V33–V47 migration history. After confirming that the database already contains the intended changes, an operator may create the migration history baseline:

```bash
npm run db:migrate -- --baseline=47 --confirm-baseline
```

Baseline is intentionally an explicit confirmation step because it records migrations as applied without executing them.

## Fresh database

Initialize the canonical schema first:

```bash
psql "$DATABASE_URL" -f db/schema.sql
npm run db:migrate
```

Then deploy the application.

## Deployment rule

Do **not** call `db:migrate` from a Netlify request handler, bot webhook, or frontend startup. Run it once as an explicit deployment/operations step. This prevents users from racing a migration during a normal app request.
