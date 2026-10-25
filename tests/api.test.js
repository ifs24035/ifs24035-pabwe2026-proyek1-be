import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Foto uji disimpan di folder sementara agar folder uploads asli tetap bersih
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "lapota-test-"));
process.env.UPLOAD_DIR = uploadDir;

const { openDatabase } = await import("../src/db/database.js");
const { seed } = await import("../src/db/seed.js");
const { createApp } = await import("../src/app.js");

let server, base, db;

before(async () => {
  db = openDatabase(":memory:");
  seed(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

async function call(path, { method = "GET", token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

const login = async (email) =>
  (await call("/auth/login", { method: "POST", body: { email, password: "password123" } })).json
    .data.token;

test("health check", async () => {
  const r = await call("/health");
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
});

test("daftar kategori dan produk (publik)", async () => {
  const cats = await call("/categories");
  assert.equal(cats.json.data.length, 6);
  const prods = await call("/products?category=kopi-rempah&sort=price_asc");
  assert.ok(prods.json.data.items.length >= 3);
  assert.ok(prods.json.data.items.every((p) => p.category_slug === "kopi-rempah"));
  const search = await call("/products?search=ulos");
  assert.ok(search.json.data.items.length >= 1);
});

test("register, login, dan validasi", async () => {
  const bad = await call("/auth/register", { method: "POST", body: { name: "a", email: "x", password: "1" } });
  assert.equal(bad.status, 400);
  const ok = await call("/auth/register", {
    method: "POST",
    body: { name: "Budi Pembeli", email: "budi@mail.com", password: "rahasia123" },
  });
  assert.equal(ok.status, 201);
  const dup = await call("/auth/register", {
    method: "POST",
    body: { name: "Budi Pembeli", email: "budi@mail.com", password: "rahasia123" },
  });
  assert.equal(dup.status, 409);
  const wrong = await call("/auth/login", { method: "POST", body: { email: "budi@mail.com", password: "salah" } });
  assert.equal(wrong.status, 401);
});

test("endpoint terproteksi menolak tanpa token / peran salah", async () => {
  assert.equal((await call("/orders/mine")).status, 401);
  const buyer = await login("pembeli@lapota.id");
  assert.equal((await call("/seller/products", { token: buyer })).status, 403);
});

test("pembeli melihat daftar pesanan miliknya", async () => {
  const buyer = await login("pembeli@lapota.id");
  const res = await call("/orders/mine", { token: buyer });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.data));
});

test("alur pesanan: checkout, stok berkurang, status, batal mengembalikan stok", async () => {
  const buyer = await login("pembeli@lapota.id");
  const seller = await login("penjual1@lapota.id");

  const before = (await call("/products/1")).json.data.stock;
  const co = await call("/orders", {
    method: "POST",
    token: buyer,
    body: { items: [{ product_id: 1, quantity: 2 }, { product_id: 5, quantity: 1 }], address: "Jl. Sisingamangaraja No. 1, Laguboti" },
  });
  assert.equal(co.status, 201);
  assert.equal(co.json.data.length, 2); // dipecah per penjual
  assert.equal((await call("/products/1")).json.data.stock, before - 2);

  const order = co.json.data.find((o) => o.items.some((i) => i.product_id === 1));
  const bad = await call(`/orders/${order.id}/status`, { method: "PATCH", token: seller, body: { status: "selesai" } });
  assert.equal(bad.status, 400);
  const ok = await call(`/orders/${order.id}/status`, { method: "PATCH", token: seller, body: { status: "diproses" } });
  assert.equal(ok.json.data.status, "diproses");

  const sellerOrders = await call("/seller/orders", { token: seller });
  assert.ok(sellerOrders.json.data.some((o) => o.id === order.id));

  const other = co.json.data.find((o) => o.id !== order.id);
  const cancel = await call(`/orders/${other.id}/cancel`, { method: "PATCH", token: buyer });
  assert.equal(cancel.json.data.status, "dibatalkan");

  const tooMany = await call("/orders", {
    method: "POST", token: buyer,
    body: { items: [{ product_id: 1, quantity: 9999 }], address: "Alamat panjang sekali" },
  });
  assert.equal(tooMany.status, 400);
});

test("penjual mengelola produk sendiri", async () => {
  const seller = await login("penjual1@lapota.id");
  const form = new FormData();
  Object.entries({ name: "Teh Herbal Toba", price: 20000, stock: 10, unit: "bungkus", category_id: 4, description: "Teh" })
    .forEach(([k, v]) => form.append(k, String(v)));
  const res = await fetch(base + "/seller/products", { method: "POST", headers: { Authorization: `Bearer ${seller}` }, body: form });
  assert.equal(res.status, 201);
  const created = (await res.json()).data;
  const del = await call(`/seller/products/${created.id}`, { method: "DELETE", token: seller });
  assert.equal(del.status, 200);
  const seller2 = await login("penjual2@lapota.id");
  assert.equal((await call("/seller/products/1", { method: "DELETE", token: seller2 })).status, 404);
});

test("endpoint tidak dikenal dan JSON rusak ditangani dengan rapi", async () => {
  const nf = await call("/tidak-ada");
  assert.equal(nf.status, 404);
  const res = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{rusak",
  });
  assert.equal(res.status, 400);
  const bad = await fetch(base + "/auth/me", { headers: { Authorization: "Bearer token-palsu" } });
  assert.equal(bad.status, 401);
});

test("profil, daftar toko, dan detail toko/produk", async () => {
  const buyer = await login("pembeli@lapota.id");
  const me = await call("/auth/me", { token: buyer });
  assert.equal(me.json.data.user.email, "pembeli@lapota.id");

  const sellerToken = await login("penjual1@lapota.id");
  const sellerMe = await call("/auth/me", { token: sellerToken });
  assert.equal(sellerMe.json.data.user.seller.shop_name, "Kopi Sipirok Horas");

  const sellers = await call("/sellers");
  assert.equal(sellers.json.data.length, 2);
  const detail = await call("/sellers/1");
  assert.ok(detail.json.data.products.length >= 1);
  assert.equal((await call("/sellers/999")).status, 404);
  assert.equal((await call("/products/999")).status, 404);
  const filtered = await call("/products?seller=1&page=1&limit=2&sort=name");
  assert.equal(filtered.json.data.pagination.limit, 2);
  assert.equal((await call("/products?sort=asal")).status, 400);
});

test("pembeli mendaftar sebagai penjual dan wajib mengisi nama toko", async () => {
  const noShop = await call("/auth/register", {
    method: "POST",
    body: { name: "Penjual Baru", email: "baru@toko.id", password: "rahasia123", role: "seller" },
  });
  assert.equal(noShop.status, 400);
  const ok = await call("/auth/register", {
    method: "POST",
    body: { name: "Penjual Baru", email: "baru@toko.id", password: "rahasia123", role: "seller", shop_name: "Toko Baru", location: "Balige" },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.user.seller.shop_name, "Toko Baru");
});

test("statistik, detail pesanan, dan aturan perubahan status", async () => {
  const buyer = await login("pembeli@lapota.id");
  const seller1 = await login("penjual1@lapota.id");
  const seller2 = await login("penjual2@lapota.id");

  const co = await call("/orders", {
    method: "POST",
    token: buyer,
    body: { items: [{ product_id: 2, quantity: 1 }, { product_id: 2, quantity: 1 }], address: "Jl. Balige No. 5, Toba" },
  });
  assert.equal(co.status, 201);
  const order = co.json.data[0];
  assert.equal(order.items[0].quantity, 2); // item sama digabung

  assert.equal((await call(`/orders/${order.id}`, { token: buyer })).status, 200);
  assert.equal((await call(`/orders/${order.id}`, { token: seller1 })).status, 200);
  assert.equal((await call(`/orders/${order.id}`, { token: seller2 })).status, 404);
  assert.equal((await call("/orders/9999", { token: buyer })).status, 404);

  const stats = await call("/seller/stats", { token: seller1 });
  assert.ok(stats.json.data.orders.pending >= 1);

  // jalur penuh: diproses, dikirim, selesai; setelah itu tidak bisa dibatalkan pembeli
  for (const status of ["diproses", "dikirim", "selesai"]) {
    const r = await call(`/orders/${order.id}/status`, { method: "PATCH", token: seller1, body: { status } });
    assert.equal(r.status, 200);
  }
  const cancel = await call(`/orders/${order.id}/cancel`, { method: "PATCH", token: buyer });
  assert.equal(cancel.status, 400);
  const other = await call(`/orders/${order.id}/status`, { method: "PATCH", token: seller2, body: { status: "dibatalkan" } });
  assert.equal(other.status, 404);
});

test("penjual membatalkan pesanan: stok kembali", async () => {
  const buyer = await login("pembeli@lapota.id");
  const seller1 = await login("penjual1@lapota.id");
  const stokAwal = (await call("/products/3")).json.data.stock;
  const co = await call("/orders", {
    method: "POST",
    token: buyer,
    body: { items: [{ product_id: 3, quantity: 4 }], address: "Jl. Laguboti No. 9, Toba" },
  });
  assert.equal((await call("/products/3")).json.data.stock, stokAwal - 4);
  const r = await call(`/orders/${co.json.data[0].id}/status`, { method: "PATCH", token: seller1, body: { status: "dibatalkan" } });
  assert.equal(r.json.data.status, "dibatalkan");
  assert.equal((await call("/products/3")).json.data.stock, stokAwal);
});

test("checkout menolak produk tidak ada atau nonaktif", async () => {
  const buyer = await login("pembeli@lapota.id");
  const r = await call("/orders", {
    method: "POST",
    token: buyer,
    body: { items: [{ product_id: 9999, quantity: 1 }], address: "Jl. Contoh No. 1, Toba" },
  });
  assert.equal(r.status, 400);
});

function productForm(extra = {}, file) {
  const form = new FormData();
  const base = { name: "Kopi Uji Coba", price: 10000, stock: 5, unit: "bungkus", category_id: 1, description: "Uji" };
  Object.entries({ ...base, ...extra }).forEach(([k, v]) => form.append(k, String(v)));
  if (file) form.append("image", file);
  return form;
}

test("unggah foto produk: berhasil, ditolak jika salah format atau terlalu besar", async () => {
  const seller = await login("penjual1@lapota.id");
  const headers = { Authorization: `Bearer ${seller}` };
  const png = new File([Buffer.from("89504e470d0a1a0a", "hex")], "foto.png", { type: "image/png" });

  const created = await fetch(base + "/seller/products", { method: "POST", headers, body: productForm({}, png) });
  assert.equal(created.status, 201);
  const product = (await created.json()).data;
  assert.match(product.image, /\.png$/);
  assert.ok(fs.existsSync(path.join(uploadDir, product.image)));

  const txt = new File(["bukan gambar"], "a.txt", { type: "text/plain" });
  const wrongType = await fetch(base + "/seller/products", { method: "POST", headers, body: productForm({}, txt) });
  assert.equal(wrongType.status, 400);

  const big = new File([Buffer.alloc(3 * 1024 * 1024)], "besar.png", { type: "image/png" });
  const tooBig = await fetch(base + "/seller/products", { method: "POST", headers, body: productForm({}, big) });
  assert.equal(tooBig.status, 400);

  const badData = await fetch(base + "/seller/products", { method: "POST", headers, body: productForm({ price: -5 }) });
  assert.equal(badData.status, 400);
  const badCategory = await fetch(base + "/seller/products", { method: "POST", headers, body: productForm({ category_id: 999 }) });
  assert.equal(badCategory.status, 400);

  // ubah produk: ganti foto, nonaktifkan
  const png2 = new File([Buffer.from("89504e470d0a1a0a", "hex")], "foto2.png", { type: "image/png" });
  const updated = await fetch(base + `/seller/products/${product.id}`, {
    method: "PUT",
    headers,
    body: productForm({ name: "Kopi Uji Baru", is_active: "false" }, png2),
  });
  assert.equal(updated.status, 200);
  const upData = (await updated.json()).data;
  assert.equal(upData.name, "Kopi Uji Baru");
  assert.equal(upData.is_active, 0);
  // foto lama dihapus (penghapusan berjalan asinkron, jadi tunggu sebentar)
  for (let i = 0; i < 20 && fs.existsSync(path.join(uploadDir, product.image)); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(fs.existsSync(path.join(uploadDir, product.image)), false);
  assert.equal((await call(`/products/${product.id}`)).status, 404); // nonaktif tidak tampil publik

  const missing = await fetch(base + "/seller/products/9999", { method: "PUT", headers, body: productForm() });
  assert.equal(missing.status, 404);
  const list = await call("/seller/products", { token: seller });
  assert.ok(list.json.data.some((p) => p.id === product.id));
});

test("unggah produk gagal dengan file tapi data tidak valid", async () => {
  const seller = await login("penjual1@lapota.id");
  const headers = { Authorization: `Bearer ${seller}` };
  const png = new File([Buffer.from("89504e470d0a1a0a", "hex")], "test.png", { type: "image/png" });
  const res = await fetch(base + "/seller/products", {
    method: "POST",
    headers,
    body: productForm({ price: -1000 }, png),
  });
  assert.equal(res.status, 400);
});

test("produk yang sudah pernah dipesan dinonaktifkan, bukan dihapus", async () => {
  const seller = await login("penjual1@lapota.id");
  const buyer = await login("pembeli@lapota.id");
  await call("/orders", {
    method: "POST",
    token: buyer,
    body: { items: [{ product_id: 4, quantity: 1 }], address: "Jl. Contoh No. 2, Toba" },
  });
  const del = await call("/seller/products/4", { method: "DELETE", token: seller });
  assert.equal(del.status, 200);
  assert.match(del.json.message, /dinonaktifkan/);
  assert.equal((await call("/products/4")).status, 404);
});

test("seed dapat dijalankan ulang tanpa menggandakan data", async () => {
  const { seed: seedAgain } = await import("../src/db/seed.js");
  const before = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  seedAgain(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, before);
});