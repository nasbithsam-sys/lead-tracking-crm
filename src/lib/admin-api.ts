import { supabase } from '@/integrations/supabase/client';

async function callAdminFunction(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body,
  });

  if (error) {
    // supabase-js FunctionsHttpError attaches the raw Response on error.context.
    // Read it so we surface the real backend error instead of "non-2xx status code".
    let backendMessage: string | null = null;
    const ctx = (error as unknown as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const parsed = await ctx.clone().json();
        backendMessage = parsed?.error || parsed?.message || null;
      } catch {
        try {
          backendMessage = await ctx.clone().text();
        } catch {
          backendMessage = null;
        }
      }
    }

    const msg = backendMessage || error.message || '';
    console.error('admin-users function error:', msg, error);

    if (msg.includes('NOT_FOUND') || msg.includes('not found') || msg.includes('Failed to fetch')) {
      throw new Error('Admin backend is not deployed. Please redeploy the edge function from Supabase dashboard.');
    }
    if (msg.includes('Unauthorized') || msg.includes('401')) {
      throw new Error('Session expired. Please log out and log back in.');
    }
    if (msg.includes('Admin access required') || msg.includes('403')) {
      throw new Error('You do not have admin permissions.');
    }
    throw new Error(msg || 'Admin action failed');
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

export const adminApi = {
  ping: () => callAdminFunction({ action: 'ping' }),

  createUser: (email: string, password: string, full_name: string, role: string, access_code?: string) =>
    callAdminFunction({ action: 'create_user', email, password, full_name, role, access_code }),

  setPassword: (user_id: string, password: string) =>
    callAdminFunction({ action: 'set_password', user_id, password }),

  deleteUser: (user_id: string) =>
    callAdminFunction({ action: 'delete_user', user_id }),

  deleteLead: async (lead_id: string, job_id?: string) => {
    let resolvedJobId = job_id;
    if (!resolvedJobId) {
      try {
        const { data } = await supabase
          .from('leads')
          .select('job_id')
          .eq('id', lead_id)
          .maybeSingle();
        if (data?.job_id) {
          resolvedJobId = data.job_id;
        }
      } catch {
        // ignore
      }
    }

    const res = await callAdminFunction({ action: 'delete_lead', lead_id });
    try {
      const { syncLeadDeleteToGoogleSheets } = await import('@/lib/google-sheets');
      void syncLeadDeleteToGoogleSheets(lead_id, resolvedJobId).catch((err) => {
        console.warn('Google Sheets delete sync failed:', err);
      });
    } catch {
      // ignore
    }
    return res;
  },
};
