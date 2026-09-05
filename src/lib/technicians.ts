import { supabase } from "@/integrations/supabase/client";
import type { TechnicianRecord } from "@/components/technicians/TechnicianDialog";

export const TECHNICIAN_SELECT =
  "id, name, area, service, notes, chat_link, phone_number, latitude, longitude";

const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // hard safety cap = 50,000 rows

export async function fetchAllTechnicians(): Promise<TechnicianRecord[]> {
  const byId = new Map<string, TechnicianRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("technicians")
      .select(TECHNICIAN_SELECT)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as TechnicianRecord[];
    for (const r of rows) if (r?.id) byId.set(r.id, r);
    if (rows.length < PAGE_SIZE) break;
  }
  return Array.from(byId.values()).sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
  );
}

// Shared React Query key for the full technician dataset (used by Map View).
export const TECHNICIANS_QUERY_KEY = ["technicians", "all"] as const;
// Root key covering every technician-related query (paginated, count, all).
export const TECHNICIANS_ROOT_KEY = ["technicians"] as const;

export function upsertTechnicianInList(
  list: TechnicianRecord[] | undefined,
  tech: TechnicianRecord,
): TechnicianRecord[] {
  const base = list ? list.filter((t) => t.id !== tech.id) : [];
  base.push(tech);
  return base.sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
  );
}

export interface PaginatedTechnicians {
  technicians: TechnicianRecord[];
  totalCount: number;
}

/**
 * Database-backed paginated technician fetch. When a search string is
 * provided, delegates to the `search_technicians` RPC so digit-only phone
 * searches match formatted phone numbers.
 */
export async function fetchTechniciansPage(params: {
  page: number;
  pageSize: number;
  search: string;
}): Promise<PaginatedTechnicians> {
  const page = Math.max(1, params.page | 0);
  const pageSize = Math.max(1, params.pageSize | 0);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const search = (params.search ?? "").trim();

  if (search) {
    const { data, error } = await supabase.rpc("search_technicians", {
      _q: search,
      _limit: pageSize,
      _offset: from,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<TechnicianRecord & { total_count: number | string | null }>;
    const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
    const technicians: TechnicianRecord[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      area: r.area,
      service: r.service,
      notes: r.notes,
      chat_link: r.chat_link,
      phone_number: r.phone_number,
      latitude: r.latitude,
      longitude: r.longitude,
    }));
    return { technicians, totalCount };
  }

  const { data, error, count } = await supabase
    .from("technicians")
    .select(TECHNICIAN_SELECT, { count: "exact" })
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to);
  if (error) throw error;
  return {
    technicians: (data ?? []) as TechnicianRecord[],
    totalCount: count ?? 0,
  };
}
