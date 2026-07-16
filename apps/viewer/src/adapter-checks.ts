import { BLUEPRINT_ADAPTERS, decodeVersion, type Blueprint } from "fpsr";
export type AdapterCheck = {
  id: string;
  used: boolean;
};
export const getAdapterChecks = (bp: Blueprint | null): AdapterCheck[] => {
  if (!bp || decodeVersion(bp.version ?? 0).major >= 2) {
    return BLUEPRINT_ADAPTERS.map((adapter) => ({ id: adapter.id, used: false }));
  }
  let current = bp;
  return BLUEPRINT_ADAPTERS.map((adapter) => {
    const before = current;
    const after = adapter.apply(before);
    const used = JSON.stringify(before) !== JSON.stringify(after);
    current = after;
    return { id: adapter.id, used };
  });
};
