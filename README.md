# GuideMe Backend API

A Node.js/Express/TypeScript REST API for the GuideMe application — a guided learning platform with AI-powered assistance, text-to-speech, community features, and subscription billing.

## Tech Stack

- **Runtime:** Node.js, TypeScript
- **Framework:** Express 5
- **Database:** PostgreSQL (via Prisma ORM)
- **Auth:** JWT, Google OAuth, Facebook OAuth
- **File Storage:** Cloudinary, local `uploads/` directory
- **Email:** Resend (transactional emails)
- **AI:** AI-powered guide generation
- **TTS:** Text-to-speech conversion
- **Payments:** Bakong webhook integration
- **API Docs:** Swagger (OpenAPI 3)
- **Testing:** Vitest, Supertest

## Prerequisites

- Node.js >= 18
- PostgreSQL database (e.g., [Neon](https://neon.tech))
- Cloudinary account (for file uploads)
- Resend API key (for emails — falls back to `console.log` if empty)

## Setup

```bash
# 1. Clone and install
npm install

# 2. Configure environment
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, and other values

# 3. Generate Prisma client and run migrations
npm run prisma:generate
npm run prisma:migrate

# 4. Seed the database (optional)
npm run prisma:seed

# 5. Start development server
npm run dev
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Generate Prisma client + compile TypeScript |
| `npm start` | Run compiled production build |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Apply database migrations |
| `npm run prisma:migrate:prod` | Deploy migrations in production |
| `npm run prisma:seed` | Seed the database |
| `npm run prisma:studio` | Open Prisma Studio |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 4000) |
| `NODE_ENV` | `development` or `production` |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key for JWT signing |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `FACEBOOK_APP_ID` | Facebook OAuth app ID |
| `CLOUDINARY_*` | Cloudinary credentials |
| `UPLOAD_DIR` | Local upload directory |
| `CLIENT_URL` | Frontend URL (for CORS) |
| `API_URL` | Backend API URL |
| `RESEND_API_KEY` | Resend API key for emails |
| `CONTACT_EMAIL` | Contact email address |

## API Endpoints

| Prefix | Module | Description |
|--------|--------|-------------|
| `POST /api/auth/*` | Auth | Register, login, OAuth (Google/Facebook), logout |
| `GET/PUT /api/user/*` | User | Profile, settings, notifications |
| `GET /api/guides/*` | Guides | Browse guides, track progress |
| `POST /api/ai/*` | AI | AI-powered guide generation |
| `POST /api/tts/*` | TTS | Text-to-speech conversion |
| `GET/POST /api/billing/*` | Billing | Subscription plans, payment methods, history |
| `POST /api/bakong-webhook` | Webhook | Bakong payment callback |
| `GET/POST /api/community/*` | Community | Posts, comments, contributors |
| `POST /api/support/*` | Support | Submit support tickets |
| `GET /health` | Health | Health check |

Full interactive documentation is available at `/api-docs` when the server is running.

## Project Structure

```
src/
  config/         # App configuration (env, db, swagger)
  controllers/    # Request handlers
  middleware/     # Auth, validation, error handling
  routes/         # Express route definitions
  services/       # Business logic layer
  __tests__/      # Test files
prisma/
  schema.prisma   # Database schema
  seed.ts         # Database seeder
  migrations/     # Migration history
```

## CORS

The server accepts requests from:
- `CLIENT_URL` (configured via env)
- `http://localhost:3000` and `http://localhost:5173`
- `https://guideme-lac.vercel.app`
- Any Chrome extension origin (in development mode)
- Only the registered extension ID in production

## License

ISC