import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { stripRichText, type Blueprint } from "fpsr";
import { toast } from "sonner";
import { trackEvent } from "@/shell/analytics";
import { EXPORT_OPTIONS, exportFormatLabel, formatExportSize, type ExportFormat } from "./format";

export const PreviewExportControls = ({
  blueprint,
  exportFormat,
  exportBlob,
  exportError,
  controlsDisabled,
  downloadPendingLabel,
  fullResolution,
  prepareExport,
}: {
  blueprint: Blueprint | null;
  exportFormat: ExportFormat;
  exportBlob: Blob | undefined;
  exportError: string | undefined;
  controlsDisabled: boolean;
  downloadPendingLabel: string | null;
  fullResolution: boolean;
  prepareExport: () => Promise<Blob>;
}) => {
  const exportLabel = exportFormatLabel(exportFormat);

  const handleDownload = async () => {
    const filename = `${stripRichText(blueprint?.label).replace(/[^\w.-]+/g, "_") || "blueprint"}.${exportFormat}`;
    try {
      const blob = exportBlob ?? (await prepareExport());
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      trackEvent("export_download", { format: exportFormat });
      toast.success(`${exportLabel} downloaded`, { description: filename });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Download failed";
      toast.error(message);
    }
  };

  const handleCopy = async () => {
    const mime = EXPORT_OPTIONS[exportFormat].type;
    if (typeof ClipboardItem.supports === "function" && !ClipboardItem.supports(mime)) {
      toast.error(`${exportLabel} images are not supported by this browser's clipboard`);
      return;
    }
    try {
      const blob = exportBlob ?? (await prepareExport());
      await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
      trackEvent("export_copy", { format: exportFormat });
      toast.success(`${exportLabel} copied to clipboard`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Copy failed";
      toast.error(message);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        onClick={() => void handleDownload()}
        disabled={controlsDisabled}
        aria-busy={downloadPendingLabel !== null}
        title={exportError}
      >
        {downloadPendingLabel && <Spinner data-icon="inline-start" />}
        {downloadPendingLabel ??
          (fullResolution
            ? exportBlob
              ? `Download full-res · ${formatExportSize(exportBlob.size)}`
              : "Download full-res PNG"
            : exportBlob
              ? `Download ${formatExportSize(exportBlob.size)}`
              : `Download ${exportLabel}`)}
      </Button>
      <Button onClick={() => void handleCopy()} disabled={controlsDisabled} title={exportError}>
        {fullResolution ? "Copy full-res PNG" : `Copy ${exportLabel}`}
      </Button>
    </div>
  );
};
