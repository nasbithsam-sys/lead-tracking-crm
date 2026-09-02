import { useState, useEffect } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import StatusBadge from "./StatusBadge";
import { LeadStatus } from "@/lib/constants";
import { Loader2 } from "lucide-react";

interface StatusHistoryLog {
  id: string;
  user_name: string;
  action: string;
  created_at: string;
  details: {
    status_from?: string;
    status_to?: string;
  } | null;
}

interface Props {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStatus: string;
}

export default function LeadStatusHistoryDialog({ leadId, open, onOpenChange, currentStatus }: Props) {
  const [history, setHistory] = useState<StatusHistoryLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && leadId) {
      void fetchHistory();
    }
  }, [open, leadId]);

  const fetchHistory = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("activity_logs")
      .select("id, user_name, action, created_at, details")
      .eq("target_type", "lead")
      .eq("target_id", leadId)
      .in("action", ["created", "status_changed", "status_change"])
      .order("created_at", { ascending: true });

    if (!error && data) {
      setHistory(data as unknown as StatusHistoryLog[]);
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Status History</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No status history available.
            </div>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:-bottom-2 before:w-[2px] before:bg-border/60">
              {history.map((log, i) => {
                const isCreation = log.action === "created";
                const date = new Date(log.created_at);
                
                let parsedDetails: any = null;
                if (typeof log.details === "string") {
                  try {
                    parsedDetails = JSON.parse(log.details);
                  } catch (e) {}
                } else {
                  parsedDetails = log.details;
                }

                const hasValidStatus = !isCreation && parsedDetails?.status_to;

                return (
                  <div key={log.id} className="relative flex flex-col gap-1 text-sm">
                    {/* Timeline Dot */}
                    <div className="absolute -left-6 top-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary ring-1 ring-border shadow-sm" />

                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      {format(date, "MMM d, yyyy 'at' h:mm a")}
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-x-2 mt-1">
                      <span className="font-medium text-foreground">
                        {log.user_name}
                      </span>
                      <span className="text-muted-foreground">
                        {isCreation ? "created the lead" : "changed status to"}
                      </span>
                    </div>

                    {hasValidStatus && (
                      <div className="mt-1.5">
                        <StatusBadge status={parsedDetails.status_to as LeadStatus} size="sm" />
                      </div>
                    )}
                    {isCreation && i === 0 && (
                       <div className="mt-1.5 opacity-80">
                         {parsedDetails?.status_to ? (
                           <StatusBadge status={parsedDetails.status_to as LeadStatus} size="sm" />
                         ) : history.length === 1 ? (
                           <StatusBadge status={currentStatus as LeadStatus} size="sm" />
                         ) : null}
                       </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}