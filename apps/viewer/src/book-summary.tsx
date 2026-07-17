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
    <div className="flex shrink-0 gap-4 p-4">
      <CopyableBlueprintIcons
        icons={book.icons}
        backgroundKey="item/blueprint-book"
        getBlueprintString={() => sourceString ?? encode({ blueprint_book: book })}
      />

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
};
