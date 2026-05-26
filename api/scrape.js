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
 
    const selectedCutoff = new Date();
    selectedCutoff.setDate(selectedCutoff.getDate() - selectedDays);
 
    const trendCutoff = new Date();
    trendCutoff.setMonth(trendCutoff.getMonth() - 12);
 
    // Get app info
    const appInfo = await gplay.app({ appId, lang: 'en', country: 'us' });
 
    // Fetch in parallel across different sort orders to maximise time coverage
    const fetchBatch = async (sort) => {
      try {
        const result = await gplay.reviews({
          appId, lang: 'en', country: 'us',
          num: 200, sort, paginate: false,
        });
        return result.data || [];
      } catch (e) { return []; }
    };
 
    const [batch1, batch2, batch3, batch4] = await Promise.all([
      fetchBatch(gplay.sort.NEWEST),
      fetchBatch(gplay.sort.RATING),
      fetchBatch(gplay.sort.HELPFULNESS),
      gplay.reviews({ appId, lang: 'en', country: 'us', num: 200, sort: gplay.sort.NEWEST, paginate: true })
        .then(r => r.data || []).catch(() => []),
    ]);
 
    // Deduplicate
    const seen = new Set();
    const allReviews = [...batch1, ...batch2, ...batch3, ...batch4]
      .filter(r => {
        if (!r || seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      })
      .map(r => ({
        id: r.id,
        text: r.text || '',
        score: r.score,
        date: new Date(r.date).toISOString().slice(0, 7),
        dateStr: new Date(r.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        ts: new Date(r.date).getTime()
      }))
      .filter(r => r.text.trim().length > 5);
 
    // Selected period reviews for main analysis
    const selectedReviews = allReviews.filter(r => r.ts >= selectedCutoff.getTime());
 
    // Build trend — only from real data, mark missing months explicitly
    const trend = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
 
      // Only include months where we have real review data
      const monthReviews = allReviews.filter(r =>
        r.date === key && r.ts >= trendCutoff.getTime()
      );
 
      if (monthReviews.length >= 1) {
        const total = monthReviews.length;
        const positive = monthReviews.filter(r => r.score >= 4).length;
        const negative = monthReviews.filter(r => r.score <= 2).length;
        const neutral = total - positive - negative;
        const posP = Math.round((positive / total) * 100);
        const negP = Math.round((negative / total) * 100);
        const neuP = 100 - posP - negP;
        trend.push({
          month: label,
          positive: posP,
          negative: negP,
          neutral: neuP,
          count: total,
          hasData: true
        });
      } else {
        // Real gap — no data fetched for this month
        trend.push({
          month: label,
          positive: 0,
          negative: 0,
          neutral: 0,
          count: 0,
          hasData: false
        });
      }
    }
 
    const monthsWithData = trend.filter(t => t.hasData).length;
 
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
      reviews: selectedReviews,
      trend,
      monthsWithData,
      count: selectedReviews.length,
      period,
      hasDates: true,
    });
 
  } catch (err) {
    console.error('Scrape error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch reviews: ' + err.message });
  }
};
