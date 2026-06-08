const REF = /\$\{([A-Z0-9_]+)\}/g;

export function resolveSecrets(value: string, env: Record<string, string | undefined> = process.env): string {
  return value.replace(REF, (_m, name: string) => {
    const v = env[name];
    if (v === undefined) throw new Error(`Missing environment variable for secret reference: ${name}`);
    return v;
  });
}
