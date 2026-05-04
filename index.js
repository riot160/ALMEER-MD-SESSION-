// ═══════════════════════════════════════════════════
//  ALMEER MD · Session Generator · index.js
// ═══════════════════════════════════════════════════

import express    from "express";
import bodyParser from "body-parser";
import cors       from "cors";
import { fileURLToPath } from "url";
import path from "path";

import pairRouter from "./pair.js";
import qrRouter   from "./qr.js";

const app       = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PORT       = process.env.PORT || 8000;

import("events").then((events) => {
    events.EventEmitter.defaultMaxListeners = 500;
});

/* ── CORS ── */
app.use(cors({
    origin:         "*",
    methods:        ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

/* ── Routes ── */
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "pair.html"));
});

app.use("/pair", pairRouter);
app.use("/qr",   qrRouter);

/* ── Start ── */
app.listen(PORT, () => {
    console.log(`
  ✞『✦𝑨𝑳𝑴𝑬𝑬𝑹 ✠ 𝑴𝑫✦』✞
  Session Generator running on port ${PORT}
  Open: http://localhost:${PORT}
    `);
});

export default app;
