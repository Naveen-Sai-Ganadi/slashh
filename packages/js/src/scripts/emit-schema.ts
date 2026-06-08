import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BrainConfigSchema } from "../types.js";

const out = resolve(process.cwd(), "../../schema/brain.schema.json");
const schema = zodToJsonSchema(BrainConfigSchema, "BrainConfig");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(schema, null, 2) + "\n");
console.log("wrote", out);
