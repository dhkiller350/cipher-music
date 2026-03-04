# Cipher Music – Next.js Backend

This directory contains a Next.js 14 app that provides:
- API routes (Supabase-backed) for accounts, playlists, liked songs, recently played, payments, and access logging
- Stripe webhook handling with HMAC signature verification
- PWA manifest and service worker generation via `@ducanh2912/next-pwa`

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Stripe](https://stripe.com) account (for payments)

## Supabase Setup

1. Create a new Supabase project.
2. In the SQL editor, run the contents of `schema.sql` to create all required tables.
3. Copy your **Project URL**, **anon key**, and **service_role key** from _Project Settings → API_.

## Stripe Webhook Setup

1. In the Stripe Dashboard go to _Developers → Webhooks_ and add an endpoint:
   - URL: `https://<your-domain>/api/webhooks/stripe`
   - Events to listen for: `checkout.session.completed`, `customer.subscription.deleted`, `setup_intent.created`, `payment_intent.succeeded`, `payment_intent.payment_failed`
2. Copy the **Signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in all values:

```
cp .env.local.example .env.local
```

## Running Locally

```bash
npm install
npm run dev
```

The app starts on <http://localhost:3000>.

## Building for Production

```bash
npm run build
npm start
```

## Deployment

**Vercel (recommended)**

1. Push this repo (or the `nextjs/` subdirectory) to GitHub.
2. Import the project in [Vercel](https://vercel.com), set the root directory to `nextjs/`.
3. Add all environment variables from `.env.local.example` in the Vercel dashboard.
4. Deploy.

**Any Node.js host**

```bash
npm run build
npm start   # Runs on PORT env var, default 3000
```
