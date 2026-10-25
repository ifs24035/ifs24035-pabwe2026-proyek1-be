import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/error.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.coerce.number().int().positive(),
        quantity: z.coerce.number().int().min(1, "Jumlah minimal 1").max(999),
      })
    )
    .min(1, "Keranjang masih kosong"),
  address: z.string().trim().min(5, "Alamat minimal 5 karakter").max(300),
  note: z.string().trim().max(300).default(""),
});

const statusSchema = z.object({
  status: z.enum(["diproses", "dikirim", "selesai", "dibatalkan"]),
});

// Alur status yang diizinkan untuk penjual
const TRANSITIONS = {
  pending: ["diproses", "dibatalkan"],
  diproses: ["dikirim", "dibatalkan"],
  dikirim: ["selesai"],
};

const ORDER_SELECT = `
  SELECT o.id, o.status, o.total, o.address, o.note, o.created_at, o.updated_at,
         o.buyer_id, o.seller_id,
         u.name AS buyer_name, s.shop_name, s.phone AS seller_phone
  FROM orders o
  JOIN users u ON u.id = o.buyer_id
  JOIN sellers s ON s.id = o.seller_id`;

export default function orderRoutes(db) {
  const router = Router();

  function withItems(orders) {
    const stmt = db.prepare(
      "SELECT id, product_id, product_name, price, quantity FROM order_items WHERE order_id = ?"
    );
    return orders.map((o) => ({ ...o, items: stmt.all(o.id) }));
  }

  function restoreStock(orderId) {
    const items = db
      .prepare("SELECT product_id, quantity FROM order_items WHERE order_id = ?")
      .all(orderId);
    const stmt = db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
    for (const it of items) stmt.run(it.quantity, it.product_id);
  }

  function sellerIdOf(userId) {
    const s = db.prepare("SELECT id FROM sellers WHERE user_id = ?").get(userId);
    if (!s) throw new HttpError(403, "Profil toko tidak ditemukan");
    return s.id;
  }

  // ---------- Pembeli ----------
  router.post("/orders", authRequired, requireRole("buyer"), (req, res) => {
    const data = checkoutSchema.parse(req.body);

    // gabungkan item dengan product_id sama
    const merged = new Map();
    for (const it of data.items) {
      merged.set(it.product_id, (merged.get(it.product_id) || 0) + it.quantity);
    }

    const checkout = db.transaction(() => {
      const bySeller = new Map();
      for (const [productId, qty] of merged) {
        const p = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
        if (!p || !p.is_active) throw new HttpError(400, `Produk #${productId} tidak tersedia`);
        if (p.stock < qty) {
          throw new HttpError(400, `Stok "${p.name}" tidak mencukupi (sisa ${p.stock})`);
        }
        if (!bySeller.has(p.seller_id)) bySeller.set(p.seller_id, []);
        bySeller.get(p.seller_id).push({ product: p, qty });
      }

      const orderIds = [];
      for (const [sellerId, lines] of bySeller) {
        const total = lines.reduce((sum, l) => sum + l.product.price * l.qty, 0);
        const order = db
          .prepare(
            "INSERT INTO orders (buyer_id, seller_id, total, address, note) VALUES (?, ?, ?, ?, ?)"
          )
          .run(req.user.id, sellerId, total, data.address, data.note);
        for (const { product, qty } of lines) {
          db.prepare(
            "INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES (?, ?, ?, ?, ?)"
          ).run(order.lastInsertRowid, product.id, product.name, product.price, qty);
          db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(qty, product.id);
        }
        orderIds.push(order.lastInsertRowid);
      }
      return orderIds;
    });

    const ids = checkout();
    const orders = withItems(
      ids.map((id) => db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id))
    );
    res.status(201).json({ success: true, message: "Pesanan berhasil dibuat", data: orders });
  });

  router.get("/orders/mine", authRequired, requireRole("buyer"), (req, res) => {
    const rows = db
      .prepare(`${ORDER_SELECT} WHERE o.buyer_id = ? ORDER BY o.id DESC`)
      .all(req.user.id);
    res.json({ success: true, data: withItems(rows) });
  });

  router.patch("/orders/:id/cancel", authRequired, requireRole("buyer"), (req, res) => {
    const order = db
      .prepare("SELECT * FROM orders WHERE id = ? AND buyer_id = ?")
      .get(req.params.id, req.user.id);
    if (!order) throw new HttpError(404, "Pesanan tidak ditemukan");
    if (order.status !== "pending") {
      throw new HttpError(400, "Hanya pesanan berstatus pending yang bisa dibatalkan");
    }
    db.transaction(() => {
      db.prepare(
        "UPDATE orders SET status = 'dibatalkan', updated_at = datetime('now') WHERE id = ?"
      ).run(order.id);
      restoreStock(order.id);
    })();
    const [updated] = withItems([db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(order.id)]);
    res.json({ success: true, message: "Pesanan dibatalkan", data: updated });
  });

  // ---------- Penjual ----------
  router.get("/seller/orders", authRequired, requireRole("seller"), (req, res) => {
    const sellerId = sellerIdOf(req.user.id);
    const rows = db
      .prepare(`${ORDER_SELECT} WHERE o.seller_id = ? ORDER BY o.id DESC`)
      .all(sellerId);
    res.json({ success: true, data: withItems(rows) });
  });

  router.get("/seller/stats", authRequired, requireRole("seller"), (req, res) => {
    const sellerId = sellerIdOf(req.user.id);
    const products = db
      .prepare(
        "SELECT COUNT(*) AS total, COALESCE(SUM(stock <= 5 AND is_active = 1), 0) AS low_stock FROM products WHERE seller_id = ?"
      )
      .get(sellerId);
    const orders = db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(status = 'pending'), 0) AS pending,
                COALESCE(SUM(CASE WHEN status = 'selesai' THEN total ELSE 0 END), 0) AS revenue
         FROM orders WHERE seller_id = ?`
      )
      .get(sellerId);
    res.json({ success: true, data: { products, orders } });
  });

  router.patch("/orders/:id/status", authRequired, requireRole("seller"), (req, res) => {
    const { status } = statusSchema.parse(req.body);
    const sellerId = sellerIdOf(req.user.id);
    const order = db
      .prepare("SELECT * FROM orders WHERE id = ? AND seller_id = ?")
      .get(req.params.id, sellerId);
    if (!order) throw new HttpError(404, "Pesanan tidak ditemukan");
    if (!(TRANSITIONS[order.status] || []).includes(status)) {
      throw new HttpError(400, `Status tidak bisa diubah dari "${order.status}" ke "${status}"`);
    }
    db.transaction(() => {
      db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
        status,
        order.id
      );
      if (status === "dibatalkan") restoreStock(order.id);
    })();
    const [updated] = withItems([db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(order.id)]);
    res.json({ success: true, message: "Status pesanan diperbarui", data: updated });
  });

  // ---------- Detail (pembeli pemilik / penjual pemilik) ----------
  router.get("/orders/:id", authRequired, (req, res) => {
    const row = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(req.params.id);
    if (!row) throw new HttpError(404, "Pesanan tidak ditemukan");
    let allowed = false;
    if (req.user.role === "buyer") allowed = row.buyer_id === req.user.id;
    else allowed = row.seller_id === sellerIdOf(req.user.id);
    if (!allowed) throw new HttpError(404, "Pesanan tidak ditemukan");
    res.json({ success: true, data: withItems([row])[0] });
  });

  return router;
}