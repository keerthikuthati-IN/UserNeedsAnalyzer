import Anthropic from "@anthropic-ai/sdk";
 
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
 
  const { type, reviews, text, appContext, appInfo, period, hasDates, monthGroups } = req.body;
 
  try {
    let appName = appInfo?.name || appContext || "the app";
    let store = appInfo?.store || "";
    let reviewsText = "";
 
    if (type === "playstore") {
      // Build review text from real reviews
      const sample = reviews.slice(0, 300);
      reviewsText = sample.map((r, i) =>
        `[${i + 1}] ⭐${r.score} (${r.dateStr || r.date}): ${r.text}`
      ).join("\n");
    } else if (type === "excel" || type === "transcript") {
      reviewsText = text ? text.slice(0, 8000) : "";
    }
 
    // Build trend instruction from real month data
    const trendInstruction = hasDates && monthGroups
      ? `"trend": [
  // Generate one entry per month in the period, using the actual review counts per month provided below.
  // Month review counts: ${JSON.stringify(monthGroups)}
  // For each month, estimate sentiment split based on the reviews for that month.
  // Format: {"month":"Jan 24","positive":<int>,"negative":<int>,"neutral":<int>} — each must sum to 100
  // Include only months that have reviews. Sort chronologically.
]`
      : `"trend": []`;
 
    const periodContext = period
      ? `Analysis period: ${period.from} to ${period.to} (last ${period.days} days)`
      : "";
 
    const prompt = `You are a senior product analyst. Analyse the following real user reviews for "${appName}" from ${store}.
 
${periodContext}
Total reviews in this period: ${reviews?.length || "see data below"}
App rating: ${appInfo?.rating?.toFixed(1) || "unknown"}
App installs: ${appInfo?.installs || "unknown"}
 
REAL USER REVIEWS:
${reviewsText}
 
Return ONLY valid JSON, no markdown, no explanation. Be specific to these actual reviews:
 
{
  "appName": "${appName}",
  "store": "${store}",
  "total": ${reviews?.length || 0},
  "positive_pct": <integer — based on actual review scores: 4-5 stars = positive, 3 = neutral, 1-2 = negative>,
  "negative_pct": <integer>,
  "neutral_pct": <integer — must make sum exactly 100>,
  "asks": [
    "<specific feature request found in these reviews>",
    "<specific ask>",
    "<specific ask>",
    "<specific ask>"
  ],
  "suggestions": [
    "<specific improvement suggestion from these reviews>",
    "<suggestion>",
    "<suggestion>",
    "<suggestion>"
  ],
  "compliments": [
    "<specific compliment found in these reviews>",
    "<compliment>",
    "<compliment>",
    "<compliment>"
  ],
  "categories": [
    {"name":"<complaint theme from actual reviews>","count":<n>,"verbatims":["<exact short quote from a review above>","<exact short quote>"]},
    {"name":"<theme>","count":<n>,"verbatims":["<real quote>","<real quote>"]},
    {"name":"<theme>","count":<n>,"verbatims":["<real quote>","<real quote>"]},
    {"name":"<theme>","count":<n>,"verbatims":["<real quote>","<real quote>"]},
    {"name":"<theme>","count":<n>,"verbatims":["<real quote>","<real quote>"]},
    {"name":"Others","count":<n>,"verbatims":["<real quote>","<real quote>"]}
  ],
  ${trendInstruction},
  "opportunities": [
    {"title":"<specific opportunity based on these reviews>","rationale":"<one sentence referencing actual feedback>","category":"<which category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"}
  ]
}
 
Critical rules:
1. positive_pct + negative_pct + neutral_pct = exactly 100
2. Each trend month: positive + negative + neutral = exactly 100
3. Verbatims MUST be real short quotes from the reviews provided above
4. Category counts must add up to approximately ${reviews?.length || 0}
5. Opportunities must reference specific patterns in the actual reviews`;
 
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
 
    let responseText = message.content.map((b) => b.text || "").join("");
    responseText = responseText.replace(/```json|```/g, "").trim();
    const result = JSON.parse(responseText);
 
    // Server-side validation
    // Fix sentiment sum
    const sum = result.positive_pct + result.negative_pct + result.neutral_pct;
    if (sum !== 100) result.neutral_pct = 100 - result.positive_pct - result.negative_pct;
 
    // Fix trend sums
    if (result.trend?.length > 0) {
      result.trend = result.trend.map(t => {
        const s = t.positive + t.negative + t.neutral;
        if (s !== 100) t.neutral = 100 - t.positive - t.negative;
        return t;
      });
    }
 
    // Always use real count
    result.total = reviews?.length || result.total;
    result.period = period;
 
    return res.status(200).json(result);
 
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
