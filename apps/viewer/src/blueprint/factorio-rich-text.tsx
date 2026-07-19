import { cn } from "@/lib/utils";
import {
  parseRichText,
  richTextIconKeys,
  richTextIconQuality,
  type RichTextToken,
} from "@rickyzhangca/fpsr";
import { FactorioItemIcon } from "./factorio-item-icon";
const SIZE_PX = {
  lg: 20,
  sm: 16,
  xs: 14,
} as const;

const rootClassName = (className?: string) =>
  cn(className?.includes("truncate") ? "block min-w-0 max-w-full" : "inline", className);

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
    return <span className={rootClassName(className)}>{fallback}</span>;
  }
  const tokens = parseRichText(trimmed);
  const iconSize = SIZE_PX[size];
  return (
    <span className={rootClassName(className)}>
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
