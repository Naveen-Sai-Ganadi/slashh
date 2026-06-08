import { describe, it, expect } from "vitest";
import { resolveSecrets } from "../src/secrets.js";

describe("resolveSecrets", () => {
  it("expands ${VAR} from the provided env", () => {
    const out = resolveSecrets("Bearer ${WX_KEY}", { WX_KEY: "abc" });
    expect(out).toBe("Bearer abc");
  });

  it("throws a named error when a var is missing", () => {
    expect(() => resolveSecrets("${MISSING}", {})).toThrow(/MISSING/);
  });

  it("leaves strings without refs untouched", () => {
    expect(resolveSecrets("plain", {})).toBe("plain");
  });
});
