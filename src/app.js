import express from "express";
import cors from "cors";
import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import catalogRoutes from "./routes/catalog.js";
import orderRoutes from "./routes/orders.js";
import { errorHandler, notFound } from "./middleware/error.js";

export function createApp(db) {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/uploads", express.static(config.uploadDir, { maxAge: "7d" }));

  app.get("/api/health", (req, res) => {
    res.json({ success: true, message: "LapoTa API berjalan", time: new Date().toISOString() });
  });

  app.use("/api/auth", authRoutes(db));
  app.use("/api", catalogRoutes(db));
  app.use("/api", orderRoutes(db));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}