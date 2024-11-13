export async function onRequest(context) {
  return new Response("API route", {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}
