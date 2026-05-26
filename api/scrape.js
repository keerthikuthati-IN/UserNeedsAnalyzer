const gplay = require('google-play-scraper');
 
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  try {
    const { url, days } = req.body;
 
    if (!url || !url.includes('play.google.com')) {
      return res.status(400).json({
        error: 'Only Google Play Store URLs are supported. App Store support coming soon.'
      });
    }
 
    const match = url.match(/id=([^&\s]+)/);
    if (!match) return res.status(400).json({ error: 'Invalid Play Store URL.' });
 
    const appId = match[1];
    const selectedDays = parseInt(days) || 30;
 
    // Always fetch 12 months for trend — selected period for main analysis
    const trendCutoff = new Date();
    trendCutoff.setDate(trendCutoff.getDate() - 365);
 
    const selectedCutoff = new Date();
    selectedCutoff.setDate(selectedCutoff.getDate() - selectedDays);
 
    // Get app info
    const appInfo = await gplay.app({ appId, lang: 'en', country: 'us' });
 
    // Fetch enough pages to cover 12 months
    let allRawReviews = [];
    let nextToken = undefined;
 
    for (let i = 0; i < 15; i++) {
      try {
        const result = await gplay.reviews({
          appId, lang: 'en', country: 'us',
          num: 200, sort: gplay.sort.NEWEST,
          paginate: true, nextPaginationToken: nextToken,
        });
        const batch = result.data || [];
        allRawReviews = allRawReviews.concat(batch);
        nextToken = result.nextPaginationToken;
 
        // Stop if oldest review in batch is older than 13 months (extra buffer)
        if (batch.length > 0) {
          const oldest = new Date(batch[batch.length - 1].date);
          const buffer = new Date();
          buffer.setDate(buffer.getDate() - 395);
          if (oldest < buffer) break;
        }
        if (!nextToken) break;
      } catch (e) { break; }
    }
 
    // Deduplicate
    const seen = new Set();
    const allReviews = allRawReviews
      .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
      .map(r => ({
        id: r.id, text: r.text || '', score: r.score,
        date: new Date(r.date).toISOString().slice(0, 7),
        dateStr: new Date(r.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        ts: new Date(r.date).getTime()
      }))
      .filter(r => r.text.trim().length > 5);
 
    // Selected period reviews — for main analysis
    const selectedReviews = allReviews.filter(r => r.ts >= selectedCutoff.getTime());
 
    // Last 12 months reviews — for trend only
    const trendReviews = allReviews.filter(r => r.ts >= trendCutoff.getTime());
 
    // Group trend reviews by month
    const monthGroups = {};
    trendReviews.forEach(r => {
      if (!monthGroups[r.date]) monthGroups[r.date] = { count: 0, scores: [] };
      monthGroups[r.date].count++;
      monthGroups[r.date].scores.push(r.score);
    });
 
    // Build trend array with sentiment per month based on star ratings
    const trend = Object.entries(monthGroups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => {
        const scores = data.scores;
        const total = scores.length;
        const positive = scores.filter(s => s >= 4).length;
        const negative = scores.filter(s => s <= 2).length;
        const neutral = total - positive - negative;
        const posP = Math.round((positive / total) * 100);
        const negP = Math.round((negative / total) * 100);
        const neuP = 100 - posP - negP;
        const [year, mon] = month.split('-');
        const label = new Date(parseInt(year), parseInt(mon) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        return { month: label, positive: posP, negative: negP, neutral: neuP };
      });
 
    const period = {
      days: selectedDays,
      from: selectedCutoff.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      to: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    };
 
    return res.status(200).json({
      appInfo: {
        name: appInfo.title, appId,
        store: 'Google Play Store',
        rating: appInfo.score,
        category: appInfo.genre,
        icon: appInfo.icon,
        installs: appInfo.installs,
      },
      reviews: selectedReviews,        // selected period — for analysis
      trend,                            // always 12 months — for chart
      count: selectedReviews.length,
      period,
      hasDates: true,
    });
 
  } catch (err) {
    console.error('Scrape error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch reviews: ' + err.message });
  }
};
