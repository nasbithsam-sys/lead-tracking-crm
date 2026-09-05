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
            if (leadId) {
              void syncLeadDeleteToGoogleSheets(leadId).catch((err) => {
                console.warn("Failed to sync lead deletion to Google Sheet:", err);
              });
            }
            return;
          }

          if (eventType === "INSERT" || eventType === "UPDATE") {
            const newRow = payload.new as Lead | undefined;
            const oldRow = payload.old as Partial<Lead> | undefined;

            if (!newRow?.id) return;

            // Debounce rapid changes to the same lead by 1.5 seconds
            const existingTimer = pendingSyncsRef.current.get(newRow.id);
            if (existingTimer) {
              clearTimeout(existingTimer);
            }

            const timer = setTimeout(() => {
              pendingSyncsRef.current.delete(newRow.id);
              void syncLeadUpsertToGoogleSheets(
                newRow,
                oldRow?.status,
                oldRow?.cs_tag
              ).catch((err) => {
                console.warn("Failed to sync lead upsert to Google Sheet:", err);
              });
            }, 1500);

            pendingSyncsRef.current.set(newRow.id, timer);
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
