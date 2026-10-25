import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { uploadImage, removeUploadedFile } from "../middleware/upload.js";

const productSchema = z.object({
  name: z.string().trim().min(3, "Nama produk minimal 3 karakter").max(120),
  description: z.string().trim().max(1000).default(""),
  price: z.coerce.number().int("Harga harus bilangan bulat").min(0, "Harga tidak boleh negatif"),
  stock: z.coerce.number().int("Stok harus bilangan bulat").min(0, "Stok tidak boleh negatif"),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  category_id: z.coerce.number().int().positive("Kategori wajib dipilih"),
});

const listSchema = z.object({
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
  seller: z.coerce.number().int().positive().optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "name"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

const SORTS = {
  newest: "p.id DESC",
  price_asc: "p.price ASC",
  price_desc: "p.price DESC",
  name: "p.name COLLATE NOCASE ASC",
};

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.description, p.price, p.stock, p.unit, p.image, p.is_active,
         p.created_at, p.seller_id, p.category_id,
         c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon,
         s.shop_name, s.location AS seller_location
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN sellers s ON s.id = p.seller_id`;

function sellerOf(db, userId) {
  const seller = db.prepare("SELECT id FROM sellers WHERE user_id = ?").get(userId);
  if (!seller) throw new HttpError(403, "Profil toko tidak ditemukan");
  return seller;
}

export default function catalogRoutes(db) {
  const router = Router();

  router.get("/categories", (req, res) => {
    const data = db
      .prepare(
        `SELECT c.id, c.name, c.slug, c.icon,
                (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS product_count
         FROM categories c ORDER BY c.id`
      )
      .all();
    res.json({ success: true, data });
  });

  router.get("/products", (req, res) => {
    const q = listSchema.parse(req.query);
    const where = ["p.is_active = 1"];
    const params = [];
    if (q.search) {
      where.push("(p.name LIKE ? OR p.description LIKE ? OR s.shop_name LIKE ?)");
      params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
    }
    if (q.category) {
      where.push("c.slug = ?");
      params.push(q.category);
    }
    if (q.seller) {
      where.push("p.seller_id = ?");
      params.push(q.seller);
    }
    const clause = `WHERE ${where.join(" AND ")}`;
    const total = db
      .prepare(
        `SELECT COUNT(*) AS n FROM products p
         JOIN categories c ON c.id = p.category_id
         JOIN sellers s ON s.id = p.seller_id ${clause}`
      )
      .get(...params).n;
    const items = db
      .prepare(`${PRODUCT_SELECT} ${clause} ORDER BY ${SORTS[q.sort]} LIMIT ? OFFSET ?`)
      .all(...params, q.limit, (q.page - 1) * q.limit);

    res.json({
      success: true,
      data: {
        items,
        pagination: {
          page: q.page,
          limit: q.limit,
          total,
          total_pages: Math.max(1, Math.ceil(total / q.limit)),
        },
      },
    });
  });

  router.get("/products/:id", (req, res) => {
    const product = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(req.params.id);
    if (!product || !product.is_active) throw new HttpError(404, "Produk tidak ditemukan");
    res.json({ success: true, data: product });
  });

  router.get("/sellers", (req, res) => {
    const data = db
      .prepare(
        `SELECT s.id, s.shop_name, s.description, s.location,
                (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id AND p.is_active = 1) AS product_count
         FROM sellers s ORDER BY s.shop_name COLLATE NOCASE`
      )
      .all();
    res.json({ success: true, data });
  });

  router.get("/sellers/:id", (req, res) => {
    const seller = db
      .prepare("SELECT id, shop_name, description, location, phone FROM sellers WHERE id = ?")
      .get(req.params.id);
    if (!seller) throw new HttpError(404, "Penjual tidak ditemukan");
    const products = db
      .prepare(`${PRODUCT_SELECT} WHERE p.seller_id = ? AND p.is_active = 1 ORDER BY p.id DESC`)
      .all(seller.id);
    res.json({ success: true, data: { ...seller, products } });
  });

  // ---------- Area penjual: kelola produk milik sendiri ----------
  const seller = [authRequired, requireRole("seller")];

  router.get("/seller/products", ...seller, (req, res) => {
    const s = sellerOf(db, req.user.id);
    const data = db
      .prepare(`${PRODUCT_SELECT} WHERE p.seller_id = ? ORDER BY p.id DESC`)
      .all(s.id);
    res.json({ success: true, data });
  });

  router.post("/seller/products", ...seller, uploadImage, (req, res) => {
    try {
      const s = sellerOf(db, req.user.id);
      const data = productSchema.parse(req.body);
      if (!db.prepare("SELECT id FROM categories WHERE id = ?").get(data.category_id)) {
        throw new HttpError(400, "Kategori tidak ditemukan");
      }
      const result = db
        .prepare(
          `INSERT INTO products (seller_id, category_id, name, description, price, stock, unit, image)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          s.id, data.category_id, data.name, data.description,
          data.price, data.stock, data.unit, req.file?.filename || ""
        );
      const product = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(result.lastInsertRowid);
      res.status(201).json({ success: true, message: "Produk berhasil ditambahkan", data: product });
    } catch (err) {
      removeUploadedFile(req.file?.filename);
      throw err;
    }
  });

  router.put("/seller/products/:id", ...seller, uploadImage, (req, res) => {
    try {
      const s = sellerOf(db, req.user.id);
      const existing = db
        .prepare("SELECT * FROM products WHERE id = ? AND seller_id = ?")
        .get(req.params.id, s.id);
      if (!existing) throw new HttpError(404, "Produk tidak ditemukan");
      const data = productSchema.parse(req.body);
      const isActive =
        req.body.is_active === undefined
          ? existing.is_active
          : Number(req.body.is_active === "true" || req.body.is_active === "1" || req.body.is_active === true);
      const image = req.file?.filename || existing.image;
      db.prepare(
        `UPDATE products SET category_id=?, name=?, description=?, price=?, stock=?, unit=?, image=?, is_active=?
         WHERE id=?`
      ).run(
        data.category_id, data.name, data.description, data.price,
        data.stock, data.unit, image, isActive, existing.id
      );
      if (req.file && existing.image) removeUploadedFile(existing.image);
      const product = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(existing.id);
      res.json({ success: true, message: "Produk berhasil diperbarui", data: product });
    } catch (err) {
      removeUploadedFile(req.file?.filename);
      throw err;
    }
  });

  router.delete("/seller/products/:id", ...seller, (req, res) => {
    const s = sellerOf(db, req.user.id);
    const existing = db
      .prepare("SELECT * FROM products WHERE id = ? AND seller_id = ?")
      .get(req.params.id, s.id);
    if (!existing) throw new HttpError(404, "Produk tidak ditemukan");
    const used = db
      .prepare("SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?")
      .get(existing.id).n;
    if (used > 0) {
      // Sudah pernah dipesan: nonaktifkan agar riwayat pesanan tetap utuh
      db.prepare("UPDATE products SET is_active = 0 WHERE id = ?").run(existing.id);
      return res.json({ success: true, message: "Produk dinonaktifkan karena sudah pernah dipesan" });
    }
    db.prepare("DELETE FROM products WHERE id = ?").run(existing.id);
    removeUploadedFile(existing.image);
    res.json({ success: true, message: "Produk berhasil dihapus" });
  });

  return router;
}