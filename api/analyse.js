import Anthropic from "@anthropic-ai/sdk";
 
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
 
  const { type, reviews, text, appContext, appInfo, period, trend } = req.body;
 
  try {
    let appName = appInfo?.name || appContext || "the app";
    let store = appInfo?.store || "";
    let reviewsText = "";
 
    if (type === "playstore") {
      // Build review text from real selected-period reviews
      const sample = (reviews || []).slice(0, 300);
      reviewsText = sample.map((r, i) =>
        `[${i + 1}] ⭐${r.score} (${r.dateStr || r.date}): ${r.text}`
      ).join("\n");
    } else {
      reviewsText = text ? text.slice(0, 8000) : "";
    }
 
    const periodLabel = period
      ? `${period.from} to ${period.to} (last ${period.days} days)`
      : "all time";
 
    const prompt = `You are a senior product analyst. Analyse these real user reviews for "${appName}" from ${store}.
 
Analysis period: ${periodLabel}
Reviews in this period: ${reviews?.length || 0}
App rating: ${appInfo?.rating?.toFixed(1) || "unknown"}
 
REAL USER REVIEWS:
${reviewsText}
 
Return ONLY valid JSON, no markdown:
{
  "appName": "${appName}",
  "store": "${store}",
  "total": ${reviews?.length || 0},
  "positive_pct": <integer — 4-5 stars = positive, 3 = neutral, 1-2 = negative, based on actual reviews>,
  "negative_pct": <integer>,
  "neutral_pct": <integer — positive+negative+neutral must equal exactly 100>,
  "asks": ["<specific ask from these reviews>","<ask>","<ask>","<ask>"],
  "suggestions": ["<specific suggestion from these reviews>","<s>","<s>","<s>"],
  "compliments": ["<specific compliment from these reviews>","<c>","<c>","<c>"],
  "categories": [
    {"name":"<complaint theme>","count":<n>,"verbatims":["<exact short quote from a review>","<exact short quote>"]},
    {"name":"<theme>","count":<n>,"verbatims":["<quote>","<quote>"]},
    {"name":"<theme>","count":<n>,"verbatims":["<quote>","<quote>"]},
    {"name":"<theme>","count":<n>,"verbatims":["<quote>","<quote>"]},
    {"name":"<theme>","count":<n>,"verbatims":["<quote>","<quote>"]},
    {"name":"Others","count":<n>,"verbatims":["<quote>","<quote>"]}
  ],
  "opportunities": [
    {"title":"<opportunity>","rationale":"<one sentence referencing actual feedback>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"}
  ]
}
 
Rules:
1. positive_pct + negative_pct + neutral_pct = exactly 100
2. Verbatims must be real short quotes from the reviews above
3. All content must be specific to ${appName}`;
 
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
 
    let responseText = message.content.map((b) => b.text || "").join("");
    responseText = responseText.replace(/```json|```/g, "").trim();
    const result = JSON.parse(responseText);
 
    // Validate sentiment sum
    const sum = result.positive_pct + result.negative_pct + result.neutral_pct;
    if (sum !== 100) result.neutral_pct = 100 - result.positive_pct - result.negative_pct;
 
    // Always use real count
    result.total = reviews?.length || result.total;
    result.period = period;
 
    // Use pre-computed trend from scraper (always 12 months, real data)
    // Never ask Claude to generate trend — it's computed from actual star ratings
    result.trend = trend || [];
 
    return res.status(200).json(result);
 
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
