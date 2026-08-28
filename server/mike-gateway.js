import "dotenv/config";
import express from "express";
import { analyzeMoneyScenario, MIKE_MONEY_CAPABILITIES } from "./mike-intelligence.js";

const app = express();
const PORT = process.env.PORT || 3000;
const SERVICE_TOKEN = String(process.env.MIKE_MONEY_SERVICE_TOKEN || "").trim();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

function authorized(req) {
  return Boolean(SERVICE_TOKEN) && req.get("authorization") === `Bearer ${SERVICE_TOKEN}`;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "doertoughmoney-mike-intelligence", capabilities: MIKE_MONEY_CAPABILITIES });
});

app.post("/api/v1/mike/intelligence", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const { capability, input } = req.body || {};
    const result = analyzeMoneyScenario({ capability, input });
    res.json(result);
  } catch (error) {
    const message = error?.message || "money_intelligence_unavailable";
    const status = message === "money_capability_not_supported" ? 400 : 422;
    res.status(status).json({ error: message });
  }
});

app.listen(PORT, () => console.log(`[mike-gateway] listening on ${PORT}`));
