import { describe, it, expect } from "vitest";
import {
  stableId,
  makeAcl,
  aclVisibleTo,
  edgeIsCurrent,
  type Edge,
} from "../src/knowledge/model.js";
import { NotImplementedError, buildProfile } from "../src/surfaces/index.js";

describe("knowledge model", () => {
  it("stableId is deterministic and order-sensitive", () => {
    expect(stableId("person", "Ada")).toBe(stableId("person", "Ada"));
    expect(stableId("person", "Ada")).not.toBe(stableId("Ada", "person"));
  });

  describe("ACL.visibleTo — fail closed", () => {
    it("denies by default", () => {
      expect(aclVisibleTo(makeAcl(), "bob", [])).toBe(false);
    });
    it("grants public to everyone", () => {
      expect(aclVisibleTo(makeAcl({ public: true }), "bob", [])).toBe(true);
    });
    it("grants by explicit user", () => {
      expect(aclVisibleTo(makeAcl({ allowUsers: ["bob"] }), "bob", [])).toBe(true);
      expect(aclVisibleTo(makeAcl({ allowUsers: ["bob"] }), "eve", [])).toBe(false);
    });
    it("grants by group membership", () => {
      const acl = makeAcl({ allowGroups: ["leadership"] });
      expect(aclVisibleTo(acl, "bob", ["leadership"])).toBe(true);
      expect(aclVisibleTo(acl, "bob", ["eng"])).toBe(false);
    });
    it("admin sentinel sees everything", () => {
      expect(aclVisibleTo(makeAcl(), "*", [])).toBe(true);
    });
  });

  describe("edgeIsCurrent — bi-temporal", () => {
    const base = (over: Partial<Edge>): Edge => ({
      id: "e1",
      subjectId: "a",
      relation: "is",
      fact: "Acme is a customer",
      provenance: ["d1"],
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: null,
      recordedAt: new Date("2026-01-01T00:00:00Z"),
      expiredAt: null,
      ...over,
    });

    it("is current within its valid window", () => {
      expect(edgeIsCurrent(base({}), new Date("2026-03-01T00:00:00Z"))).toBe(true);
    });
    it("is not current before it became valid", () => {
      expect(edgeIsCurrent(base({}), new Date("2025-06-01T00:00:00Z"))).toBe(false);
    });
    it("is not current after being superseded (validTo set)", () => {
      const e = base({ validTo: new Date("2026-02-01T00:00:00Z") });
      expect(edgeIsCurrent(e, new Date("2026-03-01T00:00:00Z"))).toBe(false);
      expect(edgeIsCurrent(e, new Date("2026-01-15T00:00:00Z"))).toBe(true);
    });
  });
});

describe("surfaces scaffold", () => {
  it("stub surfaces throw NotImplementedError until their phase", async () => {
    await expect(buildProfile(null, "x", { user: "bob" })).rejects.toBeInstanceOf(
      NotImplementedError
    );
  });
});
