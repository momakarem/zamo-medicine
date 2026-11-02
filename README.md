# Zamo Medical Platform (زامو)

> منصة الحجوزات الطبية — Medical Booking Platform for Saudi Arabia

A modular monolith backend serving as a medical booking and facility management platform. Built with **Node.js 22+**, **TypeScript**, **Fastify 5**, and **PostgreSQL 16** with Row-Level Security.

---

## Table of Contents

- [Requirements](#requirements)
- [Quick Start (Local Development)](#quick-start-local-development)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [API Endpoints](#api-endpoints)
- [Docker Deployment](#docker-deployment)
- [EasyPanel Deployment](#easypanel-deployment)
- [Updating the Application](#updating-the-application)
- [Backup & Restore](#backup--restore)
- [Architecture](#architecture)
- [Testing](#testing)

---

## Requirements

- **Node.js** ≥ 22.7.0 (uses `--experimental-strip-types`)
- **PostgreSQL** ≥ 15 (uses `gen_random_uuid()`, RLS, `NULLS NOT DISTINCT`)
- **npm** ≥ 10
- **Docker** (for containerised deployment)

---

## Quick Start (Local Development)

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd zamo-platform

# 2. Install dependencies
npm install

# 3. Start PostgreSQL (via Docker or local install)
docker run -d --name zamo-pg \
  -e POSTGRES_DB=zamo_dev \
  -e POSTGRES_USER=zamo \
  -e POSTGRES_PASSWORD=zamo \
  -p 5432:5432 \
  postgres:16-alpine

# 4. Create your .env file
cp .env.example .env
# Edit .env with real secrets (generate with the command below)
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 5. Run database migrations
npm run migrate

# 6. Start the development server
npm run dev:api
```

The API will be available at `http://localhost:3000`.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Environment: `development`, `staging`, `production`, `test` |
| `PORT` | No | `3000` | HTTP server port |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `SESSION_SECRET` | **Yes** | — | Session signing key (≥ 32 chars) |
| `OTP_PEPPER` | **Yes** | — | OTP hash pepper (≥ 32 chars) |
| `APP_BASE_URL` | No | `http://localhost:3000` | Public URL (used for CORS) |
| `AUTO_MIGRATE` | No | `false` | Apply DB migrations on startup |
| `SESSION_TTL_PATIENT_MIN` | No | `10080` | Patient session TTL (minutes) |
| `SESSION_TTL_STAFF_MIN` | No | `480` | Staff session TTL (minutes) |
| `SESSION_TTL_ADMIN_MIN` | No | `30` | Admin session TTL (minutes) |
| `OTP_TTL_SECONDS` | No | `300` | OTP validity duration |
| `OTP_MAX_ATTEMPTS` | No | `5` | Max OTP verification attempts |
| `NOTIFICATION_ADAPTER` | No | `memory` | `memory`, `console`, or `provider` |
| `LLM_ADAPTER` | No | `mock` | `mock` or `openai` |
| `OPENAI_API_KEY` | When `LLM_ADAPTER=openai` | — | OpenAI API key |
| `ALLOW_MOCK_PROVIDERS` | No | `false` | Allow mock adapters in production |

> **Important:** Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## Database Setup

### Migrations

The project uses a custom migration runner with plain SQL files:

```bash
# Apply all pending migrations
npm run migrate

# Check migration status
npm run migrate:status

# Rollback the last migration
DATABASE_URL=postgresql://... node --experimental-strip-types scripts/migrate-cli.ts down 1
```

Migration files are located in `src/db/migrations/` and follow the naming convention:
`NNNN_description.up.sql` / `NNNN_description.down.sql`

### Auto-Migration

Set `AUTO_MIGRATE=true` to automatically apply pending migrations when the server starts. This is safe for production as each migration runs inside a transaction with an idempotency check.

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | No | Landing page |
| `GET` | `/api/health` | No | Health check + DB connectivity |
| `POST` | `/api/auth/otp/request` | No | Request OTP for phone number |
| `POST` | `/api/auth/otp/verify` | No | Verify OTP and create session |
| `POST` | `/api/auth/logout` | Yes | Revoke session |
| `GET` | `/api/auth/me` | Yes | Current user info |
| `GET` | `/api/facilities` | No | List approved facilities |
| `GET` | `/api/facilities/:id` | No | Facility detail + branches |
| `GET` | `/api/facilities/:id/services` | No | Services at a facility |
| `GET` | `/api/practitioners/:id` | No | Practitioner profile |
| `GET` | `/api/search` | No | Search services/facilities |
| `GET` | `/api/slots` | No | Available appointment slots |
| `POST` | `/api/bookings` | Yes | Create a booking |
| `GET` | `/api/bookings` | Yes | List bookings |
| `GET` | `/api/bookings/:id` | Yes | Booking detail |
| `PATCH` | `/api/bookings/:id/status` | Yes | Update booking status |

---

## Docker Deployment

### Build and Run with Docker Compose

```bash
# Build and start all services (app + database)
docker compose up -d --build

# View logs
docker compose logs -f app

# Stop
docker compose down

# Stop and delete database data
docker compose down -v
```

### Build Docker Image Only

```bash
docker build -t zamo-platform .
```

### Run with External Database

```bash
docker run -d \
  --name zamo-app \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://user:pass@host:5432/zamo \
  -e SESSION_SECRET=<your-secret> \
  -e OTP_PEPPER=<your-pepper> \
  -e APP_BASE_URL=https://yourdomain.com \
  -e AUTO_MIGRATE=true \
  -e ALLOW_MOCK_PROVIDERS=true \
  zamo-platform
```

---

## EasyPanel Deployment

### Step 1: Create the Project

1. Open EasyPanel dashboard
2. Create a **New Project** (e.g., `zamo`)
3. Inside the project, create a **New Service** → **App**

### Step 2: Connect GitHub

1. Select **GitHub** as the source
2. Connect your GitHub account
3. Select the repository containing this project
4. Set the branch to `main`

### Step 3: Build Configuration

- **Build Method:** Dockerfile
- **Dockerfile Path:** `./Dockerfile`
- **Port:** `3000`

### Step 4: Create the Database

1. Inside the same project, add a **New Service** → **Database** → **PostgreSQL**
2. Note the internal hostname (e.g., `zamo-db`)
3. Set database name: `zamo`
4. Set username: `zamo_app`
5. Set a strong password
6. The connection string will be: `postgresql://zamo_app:<password>@<db-hostname>:5432/zamo`

### Step 5: Environment Variables

Add these environment variables to the **App** service:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | `postgresql://zamo_app:<password>@<db-hostname>:5432/zamo` |
| `SESSION_SECRET` | *(generate a random 64-char hex string)* |
| `OTP_PEPPER` | *(generate a different random 64-char hex string)* |
| `APP_BASE_URL` | `https://yourdomain.com` |
| `AUTO_MIGRATE` | `true` |
| `ALLOW_MOCK_PROVIDERS` | `true` |
| `NOTIFICATION_ADAPTER` | `console` |
| `LLM_ADAPTER` | `mock` |

### Step 6: Domain & SSL

1. Go to your app's **Domains** tab in EasyPanel
2. Add your domain (e.g., `api.yourdomain.com`)
3. Configure DNS: Add an **A record** pointing to your VPS IP
4. EasyPanel will automatically provision an SSL certificate via Let's Encrypt

### Step 7: Deploy

1. Click **Deploy** in EasyPanel
2. Monitor the build logs
3. Once deployed, verify at `https://yourdomain.com/api/health`

---

## Updating the Application

### Automatic Deployment (Recommended)

1. Enable **Auto Deploy** in EasyPanel (Settings → Source → Auto Deploy)
2. Push changes to the `main` branch
3. EasyPanel automatically rebuilds and redeploys

```bash
git add .
git commit -m "feat: your changes"
git push origin main
```

### Manual Deployment

1. Push changes to GitHub
2. Go to EasyPanel → Your App → Click **Deploy**

> **Database safety:** Migrations are applied automatically (`AUTO_MIGRATE=true`). Data is never deleted unless you explicitly run a `down` migration. Uploaded files persist in Docker volumes.

---

## Backup & Restore

### Database Backup

```bash
# From EasyPanel — connect to your database service and run:
pg_dump -U zamo_app -d zamo -F c -f /backups/zamo_$(date +%Y%m%d).dump

# Or from outside (replace host/port with your DB service details):
docker exec <db-container> pg_dump -U zamo_app -d zamo -F c > backup.dump
```

### Database Restore

```bash
# Restore from a dump file:
pg_restore -U zamo_app -d zamo -c backup.dump
```

### Automated Backups

In EasyPanel, you can configure automatic backups for the PostgreSQL service. It's recommended to set up daily backups with 7-day retention.

---

## Architecture

```
src/
├── api/                  # HTTP layer (Fastify)
│   ├── middleware/        # Auth middleware, RLS injection
│   ├── routes/            # Route handlers (auth, catalog, booking, search, health)
│   └── server.ts          # Application bootstrap
├── config/               # Environment configuration (Zod-validated)
├── db/                   # Database access layer
│   ├── migrations/        # SQL migration files (21 migrations)
│   ├── client.ts          # Db interface (query, transaction, close)
│   ├── pg.ts              # Production PostgreSQL adapter (connection pool)
│   ├── migrate.ts         # Migration runner
│   └── testing.ts         # PGlite test adapter
├── modules/              # Business logic (modular monolith)
│   ├── agent/             # AI conversation agent (OpenAI / mock)
│   ├── audit/             # Tamper-evident audit log
│   ├── auth/              # OTP, sessions, passwords, MFA, RBAC
│   ├── billing/           # Commissions, invoices, payments
│   ├── booking/           # Booking lifecycle (state machine)
│   ├── catalog/           # Specialties, services, pricing
│   ├── compliance/        # Licensing
│   ├── facilities/        # Facility onboarding, branches
│   ├── growth/            # Attribution, campaigns
│   ├── hardening/         # Security, performance, accessibility audits
│   ├── notifications/     # Channel dispatcher, SLA monitoring
│   ├── operations/        # Dashboards, clinic calendar
│   ├── patient/           # Patient account management
│   ├── practitioners/     # Doctor management
│   ├── reporting/         # Financial and facility reports
│   ├── scheduling/        # Slot generation, holds
│   └── search/            # 13-filter search engine
├── shared/               # Shared utilities (i18n, Result type, SLA)
│   └── translations/     # Arabic and English translations
└── design-system/        # Design tokens (CSS + TS)
```

### Key Design Decisions

- **Modular Monolith:** Single deployable unit with strong module boundaries
- **PostgreSQL RLS:** Row-Level Security ensures tenants cannot access each other's data
- **OTP Auth:** Patients authenticate with phone + OTP (no passwords)
- **Bilingual:** Every user-facing string has Arabic and English variants
- **No Medical Data:** Schema explicitly excludes diagnostic/treatment fields (A-48/A-49)

---

## Testing

```bash
# Run all tests
npm test

# Unit tests only (Vitest)
npm run test:unit

# Integration tests (node:test + PGlite)
npm run test:integration

# Type checking
npm run typecheck

# Linting
npm run lint

# Full verification pipeline
npm run verify
```

---

## License

UNLICENSED — Private project.

