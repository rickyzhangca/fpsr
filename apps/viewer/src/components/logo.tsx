import { cn } from "@/lib/utils";
import logoUrl from "./logo.svg";

export const Logo = ({ className }: { className?: string } = {}) => (
  <img src={logoUrl} alt="" width={143} height={43} draggable={false} className={cn(className)} />
);
