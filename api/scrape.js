// Vercel Serverless Function — Play Store scraper
// Standard Node.js runtime (NOT edge) — required for google-play-scraper
 
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
    if (!match) {
      return res.status(400).json({ error: 'Invalid Play Store URL — could not find app ID.' });
    }
 
    const appId = match[1];
    const daysBack = parseInt(days) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
 
    // Get app info
    const appInfo = await gplay.app({ appId, lang: 'en', country: 'us' });
 
    // Fetch reviews — paginate to get enough for the date range
    const pagesToFetch = daysBack <= 30 ? 3 : daysBack <= 90 ? 6 : daysBack <= 180 ? 10 : 15;
 
    let allRawReviews = [];
    let nextToken = undefined;
 
    for (let i = 0; i < pagesToFetch; i++) {
      try {
        const result = await gplay.reviews({
          appId,
          lang: 'en',
          country: 'us',
          num: 200,
          sort: gplay.sort.NEWEST,
          paginate: true,
          nextPaginationToken: nextToken,
        });
        allRawReviews = allRawReviews.concat(result.data || []);
        nextToken = result.nextPaginationToken;
        if (!nextToken) break;
      } catch (e) {
        break;
      }
    }
 
    // Deduplicate and filter by date
    const seen = new Set();
    const reviews = allRawReviews
      .filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        const reviewDate = new Date(r.date);
        return reviewDate >= cutoffDate;
      })
      .map(r => ({
        id: r.id,
        text: r.text || '',
        score: r.score,
        date: new Date(r.date).toISOString().slice(0, 7),
        dateStr: new Date(r.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      }))
      .filter(r => r.text.trim().length > 5);
 
    // Group by month for trend
    const monthGroups = {};
    reviews.forEach(r => {
      if (!monthGroups[r.date]) monthGroups[r.date] = 0;
      monthGroups[r.date]++;
    });
 
    const period = {
      days: daysBack,
      from: cutoffDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      to: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    };
 
    return res.status(200).json({
      appInfo: {
        name: appInfo.title,
        appId,
        store: 'Google Play Store',
        rating: appInfo.score,
        category: appInfo.genre,
        icon: appInfo.icon,
        installs: appInfo.installs,
      },
      reviews,
      count: reviews.length,
      period,
      monthGroups,
      hasDates: true,
    });
 
  } catch (err) {
    console.error('Scrape error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch reviews: ' + err.message });
  }
};
