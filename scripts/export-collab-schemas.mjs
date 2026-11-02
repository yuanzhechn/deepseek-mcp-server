import { writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import { profileConfigSchema } from "../build/collaboration/profile-schema.js";
import { priceCatalogSchema, DEFAULT_CATALOG } from "../build/collaboration/pricing.js";
mkdirSync("docs/collaboration", { recursive: true });
for (const [name, schema] of [["profiles.schema.v1", profileConfigSchema], ["prices.schema.v1", priceCatalogSchema]]) {
  writeFileSync(`docs/collaboration/${name}.json`, JSON.stringify(z.toJSONSchema(schema), null, 2) + "\n");
}
writeFileSync("docs/collaboration/prices.example.v1.json", JSON.stringify(DEFAULT_CATALOG, null, 2) + "\n");
