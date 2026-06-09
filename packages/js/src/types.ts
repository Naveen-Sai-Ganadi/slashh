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

export const McpStdioConnection = z.object({
  type: z.literal("mcp-stdio"),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
});

export const McpHttpConnection = z.object({
  type: z.literal("mcp-http"),
  url: z.string(),
  headers: z.record(z.string()).optional(),
});

export const Connection = z.discriminatedUnion("type", [
  RestConnection,
  McpStdioConnection,
  McpHttpConnection,
]);

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
export type McpStdioConnectionT = z.infer<typeof McpStdioConnection>;
export type McpHttpConnectionT = z.infer<typeof McpHttpConnection>;
