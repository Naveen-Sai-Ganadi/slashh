import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Brain } from "../brain.js";
import { MockLLM } from "../llm/mock.js";
import type { LLMResponse } from "../llm/interface.js";

interface Scenario {
  input: string;
  restResponses: Record<string, unknown>;
  llm: Record<string, LLMResponse[]>;
  expect: unknown;
}

/**
 * Build a map from a REST operation's path (e.g. "/current") to its operation
 * name (e.g. "get_current"), so the mock fetch can resolve scenario responses
 * by URL without fragile string matching.
 */
function pathToOpName(config: any): Map<string, string> {
  const map = new Map<string, string>();
  for (const agent of config.agents ?? []) {
    for (const conn of agent.connections ?? []) {
      if (conn.type !== "rest") continue;
      for (const op of conn.operations ?? []) map.set(op.path, op.name);
    }
  }
  return map;
}

export async function runFixture(dir: string): Promise<{ actual: unknown; expected: unknown }> {
  const config = JSON.parse(readFileSync(resolve(dir, "config.json"), "utf8"));
  const scenario = JSON.parse(readFileSync(resolve(dir, "scenario.json"), "utf8")) as Scenario;

  const mocks = new Map<string, MockLLM>();
  for (const [role, turns] of Object.entries(scenario.llm)) mocks.set(role, new MockLLM(turns));

  const paths = pathToOpName(config);
  const fetchMock = (async (url: string) => {
    const { pathname } = new URL(String(url));
    const opName = paths.get(pathname);
    if (!opName || !(opName in scenario.restResponses)) {
      throw new Error(`No mock REST response for ${pathname} (operation ${opName ?? "unknown"})`);
    }
    return new Response(JSON.stringify(scenario.restResponses[opName]), { status: 200 });
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
