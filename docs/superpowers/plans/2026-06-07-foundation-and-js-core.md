# Foundation + JS SDK Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo foundation, the canonical config schema, and a working `slashh` JS SDK with a supervisor→agent orchestration loop over REST connections, proven by a shared conformance harness.

**Architecture:** A pnpm monorepo. Zod schemas in the JS package are the single in-code source of truth; we emit `schema/brain.schema.json` from them (the cross-language contract the Python package will later consume). The SDK exposes one in-memory `Brain` model with two equal front doors (config file and code builder) that round-trips to config. A thin `LLM` interface drives the agents-as-tools supervisor loop, with a deterministic `MockLLM` making behavior testable. v1 ships one real connection type (REST); MCP lands in Plan 2.

**Tech Stack:** TypeScript (ESM, NodeNext), pnpm workspaces, vitest, tsup, zod, zod-to-json-schema, Vercel AI SDK (`ai`).

---

## File Structure

```
slashh/
  package.json                      # root, pnpm workspace
  pnpm-workspace.yaml
  schema/
    brain.schema.json               # GENERATED from zod (committed artifact = the contract)
  fixtures/
    weather-lookup/
      config.json                   # a Brain config
      scenario.json                 # scripted LLM turns + mock REST responses + expected trace
  packages/js/
    package.json
    tsconfig.json
    tsup.config.ts
    vitest.config.ts
    src/
      index.ts                      # public exports
      types.ts                      # zod schemas + inferred TS types (config shapes)
      secrets.ts                    # SecretResolver: ${ENV} expansion
      brain.ts                      # Brain: fromConfig / addAgent / toConfig / run
      agent.ts                      # Agent run loop (LLM + its tools)
      tool.ts                       # Tool type
      llm/
        interface.ts                # LLM interface + message/tool-call types
        mock.ts                     # MockLLM (scripted, deterministic)
        ai-sdk.ts                   # Vercel AI SDK adapter (real provider)
      connections/
        rest.ts                     # Rest connection -> Tools
      scripts/
        emit-schema.ts              # writes schema/brain.schema.json
      conformance/
        run-fixtures.ts             # loads fixtures, runs Brain with MockLLM+mock REST, compares trace
    test/
      secrets.test.ts
      brain-config.test.ts
      rest.test.ts
      agent.test.ts
      supervisor.test.ts
      conformance.test.ts
```

---

### Task 1: Monorepo + JS package scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`
- Create: `packages/js/package.json`, `packages/js/tsconfig.json`, `packages/js/vitest.config.ts`, `packages/js/tsup.config.ts`
- Test: `packages/js/test/smoke.test.ts`

- [ ] **Step 1: Create workspace root**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`package.json`:
```json
{
  "name": "slashh-monorepo",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build"
  }
}
```

- [ ] **Step 2: Create JS package manifest**

`packages/js/package.json`:
```json
{
  "name": "slashh",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "test": "vitest run",
    "build": "tsup",
    "emit-schema": "tsx src/scripts/emit-schema.ts"
  },
  "dependencies": {
    "ai": "^4.0.0",
    "zod": "^3.23.0",
    "zod-to-json-schema": "^3.23.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Add tsconfig, vitest, tsup configs**

`packages/js/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`packages/js/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["test/**/*.test.ts"] } });
```

`packages/js/tsup.config.ts`:
```ts
import { defineConfig } from "tsup";
export default defineConfig({ entry: ["src/index.ts"], format: ["esm"], dts: true, clean: true });
```

- [ ] **Step 4: Write a smoke test**

`packages/js/test/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("runs the test runner", () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 5: Install and run**

Run: `pnpm install && pnpm --filter slashh test`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo and js package"
```

---

### Task 2: Config schemas (zod) + emit canonical JSON Schema

**Files:**
- Create: `packages/js/src/types.ts`
- Create: `packages/js/src/scripts/emit-schema.ts`
- Create (generated): `schema/brain.schema.json`
- Test: `packages/js/test/types.test.ts` (created here as `brain-config.test.ts` later reuses types)

- [ ] **Step 1: Write the failing test**

`packages/js/test/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { BrainConfigSchema } from "../src/types.js";

describe("BrainConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const cfg = {
      model: "anthropic/claude-sonnet-4-6",
      agents: [
        {
          name: "weather",
          description: "Looks up weather",
          instructions: "Answer weather questions.",
          connections: [
            { type: "rest", baseUrl: "https://api.example.com", auth: { header: "Authorization", value: "Bearer ${WX_KEY}" },
              operations: [{ name: "get_current", method: "GET", path: "/current", description: "Current weather",
                input: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }] }
          ]
        }
      ]
    };
    expect(() => BrainConfigSchema.parse(cfg)).not.toThrow();
  });

  it("rejects a config missing agent name", () => {
    expect(() => BrainConfigSchema.parse({ model: "x", agents: [{ description: "d", instructions: "i", connections: [] }] }))
      .toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter slashh test types`
Expected: FAIL ("Cannot find module ../src/types.js").

- [ ] **Step 3: Implement the schemas**

`packages/js/src/types.ts`:
```ts
import { z } from "zod";

export const JsonSchemaObject = z.object({
  type: z.literal("object"),
  properties: z.record(z.any()).default({}),
  required: z.array(z.string()).optional(),
}).passthrough();

export const RestOperation = z.object({
  name: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  description: z.string(),
  input: JsonSchemaObject.optional(),
});

export const RestConnection = z.object({
  type: z.literal("rest"),
  baseUrl: z.string(),
  auth: z.object({ header: z.string(), value: z.string() }).optional(),
  operations: z.array(RestOperation),
});

export const Connection = z.discriminatedUnion("type", [RestConnection]);

export const AgentConfig = z.object({
  name: z.string().min(1),
  description: z.string(),
  instructions: z.string(),
  model: z.string().optional(),
  connections: z.array(Connection).default([]),
});

export const BrainConfigSchema = z.object({
  model: z.string(),
  agents: z.array(AgentConfig).default([]),
});

export type BrainConfig = z.infer<typeof BrainConfigSchema>;
export type AgentConfigT = z.infer<typeof AgentConfig>;
export type ConnectionT = z.infer<typeof Connection>;
export type RestOperationT = z.infer<typeof RestOperation>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter slashh test types`
Expected: PASS, 2 tests.

- [ ] **Step 5: Implement schema emitter**

`packages/js/src/scripts/emit-schema.ts`:
```ts
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BrainConfigSchema } from "../types.js";

const out = resolve(process.cwd(), "../../schema/brain.schema.json");
const schema = zodToJsonSchema(BrainConfigSchema, "BrainConfig");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(schema, null, 2) + "\n");
console.log("wrote", out);
```

- [ ] **Step 6: Generate and verify the schema artifact**

Run: `pnpm --filter slashh emit-schema`
Expected: prints `wrote .../schema/brain.schema.json`; file exists and contains `"BrainConfig"`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: config schemas and canonical brain.schema.json emitter"
```

---

### Task 3: SecretResolver (`${ENV}` expansion)

**Files:**
- Create: `packages/js/src/secrets.ts`
- Test: `packages/js/test/secrets.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/js/test/secrets.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter slashh test secrets`
Expected: FAIL ("Cannot find module ../src/secrets.js").

- [ ] **Step 3: Implement**

`packages/js/src/secrets.ts`:
```ts
const REF = /\$\{([A-Z0-9_]+)\}/g;

export function resolveSecrets(value: string, env: Record<string, string | undefined> = process.env): string {
  return value.replace(REF, (_m, name: string) => {
    const v = env[name];
    if (v === undefined) throw new Error(`Missing environment variable for secret reference: ${name}`);
    return v;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter slashh test secrets`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: secret resolver for \${ENV} references"
```

---

### Task 4: Brain config↔code round-trip

**Files:**
- Create: `packages/js/src/brain.ts` (config load, addAgent, toConfig — run() added in Task 8)
- Test: `packages/js/test/brain-config.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/js/test/brain-config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Brain } from "../src/brain.js";

const cfg = {
  model: "anthropic/claude-sonnet-4-6",
  agents: [{ name: "weather", description: "Looks up weather", instructions: "Answer.", connections: [] }],
};

describe("Brain config<->code", () => {
  it("loads from config and serializes back identically", () => {
    const brain = Brain.fromConfig(cfg);
    expect(brain.toConfig()).toEqual(cfg);
  });

  it("builds the same model via the code API", () => {
    const brain = new Brain({ model: "anthropic/claude-sonnet-4-6" })
      .addAgent({ name: "weather", description: "Looks up weather", instructions: "Answer.", connections: [] });
    expect(brain.toConfig()).toEqual(cfg);
  });

  it("rejects an invalid config", () => {
    expect(() => Brain.fromConfig({ agents: [] } as any)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter slashh test brain-config`
Expected: FAIL ("Cannot find module ../src/brain.js").

- [ ] **Step 3: Implement Brain (config + builder, no run yet)**

`packages/js/src/brain.ts`:
```ts
import { readFileSync } from "node:fs";
import { BrainConfigSchema, type BrainConfig, type AgentConfigT } from "./types.js";

export class Brain {
  model: string;
  agents: AgentConfigT[];

  constructor(opts: { model: string; agents?: AgentConfigT[] }) {
    this.model = opts.model;
    this.agents = opts.agents ?? [];
  }

  static fromConfig(input: BrainConfig | string): Brain {
    const raw = typeof input === "string" ? JSON.parse(readFileSync(input, "utf8")) : input;
    const cfg = BrainConfigSchema.parse(raw);
    return new Brain({ model: cfg.model, agents: cfg.agents });
  }

  addAgent(agent: AgentConfigT): this {
    this.agents.push(agent);
    return this;
  }

  toConfig(): BrainConfig {
    return BrainConfigSchema.parse({ model: this.model, agents: this.agents });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter slashh test brain-config`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Brain config<->code round-trip"
```

---

### Task 5: LLM interface + MockLLM

**Files:**
- Create: `packages/js/src/llm/interface.ts`
- Create: `packages/js/src/llm/mock.ts`
- Create: `packages/js/src/tool.ts`
- Test: `packages/js/test/mock-llm.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/js/test/mock-llm.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { MockLLM } from "../src/llm/mock.js";

describe("MockLLM", () => {
  it("returns scripted turns in order", async () => {
    const llm = new MockLLM([
      { toolCalls: [{ id: "1", name: "get_current", arguments: { city: "Paris" } }] },
      { text: "It is sunny in Paris." },
    ]);
    const first = await llm.complete({ system: "s", messages: [], tools: [] });
    expect(first.toolCalls?.[0].name).toBe("get_current");
    const second = await llm.complete({ system: "s", messages: [], tools: [] });
    expect(second.text).toBe("It is sunny in Paris.");
  });

  it("throws when scripted turns run out", async () => {
    const llm = new MockLLM([{ text: "done" }]);
    await llm.complete({ system: "s", messages: [], tools: [] });
    await expect(llm.complete({ system: "s", messages: [], tools: [] })).rejects.toThrow(/no scripted turn/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter slashh test mock-llm`
Expected: FAIL ("Cannot find module ../src/llm/mock.js").

- [ ] **Step 3: Implement Tool, LLM interface, MockLLM**

`packages/js/src/tool.ts`:
```ts
export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  invoke(args: Record<string, unknown>): Promise<unknown>;
}
```

`packages/js/src/llm/interface.ts`:
```ts
export interface LLMMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  tools: LLMToolSpec[];
}

export interface LLMResponse {
  text?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLM {
  complete(req: LLMRequest): Promise<LLMResponse>;
}
```

`packages/js/src/llm/mock.ts`:
```ts
import type { LLM, LLMRequest, LLMResponse } from "./interface.js";

export class MockLLM implements LLM {
  private turns: LLMResponse[];
  private i = 0;
  constructor(turns: LLMResponse[]) { this.turns = turns; }
  async complete(_req: LLMRequest): Promise<LLMResponse> {
    if (this.i >= this.turns.length) throw new Error("MockLLM: no scripted turn left");
    return this.turns[this.i++];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter slashh test mock-llm`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: LLM interface, Tool type, and deterministic MockLLM"
```

---

### Task 6: REST connection → Tools

**Files:**
- Create: `packages/js/src/connections/rest.ts`
- Test: `packages/js/test/rest.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/js/test/rest.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter slashh test rest`
Expected: FAIL ("Cannot find module ../src/connections/rest.js").

- [ ] **Step 3: Implement**

`packages/js/src/connections/rest.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter slashh test rest`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: REST connection adapter building invokable tools"
```

---

### Task 7: Agent run loop (single agent over its tools)

**Files:**
- Create: `packages/js/src/agent.ts`
- Test: `packages/js/test/agent.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/js/test/agent.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { runAgent } from "../src/agent.js";
import { MockLLM } from "../src/llm/mock.js";
import type { Tool } from "../src/tool.js";

describe("runAgent", () => {
  it("calls a tool then returns the final text", async () => {
    const calls: Record<string, unknown>[] = [];
    const tool: Tool = {
      name: "get_current", description: "Current weather",
      inputSchema: { type: "object", properties: {} },
      async invoke(args) { calls.push(args); return { tempC: 21 }; },
    };
    const llm = new MockLLM([
      { toolCalls: [{ id: "t1", name: "get_current", arguments: { city: "Paris" } }] },
      { text: "It is 21C in Paris." },
    ]);
    const out = await runAgent({
      agent: { name: "weather", description: "d", instructions: "Answer.", connections: [] },
      input: "weather in Paris?", llm, tools: [tool],
    });
    expect(calls).toEqual([{ city: "Paris" }]);
    expect(out.text).toBe("It is 21C in Paris.");
    expect(out.toolCalls.map((c) => c.name)).toEqual(["get_current"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter slashh test agent`
Expected: FAIL ("Cannot find module ../src/agent.js").

- [ ] **Step 3: Implement the agent loop**

`packages/js/src/agent.ts`:
```ts
import type { AgentConfigT } from "./types.js";
import type { LLM, LLMMessage, LLMToolCall } from "./llm/interface.js";
import type { Tool } from "./tool.js";

export interface AgentRunResult {
  text: string;
  toolCalls: LLMToolCall[];
}

const MAX_STEPS = 10;

export async function runAgent(params: {
  agent: AgentConfigT;
  input: string;
  llm: LLM;
  tools: Tool[];
}): Promise<AgentRunResult> {
  const { agent, input, llm, tools } = params;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const messages: LLMMessage[] = [{ role: "user", content: input }];
  const allCalls: LLMToolCall[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await llm.complete({
      system: agent.instructions,
      messages,
      tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    });

    if (res.toolCalls?.length) {
      for (const call of res.toolCalls) {
        allCalls.push(call);
        const tool = byName.get(call.name);
        let content: string;
        try {
          content = JSON.stringify(tool ? await tool.invoke(call.arguments) : { error: `unknown tool ${call.name}` });
        } catch (err) {
          content = JSON.stringify({ error: String(err instanceof Error ? err.message : err) });
        }
        messages.push({ role: "assistant", content: "", toolCallId: call.id, name: call.name });
        messages.push({ role: "tool", content, toolCallId: call.id, name: call.name });
      }
      continue;
    }

    return { text: res.text ?? "", toolCalls: allCalls };
  }
  throw new Error(`Agent ${agent.name} exceeded ${MAX_STEPS} steps`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter slashh test agent`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: single-agent run loop over connection tools"
```

---

### Task 8: Supervisor loop — `Brain.run`

**Files:**
- Modify: `packages/js/src/brain.ts` (add `run`, tool-building, LLM injection)
- Create: `packages/js/src/index.ts`
- Test: `packages/js/test/supervisor.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/js/test/supervisor.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Brain } from "../src/brain.js";
import { MockLLM } from "../src/llm/mock.js";

describe("Brain.run supervisor", () => {
  it("delegates to an agent then answers", async () => {
    const fetchMock = async () => new Response(JSON.stringify({ tempC: 21 }), { status: 200 });
    const brain = Brain.fromConfig({
      model: "mock",
      agents: [{
        name: "weather", description: "Weather specialist", instructions: "Answer weather.",
        connections: [{ type: "rest", baseUrl: "https://api.example.com",
          operations: [{ name: "get_current", method: "GET", path: "/current", description: "Current weather",
            input: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }] }],
      }],
    });

    // Supervisor LLM: delegate to weather, then final answer.
    const supervisor = new MockLLM([
      { toolCalls: [{ id: "d1", name: "delegate_weather", arguments: { input: "weather in Paris?" } }] },
      { text: "It is 21C in Paris." },
    ]);
    // Agent LLM: call REST tool, then return its summary to the supervisor.
    const agentLLM = new MockLLM([
      { toolCalls: [{ id: "a1", name: "get_current", arguments: { city: "Paris" } }] },
      { text: "21C and clear." },
    ]);

    const out = await brain.run("weather in Paris?", {
      llmFor: (role) => (role === "supervisor" ? supervisor : agentLLM),
      env: {}, fetch: fetchMock as unknown as typeof fetch,
    });

    expect(out.text).toBe("It is 21C in Paris.");
    expect(out.delegations).toEqual([{ agent: "weather", result: "21C and clear." }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter slashh test supervisor`
Expected: FAIL ("brain.run is not a function").

- [ ] **Step 3: Implement supervisor in `brain.ts`**

Add these imports at the top of `packages/js/src/brain.ts`:
```ts
import type { LLM, LLMMessage, LLMToolCall } from "./llm/interface.js";
import type { Tool } from "./tool.js";
import { buildRestTools } from "./connections/rest.js";
import { runAgent } from "./agent.js";
```

Add these types and methods to `packages/js/src/brain.ts` (inside/after the class):
```ts
export interface BrainRunOptions {
  llmFor?: (role: "supervisor" | string) => LLM;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export interface BrainRunResult {
  text: string;
  delegations: { agent: string; result: string }[];
}

// --- add inside class Brain ---
//
//   private buildAgentTools(agent: AgentConfigT, opts: BrainRunOptions): Tool[] {
//     const tools: Tool[] = [];
//     for (const conn of agent.connections) {
//       if (conn.type === "rest") tools.push(...buildRestTools(conn, { env: opts.env, fetch: opts.fetch }));
//     }
//     return tools;
//   }
//
//   async run(input: string, opts: BrainRunOptions = {}): Promise<BrainRunResult> {
//     if (!opts.llmFor) throw new Error("Brain.run requires opts.llmFor until the AI SDK adapter is wired (Task 9b)");
//     const supervisor = opts.llmFor("supervisor");
//     const delegations: { agent: string; result: string }[] = [];
//     const delegateTools: Tool[] = this.agents.map((agent) => ({
//       name: `delegate_${agent.name}`,
//       description: `Delegate to ${agent.name}: ${agent.description}`,
//       inputSchema: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
//       invoke: async (args) => {
//         const agentTools = this.buildAgentTools(agent, opts);
//         const result = await runAgent({ agent, input: String(args.input ?? ""), llm: opts.llmFor!(agent.name), tools: agentTools });
//         delegations.push({ agent: agent.name, result: result.text });
//         return { result: result.text };
//       },
//     }));
//
//     const byName = new Map(delegateTools.map((t) => [t.name, t]));
//     const messages: LLMMessage[] = [{ role: "user", content: input }];
//     const MAX = 10;
//     for (let step = 0; step < MAX; step++) {
//       const res = await supervisor.complete({
//         system: "You are the supervisor. Delegate to specialist agents via the delegate_* tools, then answer the user.",
//         messages,
//         tools: delegateTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
//       });
//       if (res.toolCalls?.length) {
//         for (const call of res.toolCalls) {
//           const tool = byName.get(call.name);
//           const content = JSON.stringify(tool ? await tool.invoke(call.arguments) : { error: `unknown ${call.name}` });
//           messages.push({ role: "assistant", content: "", toolCallId: call.id, name: call.name });
//           messages.push({ role: "tool", content, toolCallId: call.id, name: call.name });
//         }
//         continue;
//       }
//       return { text: res.text ?? "", delegations };
//     }
//     throw new Error("Supervisor exceeded step budget");
//   }
```

Implement the two methods above as real (uncommented) members of `class Brain`, and export the new interfaces. The commented block shows the exact code — paste it in as actual methods.

- [ ] **Step 4: Create the public entry point**

`packages/js/src/index.ts`:
```ts
export { Brain } from "./brain.js";
export type { BrainRunOptions, BrainRunResult } from "./brain.js";
export type { BrainConfig, AgentConfigT, ConnectionT } from "./types.js";
export type { LLM, LLMRequest, LLMResponse } from "./llm/interface.js";
export { MockLLM } from "./llm/mock.js";
export type { Tool } from "./tool.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter slashh test supervisor`
Expected: PASS, 1 test.

- [ ] **Step 6: Build the package**

Run: `pnpm --filter slashh build`
Expected: `dist/index.js` and `dist/index.d.ts` produced, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: supervisor loop and public Brain.run API"
```

---

### Task 9: Vercel AI SDK adapter (real provider)

**Files:**
- Create: `packages/js/src/llm/ai-sdk.ts`
- Modify: `packages/js/src/brain.ts` (default `llmFor` to the AI SDK adapter)
- Test: `packages/js/test/ai-sdk.test.ts`

- [ ] **Step 1: Write the failing test (maps our tools/messages onto AI SDK shapes)**

`packages/js/test/ai-sdk.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toAiSdkTools, fromAiSdkResult } from "../src/llm/ai-sdk.js";

describe("ai-sdk mapping", () => {
  it("maps our tool specs to AI SDK tool definitions", () => {
    const tools = toAiSdkTools([{ name: "get_current", description: "d", inputSchema: { type: "object", properties: {} } }]);
    expect(Object.keys(tools)).toEqual(["get_current"]);
    expect(tools.get_current.description).toBe("d");
  });

  it("normalizes an AI SDK result with tool calls", () => {
    const out = fromAiSdkResult({ text: "", toolCalls: [{ toolCallId: "1", toolName: "get_current", args: { city: "Paris" } }] });
    expect(out.toolCalls).toEqual([{ id: "1", name: "get_current", arguments: { city: "Paris" } }]);
  });

  it("normalizes a plain text result", () => {
    const out = fromAiSdkResult({ text: "hello", toolCalls: [] });
    expect(out).toEqual({ text: "hello", toolCalls: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter slashh test ai-sdk`
Expected: FAIL ("Cannot find module ../src/llm/ai-sdk.js").

- [ ] **Step 3: Implement the adapter mapping + LLM**

`packages/js/src/llm/ai-sdk.ts`:
```ts
import { generateText, jsonSchema, tool as aiTool } from "ai";
import type { LLM, LLMRequest, LLMResponse, LLMToolSpec } from "./interface.js";

export function toAiSdkTools(specs: LLMToolSpec[]): Record<string, ReturnType<typeof aiTool>> {
  const out: Record<string, ReturnType<typeof aiTool>> = {};
  for (const s of specs) {
    out[s.name] = aiTool({
      description: s.description,
      parameters: jsonSchema(s.inputSchema as Record<string, unknown>),
    });
  }
  return out;
}

export function fromAiSdkResult(result: { text: string; toolCalls: { toolCallId: string; toolName: string; args: unknown }[] }): LLMResponse {
  if (result.toolCalls?.length) {
    return {
      text: result.text || undefined,
      toolCalls: result.toolCalls.map((c) => ({ id: c.toolCallId, name: c.toolName, arguments: (c.args ?? {}) as Record<string, unknown> })),
    };
  }
  return { text: result.text, toolCalls: [] };
}

export class AiSdkLLM implements LLM {
  constructor(private model: string) {}
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const result = await generateText({
      model: this.model as never, // AI SDK resolves "provider/model" strings via the gateway
      system: req.system,
      messages: req.messages.map((m) => ({ role: m.role === "tool" ? "tool" : m.role, content: m.content } as never)),
      tools: toAiSdkTools(req.tools),
    });
    return fromAiSdkResult(result as never);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter slashh test ai-sdk`
Expected: PASS, 3 tests.

- [ ] **Step 5: Default `llmFor` to the AI SDK adapter in `brain.ts`**

In `Brain.run`, replace the guard:
```ts
if (!opts.llmFor) throw new Error("Brain.run requires opts.llmFor until the AI SDK adapter is wired (Task 9b)");
const supervisor = opts.llmFor("supervisor");
```
with:
```ts
const { AiSdkLLM } = await import("./llm/ai-sdk.js");
const llmFor = opts.llmFor ?? ((role: string) => {
  const agent = role === "supervisor" ? undefined : this.agents.find((a) => a.name === role);
  return new AiSdkLLM(agent?.model ?? this.model);
});
const supervisor = llmFor("supervisor");
```
Then replace every later `opts.llmFor!(...)` / `opts.llmFor("...")` call inside `run` with `llmFor(...)`.

- [ ] **Step 6: Run the full suite + build**

Run: `pnpm --filter slashh test && pnpm --filter slashh build`
Expected: all tests PASS; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Vercel AI SDK LLM adapter as default provider"
```

---

### Task 10: Shared conformance harness + first fixture

**Files:**
- Create: `fixtures/weather-lookup/config.json`
- Create: `fixtures/weather-lookup/scenario.json`
- Create: `packages/js/src/conformance/run-fixtures.ts`
- Test: `packages/js/test/conformance.test.ts`

- [ ] **Step 1: Create the fixture config**

`fixtures/weather-lookup/config.json`:
```json
{
  "model": "mock",
  "agents": [
    {
      "name": "weather",
      "description": "Weather specialist",
      "instructions": "Answer weather questions using your tools.",
      "connections": [
        {
          "type": "rest",
          "baseUrl": "https://api.example.com",
          "operations": [
            { "name": "get_current", "method": "GET", "path": "/current", "description": "Current weather",
              "input": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] } }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Create the scenario (scripted LLM turns + mock REST + expected trace)**

`fixtures/weather-lookup/scenario.json`:
```json
{
  "input": "What is the weather in Paris?",
  "restResponses": { "get_current": { "tempC": 21, "summary": "clear" } },
  "llm": {
    "supervisor": [
      { "toolCalls": [{ "id": "d1", "name": "delegate_weather", "arguments": { "input": "weather in Paris" } }] },
      { "text": "It is 21C and clear in Paris." }
    ],
    "weather": [
      { "toolCalls": [{ "id": "a1", "name": "get_current", "arguments": { "city": "Paris" } }] },
      { "text": "21C and clear." }
    ]
  },
  "expect": {
    "text": "It is 21C and clear in Paris.",
    "delegations": [{ "agent": "weather", "result": "21C and clear." }]
  }
}
```

- [ ] **Step 3: Write the failing test**

`packages/js/test/conformance.test.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter slashh test conformance`
Expected: FAIL ("Cannot find module ../src/conformance/run-fixtures.js").

- [ ] **Step 5: Implement the fixture runner**

`packages/js/src/conformance/run-fixtures.ts`:
```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Brain } from "../brain.js";
import { MockLLM } from "../llm/mock.js";
import type { LLMResponse } from "../llm/interface.js";

export async function runFixture(dir: string): Promise<{ actual: unknown; expected: unknown }> {
  const config = JSON.parse(readFileSync(resolve(dir, "config.json"), "utf8"));
  const scenario = JSON.parse(readFileSync(resolve(dir, "scenario.json"), "utf8")) as {
    input: string;
    restResponses: Record<string, unknown>;
    llm: Record<string, LLMResponse[]>;
    expect: unknown;
  };

  const mocks = new Map<string, MockLLM>();
  for (const [role, turns] of Object.entries(scenario.llm)) mocks.set(role, new MockLLM(turns));

  const fetchMock = (async (url: string) => {
    const op = String(url).split("/").pop()!.split("?")[0];
    // match by operation path segment -> response keyed by operation name is resolved in the agent tool;
    // for the fixture we key responses by operation name, so find by suffix.
    const key = Object.keys(scenario.restResponses).find((k) => String(url).includes(k.replace("get_", "")) ) ?? Object.keys(scenario.restResponses)[0];
    return new Response(JSON.stringify(scenario.restResponses[key]), { status: 200 });
  }) as unknown as typeof fetch;

  const brain = Brain.fromConfig(config);
  const actual = await brain.run(scenario.input, {
    llmFor: (role) => {
      const m = mocks.get(role);
      if (!m) throw new Error(`No scripted LLM for role ${role}`);
      return m;
    },
    env: {},
    fetch: fetchMock,
  });

  return { actual, expected: scenario.expect };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter slashh test conformance`
Expected: PASS, 1 fixture.

- [ ] **Step 7: Run the entire suite**

Run: `pnpm --filter slashh test`
Expected: all tests across every file PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: shared conformance harness with weather-lookup fixture"
```

---

## Notes for Plan 2 and Plan 3

- **Plan 2 (JS MCP connections):** add `McpStdio`/`McpHttp` to the `Connection` discriminated union in `types.ts`, re-emit `brain.schema.json`, add `connections/mcp-stdio.ts` and `connections/mcp-http.ts` using `@modelcontextprotocol/sdk`, extend `Brain.buildAgentTools` to handle them, and add a connection-lifecycle (open/close) phase to `Brain.run`.
- **Plan 3 (Python package):** mirror this API in `packages/py` (`Brain.from_config`, `.add_agent`, `.to_config`, `.run`), validate configs against the committed `schema/brain.schema.json`, and make `test/conformance` in Python load the SAME `fixtures/` directory and assert the SAME `expect` traces.
