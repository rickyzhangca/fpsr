import { cn } from "@/lib/utils";
import { parseRichText, richTextIconKeys, richTextIconQuality, type RichTextToken } from "fpsr";
import { FactorioItemIcon } from "./factorio-item-icon";
const SIZE_PX = {
  lg: 20,
  sm: 16,
  xs: 14,
} as const;
export const FactorioRichText = ({
  text,
  fallback,
  size = "sm",
  className,
}: {
  text?: string;
  fallback?: string;
  size?: keyof typeof SIZE_PX;
  className?: string;
}) => {
  const trimmed = text?.trim();
  if (!trimmed) {
    if (fallback === undefined) return null;
    return <span className={className}>{fallback}</span>;
  }
  const tokens = parseRichText(trimmed);
  const iconSize = SIZE_PX[size];
  return (
    <span className={cn("inline", className)}>
      {tokens.map((token, index) => (
        <RichTextTokenView key={`${index}-${tokenKey(token)}`} token={token} iconSize={iconSize} />
      ))}
    </span>
  );
};
const tokenKey = (token: RichTextToken): string => {
  if (token.kind === "text") return token.value;
  return token.raw;
};
const RichTextTokenView = ({ token, iconSize }: { token: RichTextToken; iconSize: number }) => {
  if (token.kind === "text") {
    return <>{token.value}</>;
  }
  return (
    <span
      className="mx-px inline-block align-middle leading-none"
      style={{ width: iconSize, height: iconSize }}
    >
      <FactorioItemIcon
        iconKey={richTextIconKeys(token)}
        quality={richTextIconQuality(token)}
        iconSize={iconSize}
        title={token.raw}
        inline
      />
    </span>
  );
};
