export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Handle different API routes
  if (path.startsWith('/api/getPfps')) {
    // Return empty array for now since we're doing static export
    return new Response(JSON.stringify([]), {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (path.startsWith('/api/getTraitImage')) {
    // Return 404 for trait images since we're doing static export
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Default response for unknown routes
  return new Response(null, { status: 404 });
} 