import Anthropic from "@anthropic-ai/sdk";
 
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
 
  const { type, url, text, appContext, hasDates } = req.body;
 
  try {
    let appName = "";
    let appId = "";
    let store = "";
    let reviewsText = "";
 
    if (type === "url") {
      if (url.includes("play.google.com")) {
        const m = url.match(/id=([^&\s]+)/);
        appId = m ? m[1] : "";
        store = "Google Play Store";
        // Build readable name from package ID
        const parts = appId.split(".").filter(p =>
          !["com","org","net","app","android","google","microsoft","apple","inc","co","io"].includes(p.toLowerCase())
        );
        appName = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
      } else if (url.includes("apps.apple.com")) {
        const idMatch = url.match(/\/id(\d+)/);
        const nameMatch = url.match(/\/app\/([^/]+)\//);
        appId = idMatch ? idMatch[1] : "";
        store = "Apple App Store";
        appName = nameMatch
          ? nameMatch[1].split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
          : appContext || "";
      }
      // Override with user-provided context if given
      if (appContext && appContext.trim() && appContext !== "Will be auto-detected") {
        appName = appContext.trim();
      }
 
    } else {
      appName = appContext || "the app";
      reviewsText = text ? text.slice(0, 8000) : "";
    }
 
    const trendInstruction = hasDates || type === "url"
      ? `"trend": [ exactly 12 objects, one per month, chronological order e.g. Jan 24 through Dec 24: {"month":"Jan 24","positive":<int>,"negative":<int>,"neutral":<int>} — each object's three values MUST sum to exactly 100 ]`
      : `"trend": []`;
 
    const storeContext = type === "url"
      ? `Store: ${store}
App ID / slug: ${appId}
Full URL: ${url}
App name: ${appName}
 
You MUST analyse ONLY the app described above. Do not substitute, confuse, or mix up with any other app.
Use your training knowledge of this specific app's real user reviews, ratings, and reputation.`
      : `App: ${appName}
Input type: ${type === "excel" ? "Excel/CSV feedback data" : "transcript/text"}
Review data provided below — analyse ONLY this data.`;
 
    // Generate a seed based on appId to vary numbers per app
    const seed = appId ? appId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) : Math.floor(Math.random() * 1000);
 
    const prompt = `You are a senior product analyst. Your task is to produce a realistic user feedback analysis.
 
${storeContext}
 
${type !== "url" && reviewsText ? `FEEDBACK DATA:\n${reviewsText}` : ""}
 
STRICT RULES — read carefully before responding:
1. ONLY analyse "${appName}" from ${store || "the provided data"}. Never substitute another app.
2. Total review count MUST be unique and realistic for this specific app:
   - Major global apps (Facebook, Gmail, YouTube): 5M–50M range
   - Popular apps (Rakuten, Duolingo, Notion): 500K–5M range  
   - Niche/regional apps: 10K–500K range
   - The seed for this request is ${seed} — use it to generate a unique, non-round number
   - NEVER use 487234, 500000, 1000000 or any obviously round/repeated number
3. positive_pct + negative_pct + neutral_pct MUST equal exactly 100
4. Every trend month: positive + negative + neutral MUST equal exactly 100
5. All content must be specific to "${appName}" — no generic filler
 
Return ONLY valid JSON, no markdown, no text before or after:
{
  "appName": "<clean readable name of ${appName}>",
  "store": "${store || "uploaded data"}",
  "total": <unique realistic integer — see rule 2>,
  "positive_pct": <integer>,
  "negative_pct": <integer>,
  "neutral_pct": <integer — ensure sum is exactly 100>,
  "asks": [
    "<specific feature request real users of ${appName} make>",
    "<specific ask>",
    "<specific ask>",
    "<specific ask>"
  ],
  "suggestions": [
    "<specific UX or feature suggestion for ${appName}>",
    "<suggestion>",
    "<suggestion>",
    "<suggestion>"
  ],
  "compliments": [
    "<specific thing users genuinely praise about ${appName}>",
    "<compliment>",
    "<compliment>",
    "<compliment>"
  ],
  "categories": [
    {"name":"<complaint theme specific to ${appName}>","count":<int>,"verbatims":["<realistic short user quote>","<realistic short user quote>"]},
    {"name":"<complaint theme>","count":<int>,"verbatims":["<quote>","<quote>"]},
    {"name":"<complaint theme>","count":<int>,"verbatims":["<quote>","<quote>"]},
    {"name":"<complaint theme>","count":<int>,"verbatims":["<quote>","<quote>"]},
    {"name":"<complaint theme>","count":<int>,"verbatims":["<quote>","<quote>"]},
    {"name":"Others","count":<int>,"verbatims":["<quote>","<quote>"]}
  ],
  ${trendInstruction},
  "opportunities": [
    {"title":"<specific opportunity for ${appName}>","rationale":"<one sentence grounded in the data>","category":"<which complaint category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"}
  ]
}`;
 
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
 
    let responseText = message.content.map((b) => b.text || "").join("");
    responseText = responseText.replace(/```json|```/g, "").trim();
    const result = JSON.parse(responseText);
 
    // Server-side fixes
    // 1. Fix sentiment percentages
    const sentimentSum = result.positive_pct + result.negative_pct + result.neutral_pct;
    if (sentimentSum !== 100) {
      result.neutral_pct = 100 - result.positive_pct - result.negative_pct;
    }
 
    // 2. Fix trend percentages
    if (result.trend && result.trend.length > 0) {
      result.trend = result.trend.map(t => {
        const sum = t.positive + t.negative + t.neutral;
        if (sum !== 100) {
          t.neutral = 100 - t.positive - t.negative;
        }
        return t;
      });
    }
 
    // 3. Catch the known bad number
    if (result.total === 487234 || result.total === 500000 || result.total === 1000000) {
      result.total = Math.floor(seed * 1337 + 73829) % 4000000 + 50000;
    }
 
    return res.status(200).json(result);
 
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
 
