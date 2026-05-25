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
    let reviewsText = "";
    let appName = appContext;

    if (type === "url") {
      const urlMatch = url.match(/id=([^&]+)/) || url.match(/\/id(\d+)/);
      const appId = urlMatch ? urlMatch[1] : "";
      const store = url.includes("play.google.com") ? "Google Play Store" : "Apple App Store";
      appName = appContext || appId;
      reviewsText = `Analyse the app "${appName}" (${appId}) from ${store}. Use your knowledge of this app's real user reviews to generate a realistic and accurate analysis. Make the categories, verbatims, asks, suggestions and opportunities very specific to this actual app.`;
    } else {
      reviewsText = text ? text.slice(0, 8000) : "";
    }

    const trendInstruction = hasDates || type === "url"
      ? `"trend": [{"month":"Jan 24","positive":N,"negative":N,"neutral":N}, ... 12 months, each row sums to 100]`
      : `"trend": []`;

    const prompt = `You are an expert product analyst. Analyse user feedback for: "${appName}".

${reviewsText}

Return ONLY valid JSON, no markdown, no explanation:
{
  "appName": "<clean readable app name>",
  "total": <realistic number of reviews>,
  "positive_pct": <integer>,
  "negative_pct": <integer>,
  "neutral_pct": <integer>,
  "asks": ["<specific ask from real users>","<ask>","<ask>","<ask>"],
  "suggestions": ["<specific suggestion>","<s>","<s>","<s>"],
  "compliments": ["<specific compliment>","<c>","<c>","<c>"],
  "categories": [
    {"name":"<category specific to this app>","count":<n>,"verbatims":["<realistic short quote>","<realistic short quote>"]},
    {"name":"<category>","count":<n>,"verbatims":["<quote>","<quote>"]},
    {"name":"<category>","count":<n>,"verbatims":["<quote>","<quote>"]},
    {"name":"<category>","count":<n>,"verbatims":["<quote>","<quote>"]},
    {"name":"<category>","count":<n>,"verbatims":["<quote>","<quote>"]},
    {"name":"Others","count":<n>,"verbatims":["<quote>","<quote>"]}
  ],
  ${trendInstruction},
  "opportunities": [
    {"title":"<actionable opportunity>","rationale":"<one sentence grounded in feedback>","category":"<which category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"},
    {"title":"<opportunity>","rationale":"<rationale>","category":"<category>"}
  ]
}
Rules: categories must be specific to this app, positive+negative+neutral=100, verbatims must sound like real user reviews.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    let responseText = message.content.map((b) => b.text || "").join("");
    responseText = responseText.replace(/```json|```/g, "").trim();
    const result = JSON.parse(responseText);

    return res.status(200).json(result);
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
