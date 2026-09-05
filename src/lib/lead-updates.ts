import { supabase } from "@/integrations/supabase/client";

type LeadUpdatePayload = Record<string, unknown>;

const NO_ROW_UPDATED_MESSAGE = "Lead update was not applied. Check your permissions and refresh the page.";

export async function updateLeadById(leadId: string, changes: LeadUpdatePayload) {
  const { data, error } = await supabase
    .from("leads")
    .update(changes as never)
    .eq("id", leadId)
    .select("*")
    .single();

  if (error) throw error;
  if (!data) throw new Error(NO_ROW_UPDATED_MESSAGE);

  try {
    const { syncLeadUpsertToGoogleSheets } = await import("@/lib/google-sheets");
    void syncLeadUpsertToGoogleSheets(data as never).catch((err) => {
      console.warn("Google Sheets update sync failed:", err);
    });
  } catch {
    // ignore
  }

  return data;
}
