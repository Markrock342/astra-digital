// Optional short pages.dev frontend. The existing Worker remains the only API/database owner.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/"))
      return env.COMMERCE_API.fetch(request);
    return env.ASSETS.fetch(request);
  },
};
