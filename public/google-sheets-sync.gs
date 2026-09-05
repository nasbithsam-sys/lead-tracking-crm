/**
 * ==============================================================================
 * MARSHMALLOW CRM -> GOOGLE SHEETS LIVE SYNC SCRIPT
 * ==============================================================================
 * SPREADSHEET URL:
 * https://docs.google.com/spreadsheets/d/1zGnzG0ovA2ICiUNoOVgVjleVt0CDeN1yCfHEx83ucxs/edit?gid=0#gid=0
 * 
 * DEPLOYMENT INSTRUCTIONS:
 * 1. Open your Google Sheet.
 * 2. In the top menu, click Extensions > Apps Script.
 * 3. Delete all code in the script editor and PASTE THIS ENTIRE FILE.
 * 4. Click the Save icon (Ctrl+S or Cmd+S).
 * 5. In the top-right corner, click Deploy > Manage deployments:
 *    - Click the Edit (pencil) icon next to your active deployment.
 *    - Under "Version", select "New version".
 *    - Click "Deploy".
 *    (CRITICAL: Every time you paste new code, you MUST deploy a "New version"!)
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
 * Handle GET requests (Health check & diagnosis)
 */
function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    message: "Marshmallow CRM Google Sheets Sync Webhook is live and ready!",
    spreadsheetName: ss.getName(),
    sheets: ss.getSheets().map(function(s) { return s.getName(); }),
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle POST requests from Marshmallow CRM (Sync, Upsert, Edit, Delete)
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = lock.tryLock(30000);
  if (!hasLock) {
    return jsonResponse({
      success: false,
      error: "Server busy, please retry in a few moments."
    });
  }

  try {
    var rawData = e.postData ? e.postData.contents : null;
    if (!rawData) {
      return jsonResponse({ success: false, error: "Empty request body" });
    }

    var payload = JSON.parse(rawData);
    var action = payload.action || "sync_all";
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Health check ping
    if (action === "ping") {
      return jsonResponse({
        success: true,
        message: "Connected to Google Sheet successfully",
        spreadsheetName: ss.getName(),
        sheets: ss.getSheets().map(function(s) { return s.getName(); })
      });
    }

    // Full bulk sync
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

    // Upsert (new lead or edit/update existing lead)
    if (action === "upsert") {
      var lead = payload.lead;
      if (!lead) {
        return jsonResponse({ success: false, error: "Missing lead data" });
      }
      var upsertResult = handleUpsert(ss, lead, payload.previousStatus, payload.previousTag);
      return jsonResponse({
        success: true,
        action: "upsert",
        leadId: upsertResult.leadId,
        updatedRow: upsertResult.updatedRow
      });
    }

    // Delete lead (removes row and moves lower rows up)
    if (action === "delete") {
      var delLeadId = payload.lead_id || (payload.lead && (payload.lead["Lead ID"] || payload.lead["Lead Id"]));
      var delJobId = payload.job_id || (payload.lead && (payload.lead._job_id || payload.lead.job_id));
      var delDbId = payload.db_id || (payload.lead && (payload.lead._id || payload.lead.id));

      if (!delLeadId && !delJobId && !delDbId) {
        return jsonResponse({ success: false, error: "Missing lead_id or job_id to delete" });
      }

      var deletedFrom = handleDelete(ss, delLeadId, delJobId, delDbId);
      return jsonResponse({
        success: true,
        action: "delete",
        leadId: delLeadId,
        jobId: delJobId,
        dbId: delDbId,
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
  var leadId = String(lead["Lead ID"] || lead["Lead Id"] || lead["_job_id"] || lead["job_id"] || "").trim();
  var dbId = String(lead["_id"] || lead["id"] || "").trim();
  var jobId = String(lead["_job_id"] || lead["job_id"] || "").trim();
  var rowData = leadToRow(lead);

  // 1. Upsert in "All Leads"
  var allLeadsSheet = getOrCreateSheet(ss, "All Leads");
  var updatedRow = upsertRowInSheet(allLeadsSheet, leadId, rowData, dbId, jobId);

  // 2. Manage Status Sub-sheets
  var currentStatus = (lead["Status"] || "").trim();
  var sanitizedCurrentStatus = sanitizeSheetName(currentStatus);

  // Remove lead from ANY other status sheet where it currently exists
  var allSheets = ss.getSheets();
  allSheets.forEach(function(s) {
    var sName = s.getName();
    if (sName !== "All Leads" && sName !== "Tagged Leads" && sName !== sanitizedCurrentStatus) {
      deleteRowById(s, leadId, dbId, jobId);
    }
  });

  // Upsert into current status sheet
  if (currentStatus) {
    var newStatusSheet = getOrCreateSheet(ss, sanitizedCurrentStatus);
    upsertRowInSheet(newStatusSheet, leadId, rowData, dbId, jobId);
  }

  // 3. Manage ONLY ONE Tag Sub-sheet: "Tagged Leads"
  var currentTag = (lead["Tag"] || "").trim();
  var taggedSheet = getOrCreateSheet(ss, "Tagged Leads");

  if (currentTag) {
    upsertRowInSheet(taggedSheet, leadId, rowData, dbId, jobId);
  } else {
    deleteRowById(taggedSheet, leadId, dbId, jobId);
  }

  return { leadId: leadId || dbId || jobId, updatedRow: updatedRow };
}

/**
 * Handle lead deletion across All Leads and all sub-sheets
 * Automatically shifts rows below up!
 */
function handleDelete(ss, id1, id2, id3) {
  var sheets = ss.getSheets();
  var deletedFrom = [];

  sheets.forEach(function(sheet) {
    var wasDeleted = deleteRowById(sheet, id1, id2, id3);
    if (wasDeleted) {
      deletedFrom.push(sheet.getName());
    }
  });

  return deletedFrom;
}

/**
 * Find row by Lead ID, Job ID, or Database UUID (Column A) and delete it.
 * sheet.deleteRow() automatically moves rows below it UP to fill the empty space!
 */
function deleteRowById(sheet, id1, id2, id3) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  var match1 = id1 ? String(id1).trim().toLowerCase() : "";
  var match2 = id2 ? String(id2).trim().toLowerCase() : "";
  var match3 = id3 ? String(id3).trim().toLowerCase() : "";

  var idRange = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var deleted = false;

  // Loop in reverse so deleting a row does not alter preceding row indices
  for (var i = idRange.length - 1; i >= 0; i--) {
    var cellVal = String(idRange[i][0]).trim().toLowerCase();
    if (!cellVal) continue;
    if (
      (match1 && cellVal === match1) ||
      (match2 && cellVal === match2) ||
      (match3 && cellVal === match3)
    ) {
      sheet.deleteRow(i + 2);
      deleted = true;
    }
  }
  return deleted;
}

/**
 * Upsert row in a sheet:
 * - If row exists (matched by Lead ID, Job ID, or DB UUID), updates it in place with all edited data.
 * - If new, inserts at Row 2 so recent leads stay on top!
 */
function upsertRowInSheet(sheet, leadId, rowData, dbId, jobId) {
  var lastRow = sheet.getLastRow();
  var foundRow = -1;

  var match1 = leadId ? String(leadId).trim().toLowerCase() : "";
  var match2 = dbId ? String(dbId).trim().toLowerCase() : "";
  var match3 = jobId ? String(jobId).trim().toLowerCase() : "";

  if (lastRow > 1) {
    var idRange = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < idRange.length; i++) {
      var cellVal = String(idRange[i][0]).trim().toLowerCase();
      if (!cellVal) continue;
      if (
        (match1 && cellVal === match1) ||
        (match2 && cellVal === match2) ||
        (match3 && cellVal === match3)
      ) {
        foundRow = i + 2;
        break;
      }
    }
  }

  if (foundRow > 0) {
    // Lead edited -> Update existing row in place with new edited values!
    sheet.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
    return foundRow;
  } else {
    // New lead -> Insert at row 2 so recent leads stay on top!
    sheet.insertRowBefore(2);
    sheet.getRange(2, 1, 1, rowData.length).setValues([rowData]);
    sheet.getRange(2, 1, 1, rowData.length)
      .setFontFamily("Arial")
      .setFontSize(10)
      .setVerticalAlignment("middle");
    return 2;
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
  var rows = leads.map(leadToRow);

  // 3. Write rows in batch
  var dataRange = sheet.getRange(2, 1, rows.length, HEADERS.length);
  dataRange.setValues(rows);

  // Style data rows
  dataRange.setFontFamily("Arial")
    .setFontSize(10)
    .setVerticalAlignment("middle");

  // Auto-fit column widths
  autoFitColumns(sheet);
}

/**
 * Convert lead object to array matching HEADERS order (17 columns)
 */
function leadToRow(lead) {
  return [
    lead["Lead ID"] || lead["Lead Id"] || lead["_job_id"] || lead["job_id"] || lead["_id"] || lead["id"] || "",
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
