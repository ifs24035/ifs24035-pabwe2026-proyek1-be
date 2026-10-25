import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { signToken, authRequired } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";

const registerSchema = z
  .object({
    name: z.string().trim().min(3, "Nama minimal 3 karakter").max(80),
    email: z.string().trim().toLowerCase().email("Email tidak valid"),
    password: z.string().min(6, "Password minimal 6 karakter").max(100),
    role: z.enum(["buyer", "seller"]).default("buyer"),
    shop_name: z.string().trim().min(3, "Nama toko minimal 3 karakter").max(80).optional(),
    location: z.string().trim().max(100).optional(),
    phone: z.string().trim().max(20).optional(),
  })
  .refine((d) => d.role !== "seller" || d.shop_name, {
    path: ["shop_name"],
    message: "Nama toko wajib diisi untuk penjual",
  });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
});

export function profileOf(db, userId) {
  const user = db
    .prepare("SELECT id, name, email, role, created_at FROM users WHERE id = ?")
    .get(userId);
  if (!user) return null;
  if (user.role === "seller") {
    user.seller = db
      .prepare("SELECT id, shop_name, description, location, phone FROM sellers WHERE user_id = ?")
      .get(userId);
  }
  return user;
}

export default function authRoutes(db) {
  const router = Router();

  router.post("/register", (req, res) => {
    const data = registerSchema.parse(req.body);
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(data.email)) {
      throw new HttpError(409, "Email sudah terdaftar");
    }
    const hash = bcrypt.hashSync(data.password, 10);

    const create = db.transaction(() => {
      const result = db
        .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)")
        .run(data.name, data.email, hash, data.role);
      if (data.role === "seller") {
        db.prepare(
          "INSERT INTO sellers (user_id, shop_name, location, phone) VALUES (?, ?, ?, ?)"
        ).run(result.lastInsertRowid, data.shop_name, data.location || "", data.phone || "");
      }
      return result.lastInsertRowid;
    });

    const userId = create();
    const user = profileOf(db, userId);
    res.status(201).json({
      success: true,
      message: "Pendaftaran berhasil",
      data: { token: signToken(user), user },
    });
  });

  router.post("/login", (req, res) => {
    const data = loginSchema.parse(req.body);
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(data.email);
    if (!row || !bcrypt.compareSync(data.password, row.password_hash)) {
      throw new HttpError(401, "Email atau password salah");
    }
    const user = profileOf(db, row.id);
    res.json({
      success: true,
      message: "Login berhasil",
      data: { token: signToken(user), user },
    });
  });

  router.get("/me", authRequired, (req, res) => {
    const user = profileOf(db, req.user.id);
    if (!user) throw new HttpError(401, "Akun tidak ditemukan");
    res.json({ success: true, data: { user } });
  });

  return router;
}