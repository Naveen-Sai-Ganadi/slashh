import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runFixture } from "../src/conformance/run-fixtures.js";

const FIXTURES = resolve(process.cwd(), "../../fixtures");

describe("conformance fixtures", () => {
  for (const name of readdirSync(FIXTURES)) {
    it(`fixture: ${name}`, async () => {
      const { actual, expected } = await runFixture(resolve(FIXTURES, name));
      expect(actual).toEqual(expected);
    });
  }
});
