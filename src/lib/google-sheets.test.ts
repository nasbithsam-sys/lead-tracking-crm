import { describe, it, expect } from "vitest";
import { formatLeadForGoogleSheet, type GoogleSheetLeadRow } from "./google-sheets";
import type { Lead } from "@/types";

describe("formatLeadForGoogleSheet", () => {
  const mockLead: Lead = {
    id: "lead-123",
    job_id: "JOB-9999",
    customer_name: "John Doe",
    customer_phone: "3055550123",
    customer_email: "john@example.com",
    address: "123 Main St",
    city: "Miami",
    state: "FL",
    zip_code: "33101",
    service_type: "HVAC Repair",
    service_details: "AC blowing warm air",
    number_name: "Main Marketing Line",
    customer_schedule_requirements: "Available after 3 PM on weekdays",
    status: "waiting_customer_response",
    cs_tag: "booked",
    cs_notes: "Customer contacted via SMS",
    processor_notes: "Part ordered",
    general_notes: "Gate code #4412",
    tech_name: "Alex Smith",
    tech_number: "3055559876",
    created_at: "2026-09-05T10:00:00Z",
    updated_at: "2026-09-05T12:00:00Z",
    created_by: "user-1",
    assigned_cs: null,
    last_edited_by: null,
    last_edited_at: null,
    scheduled_date: null,
    scheduled_time_start: null,
    scheduled_time_end: null,
    amount: 250,
    payment_amount: null,
    payment_screenshot_url: null,
    quote: "250",
    reference_name: null,
    terms: null,
    direction: null,
    labor_amount: null,
    material_amount: null,
    for_you_amount: null,
    for_us_amount: null,
  };

  it("should format all 16 required columns in exact required order", () => {
    const formatted: GoogleSheetLeadRow = formatLeadForGoogleSheet(
      mockLead,
      {
        cs: "[10:15 AM] Sarah: CS Note update",
        processor: "[10:30 AM] Mike: Parts ready",
        opr: "[10:45 AM] Dave: Dispatched tech",
      },
      ["https://supabase.co/storage/v1/object/public/lead-photos/photo1.jpg"]
    );

    // Verify all 16 keys exist
    expect(formatted["Lead Id"]).toBe("JOB-9999");
    expect(formatted["Customer Name"]).toBe("John Doe");
    expect(formatted["Customer phone no"]).toBe("(305) 555-0123");
    expect(formatted["Customer Address"]).toBe("123 Main St, Miami, FL, 33101");
    expect(formatted["Service Type"]).toBe("HVAC Repair");
    expect(formatted["Service Details"]).toBe("AC blowing warm air");
    expect(formatted["Number Name"]).toBe("Main Marketing Line");
    expect(formatted["Secaual requirenments"]).toBe("Available after 3 PM on weekdays");
    expect(formatted["Picture"]).toBe("https://supabase.co/storage/v1/object/public/lead-photos/photo1.jpg");
    expect(formatted["Tag"]).toBe("Booked");
    expect(formatted["Status"]).toBe("Waiting Customer Response");
    expect(formatted["Cs Ndes"]).toBe("[10:15 AM] Sarah: CS Note update");
    expect(formatted["Processor Nodes"]).toBe("[10:30 AM] Mike: Parts ready");
    expect(formatted["OPR Nodes"]).toBe("[10:45 AM] Dave: Dispatched tech");
    expect(formatted["Tech Name"]).toBe("Alex Smith");
    expect(formatted["Tech Number"]).toBe("(305) 555-9876");
  });

  it("should fall back to lead.id if job_id is empty", () => {
    const leadWithoutJobId = { ...mockLead, job_id: "" };
    const formatted = formatLeadForGoogleSheet(leadWithoutJobId);
    expect(formatted["Lead Id"]).toBe("lead-123");
  });

  it("should handle empty optional fields gracefully", () => {
    const minimalLead = {
      ...mockLead,
      cs_tag: null,
      cs_notes: null,
      processor_notes: null,
      general_notes: null,
      tech_name: null,
      tech_number: null,
      number_name: null,
      service_details: null,
      customer_schedule_requirements: null,
    };
    const formatted = formatLeadForGoogleSheet(minimalLead);
    expect(formatted["Tag"]).toBe("");
    expect(formatted["Cs Ndes"]).toBe("");
    expect(formatted["Processor Nodes"]).toBe("");
    expect(formatted["OPR Nodes"]).toBe("");
    expect(formatted["Tech Name"]).toBe("");
    expect(formatted["Tech Number"]).toBe("");
  });
});
