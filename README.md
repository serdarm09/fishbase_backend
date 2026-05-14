# FishBase Backend API

Backend API server for the FishBase Base App game.

## Features

- Base wallet authentication with signed SIWE-style challenges
- Firebase/Firestore profile and game persistence
- Daily claims, map movement, leaderboard, and NFT support routes
- Optional legacy Farcaster compatibility route

## Setup

```bash
npm install
cp env.sample .env
npm run dev
```

## Required Environment Variables

```env
PORT=5000
NODE_ENV=development
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
BASE_APP_ID=6a01ca209ee68cd142d1b1ac
JWT_SECRET=replace-with-a-long-random-secret
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=""
BASE_RPC_URL=https://mainnet.base.org
BASE_CHAIN_ID=8453
```

`APP_URL` should match the primary URL registered in Base.dev. `FRONTEND_URL` controls CORS for the frontend origin.

## Auth Routes

- `POST /api/auth/wallet-challenge` creates a short-lived wallet sign-in challenge.
- `POST /api/auth/wallet` verifies the signature and returns a JWT session.
- `POST /api/auth/farcaster` remains available for legacy users, but it is not required for Base App publishing.
- `POST /api/auth/refresh` refreshes an existing JWT.
- `GET /api/auth/me` returns the current user profile.

## Production Checklist

- Set a strong `JWT_SECRET`; do not reuse the sample value.
- Set `APP_URL` and frontend `NEXT_PUBLIC_APP_URL` to the same deployed URL.
- Fill in Firebase service account values.
- Replace zero contract addresses after deployment.
- Register the app in Base.dev with the same primary URL and app id.
