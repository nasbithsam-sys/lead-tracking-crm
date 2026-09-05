import type { AppRole, NavigationPermission, LeadStatus } from "@/types";
import { ALL_LEAD_STATUSES, ALL_NAV_ITEMS, type NavItem } from "@/lib/constants";

const DEFAULT_NAV_ACCESS: Record<AppRole, Set<NavItem>> = {
  admin: new Set(ALL_NAV_ITEMS),
  processor: new Set(["leads", "schedule", "cancellation_requests", "map_view", "technicians"]),
  customer_service: new Set(["leads", "schedule"]),
  opr: new Set(["leads"]),
  cs_admin: new Set(["leads", "schedule"]),
};

export const canAccessCancellationRequests = (role: AppRole | null | undefined) =>
  role === "admin" || role === "processor";

export function getDefaultNavAccess(role: AppRole): Set<NavItem> {
  return new Set(DEFAULT_NAV_ACCESS[role]);
}

export function canAccessNavItem(
  role: AppRole | null | undefined,
  navItem: string,
  permissions: NavigationPermission[] = [],
): boolean {
  if (!role) {
    return false;
  }

  if (!ALL_NAV_ITEMS.includes(navItem as NavItem)) {
    return false;
  }

  if (role === "admin") {
    return true;
  }

  if (navItem === "payment_requests") {
    // Admin-only page
    return false;
  }

  if (navItem === "crm_updates") {
    // Admin-only page
    return false;
  }


  if (navItem === "cancellation_requests" && canAccessCancellationRequests(role)) {
    return true;
  }

  const override = permissions.find((permission) => permission.nav_section === navItem);
  if (override) {
    return override.allowed;
  }

  return getDefaultNavAccess(role).has(navItem as NavItem);
}

const CS_ADMIN_HIDDEN_STATUSES: LeadStatus[] = ["paid", "partial_paid", "cancelled", "job_done"];

export function getDefaultVisibleStatuses(role: AppRole | null | undefined): Set<LeadStatus> {
  if (!role) {
    return new Set();
  }
  if (role === "admin" || role === "processor") {
    return new Set(ALL_LEAD_STATUSES);
  }
  if (role === "opr") {
    // Operators see all statuses except quote_change and scammed by default
    return new Set(ALL_LEAD_STATUSES.filter((s) => s !== "scammed" && s !== "quote_change"));
  }
  // customer_service and cs_admin never see Scammed or Quote Change by default.
  const base = new Set<LeadStatus>(ALL_LEAD_STATUSES.filter((s) => s !== "scammed" && s !== "quote_change"));
  if (role === "cs_admin") {
    for (const s of CS_ADMIN_HIDDEN_STATUSES) base.delete(s);
  }
  return base;
}
