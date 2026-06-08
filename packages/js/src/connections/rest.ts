import type { Tool } from "../tool.js";
import type { RestOperationT } from "../types.js";
import { resolveSecrets } from "../secrets.js";

interface RestConnectionInput {
  type: "rest";
  baseUrl: string;
  auth?: { header: string; value: string };
  operations: RestOperationT[];
}

interface BuildOpts {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export function buildRestTools(conn: RestConnectionInput, opts: BuildOpts = {}): Tool[] {
  const doFetch = opts.fetch ?? fetch;
  const env = opts.env ?? process.env;
  const headers: Record<string, string> = {};
  if (conn.auth) headers[conn.auth.header] = resolveSecrets(conn.auth.value, env);

  return conn.operations.map((op): Tool => ({
    name: op.name,
    description: op.description,
    inputSchema: op.input ?? { type: "object", properties: {} },
    async invoke(args: Record<string, unknown>) {
      const url = new URL(conn.baseUrl.replace(/\/$/, "") + op.path);
      const init: RequestInit = { method: op.method, headers: { ...headers } };
      if (op.method === "GET" || op.method === "DELETE") {
        for (const [k, v] of Object.entries(args)) url.searchParams.set(k, String(v));
      } else {
        (init.headers as Record<string, string>)["Content-Type"] = "application/json";
        init.body = JSON.stringify(args);
      }
      const res = await doFetch(url.toString(), init);
      if (!res.ok) throw new Error(`REST ${op.name} failed: ${res.status} ${res.statusText}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    },
  }));
}
