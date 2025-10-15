import path from "path";
import express from "express";
import compression from "compression";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const dist = path.join(__dirname, "dist");

app.use(compression());
app.use(express.static(dist, { index: false }));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(port, () => console.log(`[frontend] Serving dist on ${port}`));
