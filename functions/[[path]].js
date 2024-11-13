export const onRequest = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // API routes
  if (path.startsWith('/api/')) {
    if (path === '/api/getPfps') {
      // Return list of PFP images
      const pfps = Array.from({ length: 10 }, (_, i) => `/img/pfps/${i + 1}.png`);
      return new Response(JSON.stringify(pfps), {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=3600'
        }
      });
    }
  }

  // Let Pages handle all other routes
  return new Response(null, { status: 404 });
}; 