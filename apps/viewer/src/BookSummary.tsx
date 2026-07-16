import type { BlueprintBook } from "fpsr";
import { memo, useMemo } from "react";
import { BlueprintIcons } from "./BlueprintIcons";
import { encodedBookByteSize, formatByteSize } from "./blueprintMeta";
import { FactorioRichText } from "./FactorioRichText";

export const BookSummary = memo(function BookSummary({
  book,
  sourceBytes,
}: {
  book: BlueprintBook;
  /** Exact encoded source size when this is the top-level book document. */
  sourceBytes?: number;
}) {
  const byteSize = useMemo(
    () => formatByteSize(sourceBytes ?? encodedBookByteSize(book)),
    [book, sourceBytes],
  );

  return (
    <div className="flex shrink-0 gap-4 p-4">
      <BlueprintIcons icons={book.icons} backgroundKey="item/blueprint-book" />

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium text-lg text-foreground">
            <FactorioRichText text={book.label} fallback="<Unnamed book>" size="lg" />
          </h2>
          <dd className="text-muted-foreground text-sm">
            <FactorioRichText text={book.description} fallback="No description" size="sm" />
          </dd>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Byte size</dt>
            <dd className="tabular-nums text-foreground">{byteSize}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
});
