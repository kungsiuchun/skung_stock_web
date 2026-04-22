export const onRequest: PagesFunction = async (context) => {
  return new Response("Hello World from Cloudflare Functions!", {
    headers: {
      "content-type": "text/plain;charset=UTF-8",
    },
  });
};
