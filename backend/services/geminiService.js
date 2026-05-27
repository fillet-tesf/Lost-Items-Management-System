const fs = require("fs").promises;
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL_NAME = "gemini-1.5-flash";
const KB_FILE = path.join(__dirname, "..", "ai", "knowledge-base.txt");
const RULES_FILE = path.join(__dirname, "..", "ai", "system-rules.txt");

async function loadContextFiles() {
  const [knowledgeBase, systemRules] = await Promise.all([
    fs.readFile(KB_FILE, "utf8"),
    fs.readFile(RULES_FILE, "utf8"),
  ]);

  return { knowledgeBase, systemRules };
}

function buildPrompt(knowledgeBase, userMessage) {
  return [
    "LIMS Knowledge Base:",
    knowledgeBase,
    "",
    `User question: ${userMessage}`,
    "",
    "Answer using the LIMS knowledge above. If the question is not about LIMS, politely refuse and redirect to LIMS support topics.",
  ].join("\n");
}

async function askGemini(userMessage) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in environment");
  }

  const { knowledgeBase, systemRules } = await loadContextFiles();
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: systemRules,
  });

  const prompt = buildPrompt(knowledgeBase, userMessage);
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 500,
    },
  });

  const reply = result?.response?.text()?.trim();
  if (!reply) {
    throw new Error("Empty response from Gemini");
  }

  return reply;
}

module.exports = {
  askGemini,
};
