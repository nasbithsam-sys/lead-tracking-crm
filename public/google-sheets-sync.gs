/**
 * ==============================================================================
 * MARSHMALLOW CRM -> GOOGLE SHEETS LIVE SYNC SCRIPT
 * ==============================================================================
 * 
 * SPREADSHEET URL:
 * https://docs.google.com/spreadsheets/d/1zGnzG0ovA2ICiUNoOVgVjleVt0CDeN1yCfHEx83ucxs/edit?gid=0#gid=0
 * 
 * INSTRUCTIONS:
 * 1. Open your Google Sheet.
 * 2. Click Extensions > Apps Script in the top menu.
 * 3. Delete any code currently in Code.gs and PASTE THIS ENTIRE SCRIPT.
 * 4. Click Save (Ctrl+S or Cmd+S).
 * 5. In the top-right, click Deploy > Manage deployments (or Deploy > New deployment).
 *    - Click the Edit (pencil) icon
 *    - In the Version dropdown, choose "New version"
 *    - Click Deploy!
 * ==============================================================================
 */

// 17 headers in exact user-specified order
var HEADERS = [
  "Lead ID",
  "Lead Creation Date",
  "Customer Name",
  "Customer Phone No",
  "Address",
  "Service Type",
  "Service Details",
  "Number Name",
  "Schedule Requirements",
  "Pictures",
  "Tag",
  "Status",
  "Tech Name",
  "Tech Number",
  "Cs Notes",
  "Processor Notes",
  "Opr Notes"
];

// Header background styling
var HEADER_BG_COLOR = "#1E293B"; // Slate 800
var HEADER_FONT_COLOR = "#FFFFFF";

/**
 * Handle GET requests (Health check)
 */
function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    message: "Marshmallow CRM Google Sheets Sync Webhook is active!",
    spreadsheetName: ss.getName(),
    sheets: ss.getSheets().map(function(s) { return s.getName(); }),
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle POST requests from Marshmallow CRM
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = lock.tryLock(30000);
  if (!hasLock) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Server busy, please retry in a few moments."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var rawData = e.postData ? e.postData.contents : null;
    if (!rawData) {
      return jsonResponse({ success: false, error: "Empty request body" });
    }

    var payload = JSON.parse(rawData);
    var action = payload.action || "sync_all";
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "ping") {
      return jsonResponse({
        success: true,
        message: "Connected to Google Sheet successfully",
        spreadsheetName: ss.getName(),
        sheets: ss.getSheets().map(function(s) { return s.getName(); })
      });
    }

    if (action === "sync_all") {
      var leads = payload.leads || [];
      var result = handleSyncAll(ss, leads);
      return jsonResponse({
        success: true,
        action: "sync_all",
        leadsCount: leads.length,
        sheetsCreated: result.sheetsCreated
      });
    }

    if (action === "upsert") {
      var lead = payload.lead;
      var leadId = lead ? (lead["Lead ID"] || lead["Lead Id"]) : null;
      if (!lead || !leadId) {
        return jsonResponse({ success: false, error: "Missing lead data or Lead ID" });
      }
      handleUpsert(ss, lead, payload.previousStatus, payload.previousTag);
      return jsonResponse({ success: true, action: "upsert", leadId: leadId });
    }

    if (action === "delete") {
      var delLeadId = payload.lead_id || (payload.lead && (payload.lead["Lead ID"] || payload.lead["Lead Id"]));
      if (!delLeadId) {
        return jsonResponse({ success: false, error: "Missing lead_id to delete" });
      }
      var deletedFrom = handleDelete(ss, String(delLeadId));
      return jsonResponse({
        success: true,
        action: "delete",
        leadId: delLeadId,
        deletedFromSheets: deletedFrom
      });
    }

    return jsonResponse({ success: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: err.toString(),
      stack: err.stack
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Sync all leads in bulk
 */
function handleSyncAll(ss, leads) {
  // Sort leads newest first (recent leads on top)
  var sortedLeads = leads.slice().sort(function(a, b) {
    var dateA = a._created_at || a.created_at || a["Lead Creation Date"] || 0;
    var dateB = b._created_at || b.created_at || b["Lead Creation Date"] || 0;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  // Clean up any legacy individual tag sub-sheets
  var allExistingSheets = ss.getSheets();
  allExistingSheets.forEach(function(sheet) {
    var name = sheet.getName();
    if (name.indexOf("Tag - ") === 0) {
      try {
        ss.deleteSheet(sheet);
      } catch (e) {}
    }
  });

  var sheetsCreated = [];

  // 1. Master sheet: "All Leads"
  var allLeadsSheet = getOrCreateSheet(ss, "All Leads");
  populateSheet(allLeadsSheet, sortedLeads);
  sheetsCreated.push("All Leads");

  // 2. Sub-sheets for each Status
  var leadsByStatus = {};
  sortedLeads.forEach(function(l) {
    var status = (l["Status"] || "No Status").trim();
    if (!leadsByStatus[status]) leadsByStatus[status] = [];
    leadsByStatus[status].push(l);
  });

  Object.keys(leadsByStatus).forEach(function(statusName) {
    var sanitizedStatusSheetName = sanitizeSheetName(statusName);
    var statusSheet = getOrCreateSheet(ss, sanitizedStatusSheetName);
    populateSheet(statusSheet, leadsByStatus[statusName]);
    sheetsCreated.push(sanitizedStatusSheetName);
  });

  // 3. ONLY ONE sheet for tags: "Tagged Leads"
  var allTaggedLeads = [];
  sortedLeads.forEach(function(l) {
    var tag = (l["Tag"] || "").trim();
    if (tag) {
      allTaggedLeads.push(l);
    }
  });

  var taggedSheet = getOrCreateSheet(ss, "Tagged Leads");
  populateSheet(taggedSheet, allTaggedLeads);
  sheetsCreated.push("Tagged Leads");

  return { sheetsCreated: sheetsCreated };
}

/**
 * Handle upsert (insert or update) for a single lead
 */
function handleUpsert(ss, lead, previousStatus, previousTag) {
  var leadId = String(lead["Lead ID"] || lead["Lead Id"]).trim();
  var rowData = leadToRow(lead);

  // 1. Upsert in "All Leads"
  var allLeadsSheet = getOrCreateSheet(ss, "All Leads");
  upsertRowInSheet(allLeadsSheet, leadId, rowData);

  // 2. Manage Status Sub-sheets
  var currentStatus = (lead["Status"] || "").trim();
  var prevStatus = (previousStatus || "").trim();

  // If status changed, remove lead from old status sheet
  if (prevStatus && prevStatus !== currentStatus) {
    var oldSheetName = sanitizeSheetName(prevStatus);
    var oldSheet = ss.getSheetByName(oldSheetName);
    if (oldSheet) {
      deleteRowById(oldSheet, leadId);
    }
  }

  // Insert/update in current status sheet
  if (currentStatus) {
    var newStatusSheet = getOrCreateSheet(ss, sanitizeSheetName(currentStatus));
    upsertRowInSheet(newStatusSheet, leadId, rowData);
  }

  // 3. Manage ONLY ONE Tag Sub-sheet: "Tagged Leads"
  var currentTag = (lead["Tag"] || "").trim();
  var taggedSheet = getOrCreateSheet(ss, "Tagged Leads");

  if (currentTag) {
    upsertRowInSheet(taggedSheet, leadId, rowData);
  } else {
    deleteRowById(taggedSheet, leadId);
  }
}

/**
 * Handle lead deletion across All Leads and all sub-sheets
 * Automatically shifts rows below up!
 */
function handleDelete(ss, leadId) {
  var targetId = String(leadId).trim();
  var sheets = ss.getSheets();
  var deletedFrom = [];

  sheets.forEach(function(sheet) {
    var wasDeleted = deleteRowById(sheet, targetId);
    if (wasDeleted) {
      deletedFrom.push(sheet.getName());
    }
  });

  return deletedFrom;
}

/**
 * Helper: Find row by Lead ID (Column A) and delete it
 * sheet.deleteRow() automatically moves rows below it up!
 */
function deleteRowById(sheet, leadId) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  var idRange = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < idRange.length; i++) {
    var cellId = String(idRange[i][0]).trim();
    if (cellId === leadId) {
      var rowIndexToDelete = i + 2; // 1-based index including header
      sheet.deleteRow(rowIndexToDelete);
      return true;
    }
  }
  return false;
}

/**
 * Helper: Upsert row in a sheet. If new, inserts at Row 2 (top of list)
 */
function upsertRowInSheet(sheet, leadId, rowData) {
  var lastRow = sheet.getLastRow();
  var foundRow = -1;

  if (lastRow > 1) {
    var idRange = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < idRange.length; i++) {
      if (String(idRange[i][0]).trim() === leadId) {
        foundRow = i + 2;
        break;
      }
    }
  }

  if (foundRow > 0) {
    // Update existing row
    sheet.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    // New lead: Insert at row 2 so recent leads stay on top!
    sheet.insertRowBefore(2);
    sheet.getRange(2, 1, 1, rowData.length).setValues([rowData]);
    sheet.getRange(2, 1, 1, rowData.length)
      .setFontFamily("Arial")
      .setFontSize(10)
      .setVerticalAlignment("middle");
  }
}

/**
 * Fully populate a sheet with headers and data
 */
function populateSheet(sheet, leads) {
  sheet.clear();

  // 1. Set headers
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  // Format header row
  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setBackground(HEADER_BG_COLOR)
    .setFontColor(HEADER_FONT_COLOR)
    .setFontWeight("bold")
    .setFontSize(11)
    .setFontFamily("Arial")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  sheet.setRowHeight(1, 36);
  sheet.setFrozenRows(1); // Freeze row 1

  if (leads.length === 0) {
    autoFitColumns(sheet);
    return;
  }

  // 2. Convert leads to 2D array
  var rows = leads.map(function(lead) {
    return leadToRow(lead);
  });

  // Write all rows in batch
  var dataRange = sheet.getRange(2, 1, rows.length, HEADERS.length);
  dataRange.setValues(rows);

  // Format data cells
  dataRange.setFontFamily("Arial")
    .setFontSize(10)
    .setVerticalAlignment("middle");

  // Format row heights
  for (var r = 2; r <= rows.length + 1; r++) {
    sheet.setRowHeight(r, 28);
  }

  autoFitColumns(sheet);
}

/**
 * Convert lead object to array matching HEADERS order (17 columns)
 */
function leadToRow(lead) {
  return [
    lead["Lead ID"] || lead["Lead Id"] || "",
    lead["Lead Creation Date"] || "",
    lead["Customer Name"] || "",
    lead["Customer Phone No"] || lead["Customer phone no"] || "",
    lead["Address"] || lead["Customer Address"] || "",
    lead["Service Type"] || "",
    lead["Service Details"] || "",
    lead["Number Name"] || "",
    lead["Schedule Requirements"] || lead["Secaual requirenments"] || "",
    lead["Pictures"] || lead["Picture"] || "",
    lead["Tag"] || "",
    lead["Status"] || "",
    lead["Tech Name"] || "",
    lead["Tech Number"] || "",
    lead["Cs Notes"] || lead["Cs Ndes"] || "",
    lead["Processor Notes"] || lead["Processor Nodes"] || "",
    lead["Opr Notes"] || lead["OPR Nodes"] || ""
  ];
}

/**
 * Auto-fit column widths
 */
function autoFitColumns(sheet) {
  for (var col = 1; col <= HEADERS.length; col++) {
    sheet.autoResizeColumn(col);
    var width = sheet.getColumnWidth(col);
    if (width < 120) sheet.setColumnWidth(col, 120);
    if (width > 350) sheet.setColumnWidth(col, 350);
  }
}

/**
 * Get sheet by name or create if it doesn't exist
 */
function getOrCreateSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

/**
 * Sanitize sheet name
 */
function sanitizeSheetName(name) {
  if (!name) return "Sheet";
  var cleaned = name.replace(/[\\/?*\[\]:]/g, " ").trim();
  if (cleaned.length > 90) {
    cleaned = cleaned.substring(0, 90).trim();
  }
  return cleaned || "Sheet";
}

/**
 * JSON response helper
 */
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
