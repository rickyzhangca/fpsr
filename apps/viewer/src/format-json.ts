export const formatJson = async (value: unknown): Promise<string> => {
  return JSON.stringify(value, null, 2) ?? "null";
};
