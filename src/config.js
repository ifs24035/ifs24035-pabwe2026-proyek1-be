import "dotenv/config";
import path from "node:path";

// Di Vercel, satu-satunya folder yang boleh ditulis adalah /tmp
const isVercel = Boolean(process.env.VERCEL);

export const config = {
  port: Number(process.env.PORT) || 5000,
  jwtSecret: process.env.JWT_SECRET || "dev-secret-ganti-di-produksi",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  dbPath: path.resolve(process.env.DB_PATH || (isVercel ? "/tmp/lapota.db" : "./data/lapota.db")),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || (isVercel ? "/tmp/uploads" : "./uploads")),
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim()),
};