import { config } from "./config.js";
import { openDatabase } from "./db/database.js";
import { seed } from "./db/seed.js";
import { createApp } from "./app.js";

const db = openDatabase();

// Isi data awal hanya jika database masih kosong
if (db.prepare("SELECT COUNT(*) AS n FROM categories").get().n === 0) {
  seed(db);
  console.log("Database kosong, data awal (seed) berhasil dibuat.");
}

createApp(db).listen(config.port, () => {
  console.log(`LapoTa API berjalan di http://localhost:${config.port}`);
});