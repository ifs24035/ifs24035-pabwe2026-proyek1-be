# ifs24035-pabwe2026-proyek1-be

REST API LapoTa (Express 5 + SQLite). Backend untuk Proyek 1 PABWE 2026.

## Menjalankan lokal
```bash
cp .env.example .env
npm install
npm start          # http://localhost:5000
npm run test:coverage
```

## Endpoint utama
`/api/health`, `/api/auth/*`, `/api/categories`, `/api/products`, `/api/sellers`,
`/api/seller/products`, `/api/orders`, `/api/seller/orders`, `/api/seller/stats`.

## Deploy (Vercel)
Entry point: `api/index.js`, rewrite di `vercel.json`.
Environment Variables: `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN` (URL frontend).
Catatan: di Vercel database SQLite berada di `/tmp` sehingga bersifat sementara.
