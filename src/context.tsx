import { createContext, useContext } from "react";
import type { DataService } from "./service";
import type { CompanyBranch, Product, Profile, PriceRule, Zone } from "./types";
export interface Workspace {
  demo: boolean;
  profile: Profile;
  service: DataService;
  branches: CompanyBranch[];
  zones: Zone[];
  products: Product[];
  rules: PriceRule[];
  revision: number;
  refresh: () => void;
  toast: (message: string, error?: boolean) => void;
}
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const w = useContext(WorkspaceContext);
  if (!w) throw new Error("Workspace unavailable");
  return w;
}
