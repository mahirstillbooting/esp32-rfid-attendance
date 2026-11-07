/**
 * ESP32 RFID Attendance System - Google Apps Script Backend
 * 
 * Features:
 * - Latest to Oldest Sorting: Row 2 is ALWAYS the latest punch!
 * - Smart Enter/Exit Toggling
 * - Exactly 2 blank rows gap before the Summary Table
 * - Large, comfortable column widths
 * - Left-justified formatting everywhere
 * - Clean status ("Currently Inside", "Checked Out", "Absent" - NO green emoji)
 */

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var uid = e.parameter.uid;
  
  if (!uid) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: "No UID provided"}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  uid = uid.trim().toUpperCase();

  // 1. Look up user in master "Users" sheet
  var usersSheet = ss.getSheetByName("Users");
  if (!usersSheet) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: "Users sheet not found"}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var usersData = usersSheet.getDataRange().getValues();
  var userName = "";
  var personId = "";
  var found = false;

  for (var i = 1; i < usersData.length; i++) {
    if (usersData[i][0] && usersData[i][0].toString().trim().toUpperCase() === uid) {
      userName = usersData[i][1];
      personId = usersData[i][2];
      found = true;
      break;
    }
  }

  if (!found) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "unregistered",
      uid: uid,
      message: "Card not registered"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. Resolve Today's Daily Sheet (DD-MM-YYYY)
  var now = new Date();
  var timeZone = Session.getScriptTimeZone();
  var todaySheetName = Utilities.formatDate(now, timeZone, "dd-MM-yyyy");
  var timeStr = Utilities.formatDate(now, timeZone, "HH:mm:ss");

  var daySheet = ss.getSheetByName(todaySheetName);

  // If new daily sheet, create with headers and large column widths
  if (!daySheet) {
    daySheet = ss.insertSheet(todaySheetName);
    daySheet.appendRow(["Time", "Card_UID", "Name", "ID_Number", "Action"]);
    
    var headerRange = daySheet.getRange(1, 1, 1, 5);
    headerRange.setBackground("#1F4E79")
               .setFontColor("#FFFFFF")
               .setFontWeight("bold")
               .setHorizontalAlignment("left");
               
    applyLargeColumnWidths(daySheet);
  } else {
    applyLargeColumnWidths(daySheet);
  }

  // 3. Find if Summary Section already exists
  var sheetData = daySheet.getDataRange().getValues();
  var summaryTitleRow = -1; // 1-based index
  for (var r = 0; r < sheetData.length; r++) {
    if (sheetData[r][0] && sheetData[r][0].toString().indexOf("DAILY ATTENDANCE") >= 0) {
      summaryTitleRow = r + 1;
      break;
    }
  }

  // 4. Determine nextAction (ENTER or EXIT)
  // Since Row 2 is ALWAYS the latest punch, scan from Row 2 down to find this user's most recent action
  var nextAction = "ENTER"; // default
  var punchEndRow = (summaryTitleRow > 0) ? (summaryTitleRow - 1) : sheetData.length;

  for (var j = 1; j < punchEndRow; j++) {
    if (!sheetData[j] || !sheetData[j][1]) continue;
    var rowUid = sheetData[j][1].toString().trim().toUpperCase();
    if (rowUid === uid) {
      var lastAction = sheetData[j][4];
      nextAction = (lastAction === "ENTER") ? "EXIT" : "ENTER";
      break;
    }
  }

  // 5. INSERT NEW PUNCH AT ROW 2 (Latest always on top!)
  daySheet.insertRowAfter(1); // Inserts blank row at row 2
  var newPunchRange = daySheet.getRange(2, 1, 1, 5);
  newPunchRange.setValues([[timeStr, uid, userName, personId, nextAction]]);
  newPunchRange.setHorizontalAlignment("left");

  // 6. Recalculate and update the Summary Table below with 2-row gap
  updateDailySummaryTable(daySheet, usersData);

  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    name: userName,
    action: nextAction,
    time: timeStr,
    sheet: todaySheetName
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Sets large, comfortable column widths so text is never truncated
 */
function applyLargeColumnWidths(sheet) {
  sheet.setColumnWidth(1, 170); // Time
  sheet.setColumnWidth(2, 170); // Card_UID
  sheet.setColumnWidth(3, 250); // Name / Employee Name
  sheet.setColumnWidth(4, 160); // ID_Number
  sheet.setColumnWidth(5, 210); // Action / Total Working Hours
  sheet.setColumnWidth(6, 210); // Status
}

/**
 * Updates the summary table with:
 * - 2-row blank gap
 * - Left-aligned text
 * - Clean status (NO green emoji)
 */
function updateDailySummaryTable(daySheet, usersData) {
  var sheetData = daySheet.getDataRange().getValues();
  var summaryTitleRow = -1;

  for (var r = 0; r < sheetData.length; r++) {
    if (sheetData[r][0] && sheetData[r][0].toString().indexOf("DAILY ATTENDANCE") >= 0) {
      summaryTitleRow = r + 1;
      break;
    }
  }

  // Ensure exactly 2 blank rows exist above summaryTitleRow if summary exists
  if (summaryTitleRow > 0) {
    var blankCount = 0;
    for (var b = summaryTitleRow - 2; b >= 1; b--) {
      if (!sheetData[b][0] || sheetData[b][0].toString().trim() === "") {
        blankCount++;
      } else {
        break;
      }
    }
    // If fewer than 2 blank rows, insert missing blank rows
    if (blankCount < 2) {
      var rowsToInsert = 2 - blankCount;
      daySheet.insertRowsBefore(summaryTitleRow, rowsToInsert);
      sheetData = daySheet.getDataRange().getValues();
      for (var r2 = 0; r2 < sheetData.length; r2++) {
        if (sheetData[r2][0] && sheetData[r2][0].toString().indexOf("DAILY ATTENDANCE") >= 0) {
          summaryTitleRow = r2 + 1;
          break;
        }
      }
    }
  }

  // Punches are strictly between Row 2 and the blank gap
  var punchLimit = (summaryTitleRow > 0) ? (summaryTitleRow - 3) : (sheetData.length);

  // Initialize stats dictionary for users listed in "Users" tab
  var stats = {};
  for (var u = 1; u < usersData.length; u++) {
    if (!usersData[u][0]) continue;
    var regUid = usersData[u][0].toString().trim().toUpperCase();
    stats[regUid] = {
      name: usersData[u][1],
      id: usersData[u][2],
      entries: 0,
      exits: 0,
      totalSeconds: 0,
      status: "Absent"
    };
  }

  // Collect all punches for each user
  var userPunches = {};
  for (var p = 1; p < punchLimit; p++) {
    if (!sheetData[p] || !sheetData[p][1]) continue;
    var pTime = sheetData[p][0];
    var pUid = sheetData[p][1].toString().trim().toUpperCase();
    var pAction = sheetData[p][4];

    if (!stats[pUid]) {
      stats[pUid] = {
        name: sheetData[p][2] || "Unknown",
        id: sheetData[p][3] || "-",
        entries: 0,
        exits: 0,
        totalSeconds: 0,
        status: "Absent"
      };
    }

    if (!userPunches[pUid]) {
      userPunches[pUid] = [];
    }
    userPunches[pUid].push({ time: pTime, action: pAction });
  }

  // Calculate working hours in chronological order (from oldest to newest)
  for (var key in userPunches) {
    var punches = userPunches[key];
    var lastEnterSec = null;
    var totalSec = 0;
    var entries = 0;
    var exits = 0;

    // Punches in sheet are newest (top) to oldest (bottom)
    // Reverse them to process from morning to evening
    for (var k = punches.length - 1; k >= 0; k--) {
      var item = punches[k];
      var sec = parseTimeToSeconds(item.time);
      if (item.action === "ENTER") {
        entries++;
        lastEnterSec = sec;
      } else if (item.action === "EXIT") {
        exits++;
        if (lastEnterSec !== null) {
          totalSec += Math.max(0, sec - lastEnterSec);
          lastEnterSec = null;
        }
      }
    }

    stats[key].entries = entries;
    stats[key].exits = exits;
    stats[key].totalSeconds = totalSec;

    // Latest punch (item 0 in userPunches) determines real-time status:
    var latestAction = punches[0].action;
    if (latestAction === "ENTER") {
      stats[key].status = "Currently Inside"; // No green circle emoji
    } else if (latestAction === "EXIT") {
      stats[key].status = "Checked Out";
    }
  }

  // Prepare Summary Rows
  var summaryRows = [];
  for (var uidKey in stats) {
    var usr = stats[uidKey];
    var durationText = formatSeconds(usr.totalSeconds);
    if (usr.entries === 0) {
      durationText = "0h 00m 00s";
    } else if (usr.status === "Currently Inside") {
      durationText += " (Active)";
    }

    summaryRows.push([
      usr.name,
      usr.id,
      usr.entries,
      usr.exits,
      durationText,
      usr.status
    ]);
  }

  // If summary section doesn't exist yet, build it
  if (summaryTitleRow === -1) {
    daySheet.appendRow([""]); // Gap Row 1
    daySheet.appendRow([""]); // Gap Row 2

    var titleRowIdx = daySheet.getLastRow() + 1;
    daySheet.appendRow(["📊 DAILY ATTENDANCE & WORKING HOURS SUMMARY"]);
    daySheet.getRange(titleRowIdx, 1, 1, 6).merge()
            .setBackground("#203764")
            .setFontColor("#FFFFFF")
            .setFontWeight("bold")
            .setHorizontalAlignment("left");

    var subHeaderIdx = titleRowIdx + 1;
    daySheet.appendRow(["Employee Name", "ID Number", "Total Entries", "Total Exits", "Total Working Hours", "Status"]);
    daySheet.getRange(subHeaderIdx, 1, 1, 6)
            .setBackground("#2F5597")
            .setFontColor("#FFFFFF")
            .setFontWeight("bold")
            .setHorizontalAlignment("left");

    for (var s = 0; s < summaryRows.length; s++) {
      daySheet.appendRow(summaryRows[s]);
      var curRow = daySheet.getLastRow();
      daySheet.getRange(curRow, 1, 1, 6).setHorizontalAlignment("left");
    }
  } else {
    // Update existing summary rows in place
    var dataStartRow = summaryTitleRow + 2;
    if (summaryRows.length > 0) {
      // Clear old rows in summary range to cleanly remove deleted employees
      var currentLastRow = daySheet.getLastRow();
      if (currentLastRow >= dataStartRow) {
        daySheet.getRange(dataStartRow, 1, currentLastRow - dataStartRow + 1, 6).clearContent();
      }
      var range = daySheet.getRange(dataStartRow, 1, summaryRows.length, 6);
      range.setValues(summaryRows);
      range.setHorizontalAlignment("left");
    }
  }
}

// Helper: Convert "HH:mm:ss" or Date object to total seconds
function parseTimeToSeconds(timeVal) {
  if (!timeVal) return 0;
  if (timeVal instanceof Date) {
    return timeVal.getHours() * 3600 + timeVal.getMinutes() * 60 + timeVal.getSeconds();
  }
  var parts = timeVal.toString().split(":");
  if (parts.length >= 2) {
    var h = parseInt(parts[0], 10) || 0;
    var m = parseInt(parts[1], 10) || 0;
    var s = (parts.length >= 3) ? (parseInt(parts[2], 10) || 0) : 0;
    return h * 3600 + m * 60 + s;
  }
  return 0;
}

// Helper: Format seconds to "Xh Ym Zs"
function formatSeconds(totalSec) {
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  return h + "h " + (m < 10 ? "0" : "") + m + "m " + (s < 10 ? "0" : "") + s + "s";
}
