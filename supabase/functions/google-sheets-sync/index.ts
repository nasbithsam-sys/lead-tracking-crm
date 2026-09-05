import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey =
      Deno.env.get("SB_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase environment not configured." }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const { action } = body;

    // Get stored config
    if (action === "get_config") {
      const { data } = await adminClient
        .from("quo_ai_settings")
        .select("value")
        .eq("key", "google_sheets_sync_config")
        .maybeSingle();

      return jsonResponse({
        success: true,
        config: data?.value ?? {
          webhookUrl: "https://script.google.com/macros/s/AKfycbzRAUa3Ea5mCEP_cXjf1IFuTmK4jglnIHO_sUz8zR1RIpFL-DulMMtABu6AAuMUbS1y/exec",
          autoSync: true,
          spreadsheetUrl: "https://docs.google.com/spreadsheets/d/1zGnzG0ovA2ICiUNoOVgVjleVt0CDeN1yCfHEx83ucxs/edit?gid=0#gid=0",
        },
      });
    }

    // Save config
    if (action === "save_config") {
      const { config } = body;
      const { error } = await adminClient
        .from("quo_ai_settings")
        .upsert(
          {
            key: "google_sheets_sync_config",
            value: config,
            description: "Google Sheets Live Webhook Sync configuration",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );

      if (error) {
        return jsonResponse({ error: error.message }, 400);
      }
      return jsonResponse({ success: true, message: "Configuration saved." });
    }

    // Proxy actions to Google Apps Script Webhook
    // If webhookUrl is not passed in request body, fetch from database settings
    let targetWebhookUrl = body.webhookUrl;
    if (!targetWebhookUrl) {
      const { data } = await adminClient
        .from("quo_ai_settings")
        .select("value")
        .eq("key", "google_sheets_sync_config")
        .maybeSingle();

      targetWebhookUrl = data?.value?.webhookUrl;
    }

    if (!targetWebhookUrl) {
      return jsonResponse(
        {
          error:
            "Google Sheets Webhook URL is not configured. Please paste your Web App URL in Settings > Google Sheets.",
        },
        400
      );
    }

    // Forward request to Google Apps Script Web App
    // Note: redirect: 'follow' is mandatory because Google Apps Script responds with 302
    const forwardPayload = {
      action: action || "sync_all",
      leads: body.leads,
      lead: body.lead,
      lead_id: body.lead_id,
      previousStatus: body.previousStatus,
      previousTag: body.previousTag,
    };

    const googleRes = await fetch(targetWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forwardPayload),
      redirect: "follow",
    });

    const textOutput = await googleRes.text();
    let parsedOutput: Record<string, unknown>;

    try {
      parsedOutput = JSON.parse(textOutput);
    } catch {
      parsedOutput = {
        success: googleRes.ok,
        rawResponse: textOutput.substring(0, 500),
      };
    }

    return jsonResponse({
      ...parsedOutput,
      httpStatus: googleRes.status,
    });
  } catch (err: unknown) {
    console.error("google-sheets-sync error:", err);
    return jsonResponse(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
});
