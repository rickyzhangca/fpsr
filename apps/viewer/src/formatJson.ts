export async function formatJson(value: unknown): Promise<string> {
  return JSON.stringify(value, null, 2) ?? "null";
}
