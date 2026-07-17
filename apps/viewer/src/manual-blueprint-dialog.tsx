import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";

export const ManualBlueprintDialog = ({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (source: string) => Promise<boolean>;
}) => {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setDraft("");
  }, [open]);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      if (await onSubmit(draft)) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enter blueprint string</DialogTitle>
          <DialogDescription>
            Paste a Factorio blueprint string to add it to Custom.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="manual-blueprint">Blueprint string</Label>
          <Textarea
            id="manual-blueprint"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste a blueprint string here…"
            className="h-40 resize-none font-mono text-xs"
            disabled={submitting}
          />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={submitting} />}>
            Cancel
          </DialogClose>
          <Button disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
