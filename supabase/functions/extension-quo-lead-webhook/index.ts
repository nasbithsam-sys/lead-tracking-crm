import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_ALLOWED_HEADERS = "Content-Type, x-webhook-token";
const DUPLICATE_WINDOW_MINUTES = 30;
const WEBHOOK_SOURCE = "quo_extension";
const WEBHOOK_REFERENCE = "Quo/OpenPhone Extension";

const jsonHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin ?? "*",
  "Access-Control-Allow-Headers": DEFAULT_ALLOWED_HEADERS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  Vary: "Origin",
});

type WebhookPayload = {
  source?: string;
  customer_name?: string;
  customer_number?: string;
  customer_address?: string;
  number_name?: string;
  service?: string;
  direction?: string;
  page_url?: string;
  created_at?: string;
  raw_extracted?: Record<string, unknown>;
};

function jsonResponse(body: Record<string, unknown>, status = 200, origin: string | null = "*") {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders(origin),
  });
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const normalizedDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (normalizedDigits.length === 10) {
    return {
      digits: normalizedDigits,
      formatted: `(${normalizedDigits.slice(0, 3)}) ${normalizedDigits.slice(3, 6)}-${normalizedDigits.slice(6)}`,
    };
  }

  return {
    digits: normalizedDigits,
    formatted: value.trim(),
  };
}

function generateJobId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const randomValues = crypto.getRandomValues(new Uint32Array(6));
  let result = "LD-";

  for (const value of randomValues) {
    result += chars[value % chars.length];
  }

  return result;
}

function normalizeDirection(value?: string) {
  if (!value) return "incoming";

  const normalized = value.trim().toLowerCase();
  return normalized === "outgoing" ? "outgoing" : "incoming";
}

function getAllowedOrigin(req: Request) {
  const configuredOrigin = Deno.env.get("EXTENSION_ALLOWED_ORIGIN")?.trim();
  const requestOrigin = req.headers.get("Origin");

  if (!configuredOrigin) {
    return requestOrigin || "*";
  }

  if (!requestOrigin) {
    return configuredOrigin;
  }

  return requestOrigin === configuredOrigin ? requestOrigin : null;
}

Deno.serve(async (req) => {
  const allowedOrigin = getAllowedOrigin(req);

  if (req.method === "OPTIONS") {
    if (!allowedOrigin) {
      return jsonResponse({ success: false, error: "Origin not allowed" }, 403, "null");
    }

    return new Response(null, {
      status: 204,
      headers: jsonHeaders(allowedOrigin),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405, allowedOrigin ?? "*");
  }

  if (!allowedOrigin) {
    return jsonResponse({ success: false, error: "Origin not allowed" }, 403, "null");
  }

  const configuredToken = Deno.env.get("EXTENSION_WEBHOOK_TOKEN");
  const requestToken = req.headers.get("x-webhook-token");

  if (!configuredToken || requestToken !== configuredToken) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401, allowedOrigin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: "Server configuration missing" }, 500, allowedOrigin);
  }

  try {
    const payload = (await req.json()) as WebhookPayload;
    const customerNumber = payload.customer_number?.trim();
    const service = payload.service?.trim();

    if (!customerNumber) {
      return jsonResponse({ success: false, error: "Missing required field: customer_number" }, 400, allowedOrigin);
    }

    if (!service) {
      return jsonResponse({ success: false, error: "Missing required field: service" }, 400, allowedOrigin);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { digits, formatted } = normalizePhone(customerNumber);
    const direction = normalizeDirection(payload.direction);
    const customerName = payload.customer_name?.trim() || "Unknown Customer";
    const recentThreshold = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000).toISOString();

    const { data: duplicateCandidates, error: duplicateError } = await adminClient
      .from("leads")
      .select("id, customer_phone, service_type, created_at")
      .eq("source", WEBHOOK_SOURCE)
      .gte("created_at", recentThreshold)
      .order("created_at", { ascending: false })
      .limit(50);

    if (duplicateError) {
      console.error("Duplicate check failed:", duplicateError.message);
      return jsonResponse({ success: false, error: "Failed to check duplicates" }, 500, allowedOrigin);
    }

    const duplicateLead = duplicateCandidates?.find((lead) => {
      const leadDigits = (lead.customer_phone || "").replace(/\D/g, "");
      return leadDigits === digits && lead.service_type.trim().toLowerCase() === service.toLowerCase();
    });

    if (duplicateLead) {
      return jsonResponse(
        {
          success: true,
          message: "Lead received",
          lead_id: duplicateLead.id,
          duplicate: true,
        },
        200,
        allowedOrigin,
      );
    }

    const { data: adminUser, error: adminUserError } = await adminClient
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();

    if (adminUserError || !adminUser?.user_id) {
      console.error("Unable to resolve admin user for webhook lead creation:", adminUserError?.message);
      return jsonResponse({ success: false, error: "Webhook user is not configured" }, 500, allowedOrigin);
    }

    const rawPayload = {
      ...payload,
      source: WEBHOOK_SOURCE,
      normalized_phone: formatted,
      received_at: new Date().toISOString(),
    };

    const { data: lead, error: insertError } = await adminClient
      .from("leads")
      .insert({
        job_id: generateJobId(),
        customer_name: customerName,
        customer_phone: formatted,
        address: payload.customer_address?.trim() || null,
        number_name: payload.number_name?.trim() || null,
        direction,
        service_type: service,
        status: "waiting_complete_details",
        created_by: adminUser.user_id,
        reference_name: WEBHOOK_REFERENCE,
        source: WEBHOOK_SOURCE,
        source_url: payload.page_url?.trim() || null,
        raw_payload: rawPayload,
        service_details:
          payload.created_at?.trim()
            ? `Imported from Quo/OpenPhone extension on ${payload.created_at.trim()}`
            : "Imported from Quo/OpenPhone extension",
      })
      .select("id")
      .single();

    if (insertError || !lead) {
      console.error("Lead insert failed:", insertError?.message);
      return jsonResponse({ success: false, error: "Failed to create lead" }, 500, allowedOrigin);
    }

    return jsonResponse(
      {
        success: true,
        message: "Lead received",
        lead_id: lead.id,
        duplicate: false,
      },
      200,
      allowedOrigin,
    );
  } catch (error) {
    console.error("Quo extension webhook failed:", error);
    return jsonResponse({ success: false, error: "Invalid JSON payload" }, 400, allowedOrigin ?? "*");
  }
});
