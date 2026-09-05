import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncLeadUpsertToGoogleSheets, syncLeadDeleteToGoogleSheets, getGoogleSheetsConfig } from "@/lib/google-sheets";
import type { Lead } from "@/types";

/**
 * Hook to automatically synchronize lead changes in Supabase with Google Sheets in real-time.
 */
export function useGoogleSheetsSync() {
  const isEnabledRef = useRef(true);
  const pendingSyncsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    let isMounted = true;

    // Check if autoSync is enabled
    void getGoogleSheetsConfig().then((config) => {
      if (isMounted) {
        isEnabledRef.current = Boolean(config.autoSync && config.webhookUrl);
      }
    });

    const channel = supabase
      .channel("google-sheets-lead-sync")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
        },
        (payload) => {
          if (!isEnabledRef.current) return;

          const eventType = payload.eventType;

          if (eventType === "DELETE") {
            const oldRow = payload.old as Partial<Lead> | undefined;
            const leadId = oldRow?.id;
            const jobId = (oldRow as { job_id?: string } | undefined)?.job_id;
            if (leadId) {
              void syncLeadDeleteToGoogleSheets(leadId, jobId).catch((err) => {
                console.warn("Failed to sync lead deletion to Google Sheet:", err);
              });
            }
            return;
          }

          if (eventType === "INSERT" || eventType === "UPDATE") {
            const rawLead = payload.new as Lead | undefined;
            const leadId = rawLead?.id;
            if (!leadId) return;

            const oldRow = payload.old as Partial<Lead> | undefined;

            // Debounce rapid changes to the same lead by 1.2 seconds
            const existingTimer = pendingSyncsRef.current.get(leadId);
            if (existingTimer) {
              clearTimeout(existingTimer);
            }

            const timer = setTimeout(async () => {
              pendingSyncsRef.current.delete(leadId);
              try {
                // Fetch fresh complete lead record so all columns and joins are complete
                const { data: freshLead } = await supabase
                  .from("leads")
                  .select("*")
                  .eq("id", leadId)
                  .maybeSingle();

                const leadToSync = (freshLead as Lead) || rawLead;
                if (leadToSync) {
                  await syncLeadUpsertToGoogleSheets(
                    leadToSync,
                    oldRow?.status,
                    oldRow?.cs_tag
                  );
                }
              } catch (err) {
                console.warn("Failed to sync lead upsert to Google Sheet:", err);
              }
            }, 1200);

            pendingSyncsRef.current.set(leadId, timer);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      // Clear any pending timers
      pendingSyncsRef.current.forEach((timer) => clearTimeout(timer));
      pendingSyncsRef.current.clear();
      void supabase.removeChannel(channel);
    };
  }, []);
}
