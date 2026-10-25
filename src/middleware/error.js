import { ZodError } from "zod";
import multer from "multer";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function notFound(req, res) {
  res.status(404).json({ success: false, message: "Endpoint tidak ditemukan" });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Data yang dikirim tidak valid",
      errors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "Ukuran gambar maksimal 2 MB" : err.message;
    return res.status(400).json({ success: false, message });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Format JSON tidak valid" });
  }
  console.error(err);
  res.status(500).json({ success: false, message: "Terjadi kesalahan pada server" });
}