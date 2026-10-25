// Entry point serverless untuk Vercel
import { openDatabase } from "../src/db/database.js";
import { seed } from "../src/db/seed.js";
import { createApp } from "../src/app.js";

const db = openDatabase();

// Isi data awal jika database masih kosong (cold start)
if (db.prepare("SELECT COUNT(*) AS n FROM categories").get().n === 0) {
  seed(db);
}

export default createApp(db);
