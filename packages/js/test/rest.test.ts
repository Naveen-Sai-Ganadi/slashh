import { describe, it, expect, vi } from "vitest";
import { buildRestTools } from "../src/connections/rest.js";

describe("buildRestTools", () => {
  it("creates a tool per operation and calls the right URL with auth + query", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tempC: 21 }), { status: 200 }));
    const tools = buildRestTools(
      { type: "rest", baseUrl: "https://api.example.com",
        auth: { header: "Authorization", value: "Bearer ${WX_KEY}" },
        operations: [{ name: "get_current", method: "GET", path: "/current", description: "Current weather",
          input: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }] },
      { env: { WX_KEY: "secret" }, fetch: fetchMock as unknown as typeof fetch }
    );
    expect(tools).toHaveLength(1);
    const result = await tools[0].invoke({ city: "Paris" });
    expect(result).toEqual({ tempC: 21 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.example.com/current?city=Paris");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it("sends a JSON body for POST operations", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const tools = buildRestTools(
      { type: "rest", baseUrl: "https://api.example.com",
        operations: [{ name: "create", method: "POST", path: "/items", description: "Create",
          input: { type: "object", properties: { title: { type: "string" } } } }] },
      { env: {}, fetch: fetchMock as unknown as typeof fetch }
    );
    await tools[0].invoke({ title: "x" });
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBe(JSON.stringify({ title: "x" }));
  });
});
