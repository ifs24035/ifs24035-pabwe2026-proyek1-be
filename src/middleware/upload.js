import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { config } from "../config.js";
import { HttpError } from "./error.js";

fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ALLOWED[file.mimetype]}`),
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[file.mimetype]) {
      return cb(new HttpError(400, "Gambar harus berformat JPG, PNG, atau WEBP"));
    }
    cb(null, true);
  },
}).single("image");

export function removeUploadedFile(filename) {
  if (!filename) return;
  const target = path.join(config.uploadDir, path.basename(filename));
  fs.rm(target, { force: true }, () => {});
}