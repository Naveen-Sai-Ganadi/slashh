import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool } from "../tool.js";
import type { McpStdioConnectionT, McpHttpConnectionT } from "../types.js";
import { resolveSecrets } from "../secrets.js";

export interface OpenedConnection {
  tools: Tool[];
  close: () => Promise<void>;
}

interface BuildOpts {
  env?: Record<string, string | undefined>;
  /** Inject a transport directly (used by tests with InMemoryTransport). */
  transport?: Transport;
}

const CLIENT_INFO = { name: "slashh", version: "0.0.0" };

/** Wrap an already-connected MCP client's tools as invokable Brain tools. */
async function wrapClientTools(client: Client): Promise<Tool[]> {
  const { tools } = await client.listTools();
  return tools.map((t): Tool => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    async invoke(args: Record<string, unknown>) {
      const res = await client.callTool({ name: t.name, arguments: args });
      // MCP tool results carry a `content` array; surface text parts directly.
      const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
      const text = content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n");
      return text ? tryJson(text) : res;
    },
  }));
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function connect(transport: Transport): Promise<OpenedConnection> {
  const client = new Client(CLIENT_INFO);
  await client.connect(transport);
  const tools = await wrapClientTools(client);
  return { tools, close: () => client.close() };
}

export async function openMcpStdio(
  conn: McpStdioConnectionT,
  opts: BuildOpts = {}
): Promise<OpenedConnection> {
  if (opts.transport) return connect(opts.transport);
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const env = opts.env
    ? resolveEnv(conn.env, opts.env)
    : conn.env;
  const transport = new StdioClientTransport({ command: conn.command, args: conn.args, env });
  return connect(transport);
}

export async function openMcpHttp(
  conn: McpHttpConnectionT,
  opts: BuildOpts = {}
): Promise<OpenedConnection> {
  if (opts.transport) return connect(opts.transport);
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const headers = conn.headers
    ? resolveEnv(conn.headers, opts.env ?? process.env)
    : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(conn.url), {
    requestInit: headers ? { headers } : undefined,
  });
  return connect(transport);
}

/** Resolve ${ENV} references inside a string map of config values. */
function resolveEnv(
  map: Record<string, string> | undefined,
  env: Record<string, string | undefined>
): Record<string, string> | undefined {
  if (!map) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) out[k] = resolveSecrets(v, env);
  return out;
}
