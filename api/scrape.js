// Vercel Edge Function — Play Store scraper
// Uses google-play-scraper to fetch real reviews with date filtering
 
export const config = { runtime: 'edge' };
 
export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
 
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
 
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
 
  try {
    const { url, days } = await req.json();
 
    // Validate it's a Play Store URL
    if (!url || !url.includes('play.google.com')) {
      return new Response(JSON.stringify({
        error: 'Only Google Play Store URLs are supported. App Store support coming soon.'
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
 
    // Extract app ID
    const match = url.match(/id=([^&\s]+)/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Invalid Play Store URL — could not find app ID.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
 
    const appId = match[1];
    const daysBack = parseInt(days) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
 
    // Dynamically import google-play-scraper
    const gplay = await import('google-play-scraper');
 
    // Get app info
    const appInfo = await gplay.default.app({ appId, lang: 'en', country: 'us' });
 
    // Fetch reviews — get enough to cover the date range
    // More days = fetch more pages
    const pagesToFetch = daysBack <= 30 ? 3 : daysBack <= 90 ? 6 : daysBack <= 180 ? 10 : 15;
 
    const reviewPages = await Promise.all(
      Array.from({ length: pagesToFetch }, (_, i) =>
        gplay.default.reviews({
          appId,
          lang: 'en',
          country: 'us',
          num: 200,
          paginate: true,
          nextPaginationToken: undefined,
          sort: gplay.default.sort.NEWEST,
        }).catch(() => ({ data: [] }))
      )
    );
 
    // Flatten, deduplicate, filter by date
    const seen = new Set();
    const allReviews = reviewPages
      .flatMap(p => p.data || [])
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
        date: new Date(r.date).toISOString().slice(0, 7), // YYYY-MM
        dateStr: new Date(r.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      }))
      .filter(r => r.text.trim().length > 5);
 
    // Group by month for trend
    const monthGroups = {};
    allReviews.forEach(r => {
      if (!monthGroups[r.date]) monthGroups[r.date] = [];
      monthGroups[r.date].push(r);
    });
 
    return new Response(JSON.stringify({
      appInfo: {
        name: appInfo.title,
        appId,
        store: 'Google Play Store',
        rating: appInfo.score,
        category: appInfo.genre,
        icon: appInfo.icon,
        installs: appInfo.installs,
      },
      reviews: allReviews,
      count: allReviews.length,
      period: {
        days: daysBack,
        from: cutoffDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        to: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      },
      monthGroups: Object.fromEntries(
        Object.entries(monthGroups).map(([k, v]) => [k, v.length])
      ),
      hasDates: true,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
 
  } catch (err) {
    console.error('Scrape error:', err.message);
    return new Response(JSON.stringify({ error: 'Failed to fetch reviews: ' + err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
