import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CancellationRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (comment: string, proof: string, proofImage: File | null) => void | Promise<void>;
  loading?: boolean;
  requesterLabel?: string;
  mode?: "request" | "direct";
}

export default function CancellationRequestDialog({
  open,
  onOpenChange,
  onSubmit,
  loading = false,
  requesterLabel = "your manager",
  mode = "request",
}: CancellationRequestDialogProps) {
  const [comment, setComment] = useState("");
  const [proof, setProof] = useState("");
  const [proofImage, setProofImage] = useState<File | null>(null);

  useEffect(() => {
    if (!open) {
      setComment("");
      setProof("");
      setProofImage(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    await onSubmit(comment, proof, proofImage);
  };
  const isDirect = mode === "direct";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isDirect ? "Cancel lead" : "Request cancellation"}</DialogTitle>
          <DialogDescription>
            {isDirect
              ? "Add the cancellation reason before this lead is marked cancelled."
              : `This lead will move to Cancellation Pending first. ${requesterLabel} can approve or reject it after checking your comment and proof.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cancel-comment">Cancellation reason *</Label>
            <Textarea
              id="cancel-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Explain why this lead should be cancelled..."
              rows={4}
              autoFocus
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
            <Label htmlFor="cancel-proof">Proof / reference / link</Label>
            <Input
              id="cancel-proof"
              value={proof}
              onChange={(event) => setProof(event.target.value)}
              placeholder="Paste proof, note, screenshot link, or reference..."
            />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cancel-proof-image">Upload image</Label>
              <Input
                id="cancel-proof-image"
                type="file"
                accept="image/*"
                onChange={(event) => setProofImage(event.target.files?.[0] ?? null)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Back
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !comment.trim()}>
            {loading ? "Saving..." : isDirect ? "Cancel lead" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
