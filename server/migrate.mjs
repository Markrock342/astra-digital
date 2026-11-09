import { openLocalCommerce } from "./commerce.mjs";
const service = openLocalCommerce({ seed: false });
console.log(
  "Applied migrations:",
  service.db
    .prepare("SELECT name FROM schema_migrations ORDER BY name")
    .all()
    .map((r) => r.name)
    .join(", "),
);
service.db.close();
