import { openLocalCommerce } from "./commerce.mjs";
import { createApp } from "./http.mjs";
const commerce = openLocalCommerce();
const port = Number(process.env.PORT ?? 4331);
const server = createApp(commerce, {
  production: process.env.NODE_ENV === "production",
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `ASTRA DIGITAL ${process.env.NODE_ENV === "production" ? "app" : "API"}: http://127.0.0.1:${port}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      commerce.db.close();
      process.exit(0);
    }),
  );
