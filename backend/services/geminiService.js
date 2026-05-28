const fs = require("fs").promises;
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const KB_FILE = path.join(__dirname, "..", "ai", "knowledge-base.txt");
const RULES_FILE = path.join(__dirname, "..", "ai", "system-rules.txt");
const MAX_OUTPUT_TOKENS = 1400;

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
    "Answer using only the LIMS knowledge above.",
    "If the question is not about LIMS, politely refuse and redirect to LIMS support topics.",
    "Format clearly with short paragraphs and bullet points when useful.",
    "Do not stop mid-sentence.",
  ].join("\n");
}

function extractTextFromResponse(response) {
  const fromTextMethod = response?.text?.();
  if (typeof fromTextMethod === "string" && fromTextMethod.trim()) {
    return fromTextMethod.trim();
  }

  const partsText = (response?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();

  return partsText;
}

function responseWasTruncated(response) {
  return (response?.candidates || []).some(
    (candidate) =>
      String(candidate?.finishReason || "").toUpperCase() === "MAX_TOKENS",
  );
}

async function generateContent(model, prompt) {
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      topP: 0.9,
      topK: 32,
    },
  });

  const response = result?.response;
  const text = extractTextFromResponse(response);
  const truncated = responseWasTruncated(response);
  const finishReasons = (response?.candidates || [])
    .map((candidate) => candidate?.finishReason || "UNKNOWN")
    .join(",");
  return { text, truncated, finishReasons };
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
  const firstPass = await generateContent(model, prompt);

  if (!firstPass.text) {
    throw new Error("Empty response from Gemini");
  }

  console.log(
    `[gemini] model=${MODEL_NAME} finish=${firstPass.finishReasons} truncated=${firstPass.truncated}`,
  );

  if (!firstPass.truncated) {
    return firstPass.text;
  }

  // If generation hits token limits, request continuation and stitch it safely.
  const continuationPrompt = [
    "Continue and finish the following LIMS support answer.",
    "Do not repeat already written text, and do not restart from the beginning.",
    "",
    "Partial answer:",
    firstPass.text,
    "",
    "Complete it in a clear, readable format with bullets if needed.",
  ].join("\n");

  const secondPass = await generateContent(model, continuationPrompt);
  console.log(
    `[gemini] continuation finish=${secondPass.finishReasons} truncated=${secondPass.truncated}`,
  );

  if (!secondPass.text) {
    return firstPass.text;
  }

  return `${firstPass.text}\n${secondPass.text}`.trim();
}

module.exports = {
  askGemini,
};
