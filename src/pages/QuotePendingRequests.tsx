import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FileWarning, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import LeadCard from "@/components/leads/LeadCard";
import type { Lead } from "@/types";
import { motion } from "framer-motion";
import { cardGridContainer, cardGridItem, premiumEase } from "@/lib/motion";
import { Skeleton } from "@/components/ui/skeleton";

export default function QuotePendingRequests() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  const {
    data: leads = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["quote-pending-leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("status", "pending_to_send")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching quote pending leads:", error);
        return [];
      }
      return data as Lead[];
    },
    refetchInterval: 15000,
  });

  const filteredLeads = useMemo(() => {
    let result = leads;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          (l.customer_name && l.customer_name.toLowerCase().includes(q)) ||
          (l.customer_phone && l.customer_phone.includes(q)) ||
          (l.job_id && l.job_id.toLowerCase().includes(q))
      );
    }
    return result;
  }, [leads, search]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: premiumEase }}
        className="overflow-hidden rounded-[30px] border border-border/60 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_26%),linear-gradient(180deg,hsl(var(--card)),hsl(var(--muted)/0.18))] shadow-[0_26px_70px_-40px_rgba(0,0,0,0.48)]"
      >
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-500">
                <FileWarning className="h-3.5 w-3.5" />
                Quote Requests
              </div>
              <h1 className="text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-3xl">
                Pending to Send
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                These leads are waiting for a quote to be processed and sent.
              </p>
            </div>
            
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  placeholder="Search leads..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 sm:w-[240px] rounded-[16px] bg-background/60 shadow-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-[340px] rounded-2xl" />
          ))}
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-[30px] border border-dashed border-border/60 bg-card/50">
          <FileWarning className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">No pending quote requests</p>
        </div>
      ) : (
        <motion.div
          variants={cardGridContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {filteredLeads.map((lead) => (
            <motion.div key={lead.id} variants={cardGridItem} className="relative">
              {/* Blinking border effect */}
              <div className="absolute -inset-0.5 z-0 animate-pulse rounded-[24px] bg-amber-500/40 blur-[4px]"></div>
              <div className="relative z-10 h-full">
                <LeadCard lead={lead} refreshLeads={refetch} />
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
