export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  invoke(args: Record<string, unknown>): Promise<unknown>;
}
