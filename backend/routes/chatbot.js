const express = require("express");
const { askGemini } = require("../services/geminiService");

const router = express.Router();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_MESSAGE_LENGTH = 1000;
const requestLog = new Map();

function getClientKey(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function isRateLimited(clientKey) {
  const now = Date.now();
  const bucket = requestLog.get(clientKey) || [];
  const recent = bucket.filter((timestamp) => now - timestamp < WINDOW_MS);
  recent.push(now);
  requestLog.set(clientKey, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

function sanitizeMessage(input) {
  return String(input || "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

router.post("/", async (req, res) => {
  try {
    const clientKey = getClientKey(req);
    if (isRateLimited(clientKey)) {
      return res.status(429).json({
        reply:
          "You are sending messages too quickly. Please wait a moment and try again.",
      });
    }

    const message = sanitizeMessage(req.body?.message);
    if (!message) {
      return res.status(400).json({
        reply: "Please enter a support question so I can help you.",
      });
    }

    const reply = await askGemini(message);
    console.log(`[chatbot] success for ${clientKey}`);
    return res.json({ reply });
  } catch (error) {
    console.error("[chatbot] failed:", error.message);
    return res.status(500).json({
      reply:
        "I am having trouble reaching support services right now. Please try again shortly or contact administrators.",
    });
  }
});

module.exports = router;
