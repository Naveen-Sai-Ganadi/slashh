# Company Brain — Design

**Status:** Approved (2026-06-07)
**Scope:** v1 of the two-language SDK core (npm + pip/uv). Localhost app is a later phase.

## Summary

Company Brain is a **supervisor-style multi-agent engine** shipped as two SDKs with
matching APIs — an npm package and a pip/uv package — plus, later, a clone-and-run
localhost app layered on top. A user defines a **Brain** (an LLM supervisor) and a set
of **Agents** (specialists), each wired to **Connections** (MCP servers or REST APIs).
The brain routes work to agents and synthesizes their results.

## Locked Decisions

| Area | Decision |
| --- | --- |
| Deliverables | npm + Python packages with matching APIs, built in parallel; localhost app afterward |
| Brain model | Supervisor + specialist sub-agents ("agents-as-tools") |
| LLM | Provider-agnostic, behind a thin internal `LLM` interface |
| Definitions | One in-memory model, two equal front doors (config file + code), serializable both ways |
| Connections (v1) | MCP stdio, MCP HTTP/SSE, generic REST. (OpenAPI import = later) |
| Secrets | `${ENV_VAR}` refs in config; packages read env, app keeps a gitignored local store |
| Repo structure | Monorepo + shared JSON Schema contract + shared conformance fixtures |

## 1. Architecture & Repo Layout

A monorepo where a **language-neutral JSON Schema is the contract**, two SDKs implement
it, and shared fixtures keep them honest.

```
slashh/
  schema/
    brain.schema.json        # canonical config schema — the source of truth
  fixtures/                  # shared scenarios: config + scripted LLM/tool I/O -> expected trace
  packages/
    js/                      # npm: "slashh"
    py/                      # pip/uv: "slashh"
  docs/superpowers/specs/    # this design
  app/                       # (later) clone-and-run localhost UI
```

## 2. Core Domain Model

Identical concepts in both languages.

- **Brain** — the supervisor. Holds an LLM config, a set of Agents, global settings.
  Entry points: `Brain.from_config(path)` or `new Brain({...}).addAgent(...)`. Both
  produce the *same* in-memory object, which serializes back to config. This is how
  "config + code, equal" avoids drift: a single underlying model, two front doors.
- **Agent** — a specialist: `name`, `description` (used by the supervisor for routing),
  `instructions` (system prompt), optional LLM override, and a list of **Connections**.
- **Connection** — a tool source. Three v1 types:
  - `McpStdio` — command, args, env
  - `McpHttp` — url, headers
  - `Rest` — baseUrl, auth, operations[]
  Each resolves to one or more **Tools** at runtime.
- **Tool** — name + JSON-schema input + invoke fn, namespaced per agent to avoid collisions.
- **SecretResolver** — expands `${ENV_VAR}` refs (from env in packages; from the local
  store in the app). A missing ref is a clear error at load time, not a silent failure.

## 3. Orchestration Loop ("agents-as-tools" supervisor)

1. Brain receives input. The supervisor LLM is given one delegation tool *per agent*,
   each labeled with that agent's `description`.
2. The supervisor either answers directly or calls one/more agent-delegation tools.
3. A delegated agent runs its **own** LLM loop over **its** connection tools (multi-step
   until done) and returns a result.
4. The supervisor folds results in, may delegate again, then produces the final answer.

Recursive, provider-agnostic, and a natural fit for "craft agents, the brain talks to them."

## 4. Provider-agnostic LLM

Both SDKs sit behind a thin internal `LLM` interface (chat + tool-calling) so the
orchestration loop is identical across languages.

- **JS** implements it on the **Vercel AI SDK** (model strings / AI Gateway).
- **Python** implements it over the official provider SDKs, with an optional
  multi-provider layer.

Model is just a config string, e.g. `anthropic/claude-sonnet-4-6`.

## 5. Connection Lifecycle

On `run`, each connection initializes:
- **MCP stdio** spawns a subprocess and handshakes.
- **MCP http** opens an SSE stream.
- **REST** builds tools from declared operations.

Tools are then listed and namespaced per agent. Graceful shutdown closes subprocesses
and streams. A connection that fails to initialize surfaces a clear error; an agent that
errors mid-run returns an error result the supervisor can route around or report.

## 6. API Surface (matching, idiomatic per language)

JavaScript:
```ts
import { Brain } from "slashh";

const brain = Brain.fromConfig("brain.yaml");
// or: new Brain({ model: "anthropic/claude-sonnet-4-6" }).addAgent({ ... })

const res = await brain.run("Summarize last week's GitHub issues");
```

Python:
```py
from company_brain import Brain

brain = Brain.from_config("brain.yaml")
# or: Brain(model="anthropic/claude-sonnet-4-6").add_agent(...)

res = brain.run("Summarize last week's GitHub issues")   # sync + async variants
```

## 7. Testing — Parity Is the Whole Game

Each fixture is a config plus a **scripted scenario**: a mock LLM (deterministic canned
responses) and mock MCP/REST tool outputs, plus the **expected delegation/tool-call
trace**. *Both* packages run *the same* fixtures, so any divergence fails CI. Per-package
unit tests cover the connection adapters. The deterministic mock LLM is what makes
cross-language equivalence testable.

## 8. Error Handling

- Missing `${ENV_VAR}` at config load → clear, named error.
- Connection init failure → surfaced with the connection's identity.
- Agent error mid-run → returned as an error result to the supervisor, which may route
  around it or report it.
- Invalid config against `brain.schema.json` → validation error listing offending paths.

## 9. v1 Scope Boundary (YAGNI)

**In:** the three connection types; the supervisor loop; both SDK APIs; config↔code
round-trip; single-run plus optional passed-in message history.

**Out (later):** the localhost app; OpenAPI import; long-term/persistent memory;
streaming; auth/multi-tenant.
