import { encode, type BlueprintBook } from "fpsr";
import { encodedBookByteSize, formatByteSize } from "./blueprint-meta";
import { CopyableBlueprintIcons } from "./copyable-blueprint-icons";
import { FactorioRichText } from "./factorio-rich-text";

export const BookSummary = ({
  book,
  sourceBytes,
  sourceString,
}: {
  book: BlueprintBook;
  /** Exact encoded source size when this is the top-level book document. */
  sourceBytes?: number;
  /** Original Factorio string when this is a top-level book document. */
  sourceString?: string;
}) => {
  const byteSize = formatByteSize(sourceBytes ?? encodedBookByteSize(book));
  return (
    <div className="flex min-w-0 shrink-0 gap-4 overflow-hidden p-4">
      <CopyableBlueprintIcons
        icons={book.icons}
        backgroundKey="item/blueprint-book"
        getBlueprintString={() => sourceString ?? encode({ blueprint_book: book })}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="min-w-0">
          <h2 className="break-words font-medium text-lg text-foreground">
            <FactorioRichText text={book.label} fallback="<Unnamed book>" size="lg" />
          </h2>
          <dd className="break-words text-muted-foreground text-sm">
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
};
