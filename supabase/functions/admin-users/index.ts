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

function getErrorMessage(error: unknown) {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    return String(
      candidate.message ??
        candidate.error_description ??
        candidate.error ??
        candidate.msg ??
        JSON.stringify(candidate),
    );
  }
  return String(error);
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
      console.error("Missing env: SUPABASE_URL and service role key");
      return jsonResponse({ error: "Server configuration missing. Set SB_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY in Supabase secrets." }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const { action } = body;

    if (action === "ping") {
      return jsonResponse({ success: true, message: "pong" });
    }

    if (action === "verify_access_code") {
      const { email, password, code } = body;

      if (!code) {
        return jsonResponse({ error: "Code is required" }, 400);
      }

      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!anonKey) {
        return jsonResponse({ error: "Server configuration missing" }, 500);
      }

      const verifyAndRotateCode = async (userId: string) => {
        const { data: codeData } = await adminClient
          .from("user_access_codes")
          .select("code")
          .eq("user_id", userId)
          .single();

        if (!codeData || codeData.code !== code) {
          return { ok: false as const };
        }

        const arr = new Uint32Array(1);
        crypto.getRandomValues(arr);
        const newCode = String(100000 + (arr[0] % 900000));

        await adminClient.from("user_access_codes").update({ code: newCode }).eq("user_id", userId);

        return { ok: true as const };
      };

      if (email && password) {
        const anonClient = createClient(supabaseUrl, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError || !signInData.user) {
          return jsonResponse({ error: "Invalid credentials" }, 401);
        }

        const userId = signInData.user.id;
        const result = await verifyAndRotateCode(userId);

        if (!result.ok) {
          await anonClient.auth.signOut();
          return jsonResponse({ error: "Invalid access code" }, 403);
        }

        return jsonResponse({
          success: true,
          session: {
            access_token: signInData.session?.access_token,
            refresh_token: signInData.session?.refresh_token,
          },
        });
      }

      const authHeaderForVerify = req.headers.get("Authorization");
      if (!authHeaderForVerify?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Unauthorized - no token provided" }, 401);
      }

      const tokenForVerify = authHeaderForVerify.replace("Bearer ", "");

      const {
        data: { user: callerUserForVerify },
        error: userErrorForVerify,
      } = await adminClient.auth.getUser(tokenForVerify);

      if (userErrorForVerify || !callerUserForVerify) {
        console.error("Auth verification failed (verify_access_code):", userErrorForVerify?.message);
        return jsonResponse({ error: "Unauthorized - invalid token" }, 401);
      }

      const verifyResult = await verifyAndRotateCode(callerUserForVerify.id);
      if (!verifyResult.ok) {
        return jsonResponse({ error: "Invalid access code" }, 403);
      }

      return jsonResponse({ success: true });
    }

    if (action === "check_access_code") {
      // Require authentication - extract user_id from JWT instead of request body
      const authHeaderForCheck = req.headers.get("Authorization");
      if (!authHeaderForCheck?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const tokenForCheck = authHeaderForCheck.replace("Bearer ", "");
      const { data: { user: checkUser }, error: checkUserError } = await adminClient.auth.getUser(tokenForCheck);
      if (checkUserError || !checkUser) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const checkUserId = checkUser.id;

      const { data: roleData } = await adminClient.from("user_roles").select("role").eq("user_id", checkUserId).single();

      if (roleData?.role === "admin") {
        return jsonResponse({ requires_code: false });
      }

      const { data: codeData } = await adminClient
        .from("user_access_codes")
        .select("id")
        .eq("user_id", checkUserId)
        .single();

      return jsonResponse({ requires_code: !!codeData });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized - no token provided" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user: callerUser },
      error: userError,
    } = await adminClient.auth.getUser(token);

    if (userError || !callerUser) {
      console.error("Auth verification failed:", userError?.message);
      return jsonResponse({ error: "Unauthorized - invalid token" }, 401);
    }

    const callerId = callerUser.id;

    const { data: roleData } = await adminClient.from("user_roles").select("role").eq("user_id", callerId).single();

    if (roleData?.role !== "admin") {
      return jsonResponse({ error: "Admin access required" }, 403);
    }

    if (action === "create_user") {
      const { email, password, full_name, role, access_code } = body;

      const VALID_ROLES = ["admin", "processor", "customer_service", "opr", "cs_admin"] as const;
      if (!role || !VALID_ROLES.includes(role)) {
        return jsonResponse(
          {
            error:
              "A valid role is required. Choose Admin, Processor, Customer Service, CS Admin, or OPR.",
          },
          400,
        );
      }

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });

      if (createError) {
        console.error("Create user error:", createError.message);
        return jsonResponse({ error: createError.message }, 400);
      }

      const userId = newUser.user.id;

      // Provision the profile + role together. If any of the required rows
      // cannot be created we roll back the newly-created auth account so we
      // never leave a half-provisioned user that could sign in without a role.
      const rollback = async (reason: string) => {
        console.error("Rolling back new auth user after create_user failure:", reason);
        await adminClient.from("user_access_codes").delete().eq("user_id", userId);
        await adminClient.from("user_roles").delete().eq("user_id", userId);
        await adminClient.from("profiles").delete().eq("id", userId);
        try {
          await adminClient.auth.admin.deleteUser(userId);
        } catch (err) {
          console.error("Rollback deleteUser failed:", getErrorMessage(err));
        }
      };

      // Use upsert because an Auth trigger (handle_new_user) may have already
      // inserted the profile row for this user id.
      const { error: profileError } = await adminClient
        .from("profiles")
        .upsert({ id: userId, full_name, email }, { onConflict: "id" });
      if (profileError) {
        await rollback(profileError.message);
        return jsonResponse({ error: "Failed to create profile: " + profileError.message }, 400);
      }

      const { error: roleError } = await adminClient
        .from("user_roles")
        .upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
      if (roleError) {
        await rollback(roleError.message);
        return jsonResponse({ error: "Failed to assign role: " + roleError.message }, 400);
      }

      if (role !== "admin" && access_code) {
        const { error: codeError } = await adminClient
          .from("user_access_codes")
          .insert({ user_id: userId, code: access_code });
        if (codeError) {
          await rollback(codeError.message);
          return jsonResponse(
            { error: "Failed to save access code: " + codeError.message },
            400,
          );
        }
      }

      return jsonResponse({ success: true, user_id: userId });
    }

    if (action === "set_password") {
      const { user_id, password } = body;

      const { error } = await adminClient.auth.admin.updateUserById(user_id, {
        password,
      });

      if (error) {
        return jsonResponse({ error: error.message }, 400);
      }

      return jsonResponse({ success: true });
    }

    if (action === "delete_user") {
      const { user_id } = body;

      if (!user_id) {
        return jsonResponse({ error: "user_id is required" }, 400);
      }

      if (user_id === callerId) {
        return jsonResponse({ error: "You cannot delete your own account while signed in." }, 400);
      }

      const { data: profileBeforeDelete } = await adminClient
        .from("profiles")
        .select("full_name, email")
        .eq("id", user_id)
        .maybeSingle();

      const deletedName = String(profileBeforeDelete?.full_name || profileBeforeDelete?.email || "Deleted user")
        .replace(/\s*\(deleted\)$/i, "")
        .trim();

      const displayName = `${deletedName || "Deleted user"} (deleted)`;

      const preDeleteCleanupResults = await Promise.all([
        adminClient.from("leads").update({ created_by_name: displayName }).eq("created_by", user_id).is("created_by_name", null),
        adminClient.from("leads").update({ last_edited_by_name: displayName }).eq("last_edited_by", user_id).is("last_edited_by_name", null),
        adminClient.from("lead_notes").update({ user_name: displayName }).eq("user_id", user_id).is("user_name", null),
        adminClient.from("lead_updates").update({ author_name: displayName }).eq("author_id", user_id),
        adminClient.from("activity_logs").update({ user_name: displayName }).eq("user_id", user_id),
        adminClient.from("lead_photos").update({ uploaded_by_name: displayName }).eq("uploaded_by", user_id).is("uploaded_by_name", null),
        adminClient.from("lead_payments").update({ created_by_name: displayName }).eq("created_by", user_id).is("created_by_name", null),
        adminClient.from("lead_payment_requests").update({ requested_by_name: displayName }).eq("requested_by", user_id).is("requested_by_name", null),
        adminClient.from("lead_payment_requests").update({ reviewed_by_name: displayName }).eq("reviewed_by", user_id).is("reviewed_by_name", null),
        adminClient.from("lead_cancellation_requests").update({ requested_by_name: displayName }).eq("requested_by", user_id).is("requested_by_name", null),
        adminClient.from("lead_cancellation_requests").update({ reviewed_by_name: displayName }).eq("reviewed_by", user_id).is("reviewed_by_name", null),
        adminClient.from("user_roles").delete().eq("user_id", user_id),
        adminClient.from("navigation_permissions").delete().eq("user_id", user_id),
        adminClient.from("status_permissions").delete().eq("user_id", user_id),
        adminClient.from("notifications").delete().eq("user_id", user_id),
        adminClient.from("user_access_codes").delete().eq("user_id", user_id),
        adminClient.from("lead_shares").delete().or(`shared_with_user_id.eq.${user_id},shared_by.eq.${user_id}`),
      ]);

      const preDeleteCleanupError = preDeleteCleanupResults.find((result) => result.error)?.error;
      if (preDeleteCleanupError) {
        return jsonResponse({ error: preDeleteCleanupError.message }, 400);
      }

      // Hard-delete the auth account. Database constraints clear user links and the
      // delete trigger preserves display-name snapshots on historical CRM rows.
      const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(user_id);

      const authDeleteMessage = getErrorMessage(authDeleteError);

      if (authDeleteError && !authDeleteMessage.toLowerCase().includes("user not found")) {
        console.error("auth.admin.deleteUser failed:", authDeleteMessage);
        return jsonResponse(
          {
            error:
              "The auth account could not be deleted: " +
              authDeleteMessage,
          },
          400,
        );
      }

      // Keep CRM history intact. Only remove permission/access records that should not
      // remain active for a deleted user. If the auth user was already gone, also remove
      // any leftover CRM profile so the user no longer exists in CRM user lists.
      const cleanupTables = [
        "user_roles",
        "navigation_permissions",
        "status_permissions",
        "notifications",
        "user_access_codes",
        "profiles",
      ];

      const cleanupResults = await Promise.all([
        adminClient.from("user_roles").delete().eq("user_id", user_id),
        adminClient.from("navigation_permissions").delete().eq("user_id", user_id),
        adminClient.from("status_permissions").delete().eq("user_id", user_id),
        adminClient.from("notifications").delete().eq("user_id", user_id),
        adminClient.from("user_access_codes").delete().eq("user_id", user_id),
        adminClient.from("profiles").delete().eq("id", user_id),
      ]);

      const cleanupErrors = cleanupResults
        .map((r, i) => (r.error ? `${cleanupTables[i]}: ${r.error.message}` : null))
        .filter(Boolean);

      if (cleanupErrors.length > 0) {
        console.warn("Cleanup warnings after deleteUser (normal if cascade deleted):", cleanupErrors);
        // Do not fail the request here since the auth account is successfully deleted.
      }

      return jsonResponse({ success: true });
    }

    if (action === "delete_lead") {
      const { lead_id } = body;

      await Promise.all([
        adminClient.from("lead_notes").delete().eq("lead_id", lead_id),
        adminClient.from("lead_photos").delete().eq("lead_id", lead_id),
        adminClient.from("lead_shares").delete().eq("lead_id", lead_id),
        adminClient.from("lead_updates").delete().eq("lead_id", lead_id),
        adminClient.from("notifications").delete().eq("lead_id", lead_id),
        adminClient.from("lead_payments").delete().eq("lead_id", lead_id),
      ]);

      const { error } = await adminClient.from("leads").delete().eq("id", lead_id);

      if (error) {
        return jsonResponse({ error: error.message }, 400);
      }

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Unknown action: " + action }, 400);
  } catch (err) {
    console.error("Edge function error:", err);
    return jsonResponse({ error: "An internal error occurred" }, 500);
  }
});
