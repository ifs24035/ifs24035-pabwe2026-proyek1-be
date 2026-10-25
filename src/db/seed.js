import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./database.js";

const CATEGORIES = [
  ["Kopi & Rempah", "kopi-rempah", "☕"],
  ["Ikan & Hasil Danau", "ikan-hasil-danau", "🐟"],
  ["Tenun & Ulos", "tenun-ulos", "🧵"],
  ["Pangan Olahan", "pangan-olahan", "🍯"],
  ["Hasil Bumi", "hasil-bumi", "🌽"],
  ["Kerajinan Tangan", "kerajinan-tangan", "🪵"],
];

const SELLERS = [
  {
    name: "Op. Sinta Simanjuntak",
    email: "penjual1@lapota.id",
    shop: "Kopi Sipirok Horas",
    location: "Balige, Toba",
    phone: "081234560001",
    description: "Kopi arabika dan rempah pilihan langsung dari petani Tanah Batak.",
    products: [
      ["Kopi Arabika Sidikalang 250g", "kopi-rempah", 55000, 40, "bungkus", "Kopi arabika sangrai medium dengan aroma kuat dan rasa khas."],
      ["Kopi Lintong Biji Mentah 1kg", "kopi-rempah", 120000, 25, "kg", "Green bean Lintong grade 1, cocok untuk roaster rumahan."],
      ["Andaliman Kering 50g", "kopi-rempah", 25000, 60, "bungkus", "Rempah khas Batak untuk arsik dan saksang."],
      ["Jahe Merah Bubuk 200g", "kopi-rempah", 30000, 35, "bungkus", "Jahe merah murni tanpa campuran gula."],
    ],
  },
  {
    name: "Pak Ruben Siahaan",
    email: "penjual2@lapota.id",
    shop: "Tao Toba Mart",
    location: "Laguboti, Toba",
    phone: "081234560002",
    description: "Ikan, olahan, dan kerajinan segar dari sekitar Danau Toba.",
    products: [
      ["Ikan Mas Segar 1kg", "ikan-hasil-danau", 45000, 20, "kg", "Ikan mas segar dari keramba Danau Toba."],
      ["Ikan Pora-Pora Asin 500g", "ikan-hasil-danau", 38000, 30, "bungkus", "Ikan pora-pora asin kering khas Toba."],
      ["Ulos Ragidup Mini", "tenun-ulos", 275000, 8, "lembar", "Ulos tenun tangan ukuran mini untuk hiasan dan suvenir."],
      ["Selendang Ulos Sadum", "tenun-ulos", 150000, 15, "lembar", "Selendang bermotif sadum warna cerah."],
      ["Madu Hutan Humbang 500ml", "pangan-olahan", 90000, 18, "botol", "Madu murni dari hutan Humbang."],
      ["Bawang Batak Merah 1kg", "hasil-bumi", 40000, 50, "kg", "Bawang merah khas Samosir, wangi dan tahan lama."],
      ["Ukiran Gorga Gantungan Kunci", "kerajinan-tangan", 20000, 70, "pcs", "Gantungan kunci kayu berukir motif gorga."],
    ],
  },
];

export function seed(db) {
  const insertCategory = db.prepare(
    "INSERT OR IGNORE INTO categories (name, slug, icon) VALUES (?, ?, ?)"
  );
  for (const c of CATEGORIES) insertCategory.run(...c);

  const hash = bcrypt.hashSync("password123", 10);
  const buyerExists = db.prepare("SELECT id FROM users WHERE email = ?");

  if (!buyerExists.get("pembeli@lapota.id")) {
    db.prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'buyer')"
    ).run("Pembeli Demo", "pembeli@lapota.id", hash);
  }

  for (const s of SELLERS) {
    if (buyerExists.get(s.email)) continue;
    const user = db
      .prepare(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'seller')"
      )
      .run(s.name, s.email, hash);
    const seller = db
      .prepare(
        "INSERT INTO sellers (user_id, shop_name, description, location, phone) VALUES (?, ?, ?, ?, ?)"
      )
      .run(user.lastInsertRowid, s.shop, s.description, s.location, s.phone);

    for (const [name, slug, price, stock, unit, desc] of s.products) {
      const cat = db.prepare("SELECT id FROM categories WHERE slug = ?").get(slug);
      db.prepare(
        `INSERT INTO products (seller_id, category_id, name, description, price, stock, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(seller.lastInsertRowid, cat.id, name, desc, price, stock, unit);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDatabase();
  seed(db);
  console.log("Seed selesai. Akun demo (password: password123):");
  console.log("  pembeli@lapota.id | penjual1@lapota.id | penjual2@lapota.id");
}