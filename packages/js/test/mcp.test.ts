import { describe, it, expect } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openMcpStdio } from "../src/connections/mcp.js";

/** Spin up an in-process MCP server exposing one `echo` tool, linked to a client transport. */
async function linkedEchoServer() {
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  server.registerTool(
    "echo",
    {
      description: "Echo back the message",
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({ content: [{ type: "text", text: `echo: ${message}` }] })
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return clientTransport;
}

describe("mcp connection", () => {
  it("lists server tools and exposes them as invokable Brain tools", async () => {
    const transport = await linkedEchoServer();
    const { tools, close } = await openMcpStdio(
      { type: "mcp-stdio", command: "irrelevant", args: [] },
      { transport }
    );

    expect(tools.map((t) => t.name)).toContain("echo");
    const echo = tools.find((t) => t.name === "echo")!;
    expect(echo.inputSchema).toMatchObject({ type: "object" });

    // Text content is surfaced directly; non-JSON text passes through as a string.
    const result = await echo.invoke({ message: "hello" });
    expect(result).toBe("echo: hello");

    await close();
  });
});
