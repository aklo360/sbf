export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Handle static file requests
  if (path.startsWith('/img/') || path.startsWith('/_next/')) {
    // Let Cloudflare Pages handle static assets
    return env.ASSETS.fetch(request);
  }

  // Handle API routes
  if (path.startsWith('/api/')) {
    if (path.startsWith('/api/getPfps')) {
      // Return hardcoded array of PFP images
      const pfps = Array.from({ length: 10 }, (_, i) => `/img/pfps/sbf${i + 1}.png`);
      return new Response(JSON.stringify(pfps), {
        headers: { 
          'content-type': 'application/json',
          'cache-control': 'public, max-age=3600'
        }
      });
    }

    if (path.startsWith('/api/getTraitImage')) {
      const params = new URLSearchParams(url.search);
      const category = params.get('category');
      const trait = params.get('trait');
      
      if (!category || !trait) {
        return new Response(JSON.stringify({ error: 'Missing parameters' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        });
      }

      const imagePath = `/img/traits/${category}/${trait}.png`;
      return new Response(JSON.stringify({ path: imagePath }), {
        headers: { 
          'content-type': 'application/json',
          'cache-control': 'public, max-age=86400'
        }
      });
    }
  }

  // For all other routes, let Pages handle it
  return env.ASSETS.fetch(request);
} 