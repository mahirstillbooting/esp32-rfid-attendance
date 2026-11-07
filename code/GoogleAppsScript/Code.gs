/**
 * ESP32 RFID Attendance System - Google Apps Script Backend
 * 
 * Features:
 * - Dynamic daily sheet creation (Format: DD-MM-YYYY)
 * - Enter/Exit smart toggling
 * - Automatic Daily Working Hours & Attendance Summary Table (placed below logs)
 * - Live count of Entries, Exits, Total Duration Inside, and Real-time Status
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
    if (usersData[i][0].toString().trim().toUpperCase() === uid) {
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
  var isNewSheet = false;

  if (!daySheet) {
    isNewSheet = true;
    daySheet = ss.insertSheet(todaySheetName);
    daySheet.appendRow(["Time", "Card_UID", "Name", "ID_Number", "Action"]);
    
    var headerRange = daySheet.getRange(1, 1, 1, 5);
    headerRange.setBackground("#1F4E79")
               .setFontColor("#FFFFFF")
               .setFontWeight("bold")
               .setHorizontalAlignment("center");
               
    daySheet.setColumnWidth(1, 160);
    daySheet.setColumnWidth(2, 140);
    daySheet.setColumnWidth(3, 180);
    daySheet.setColumnWidth(4, 120);
    daySheet.setColumnWidth(5, 120);
    daySheet.setColumnWidth(6, 160);
  }

  // 3. Find if Summary Section already exists below the punch table
  var allData = daySheet.getDataRange().getValues();
  var summaryTitleRow = -1; // 1-based index
  for (var r = 0; r < allData.length; r++) {
    if (allData[r][0] && allData[r][0].toString().indexOf("DAILY ATTENDANCE") >= 0) {
      summaryTitleRow = r + 1;
      break;
    }
  }

  // 4. Determine nextAction (ENTER or EXIT)
  var punchLimit = (summaryTitleRow > 0) ? (summaryTitleRow - 2) : (allData.length - 1);
  var nextAction = "ENTER"; // default

  for (var j = punchLimit; j >= 1; j--) {
    var rowUid = allData[j][1].toString().trim().toUpperCase();
    if (rowUid === uid) {
      var lastAction = allData[j][4];
      nextAction = (lastAction === "ENTER") ? "EXIT" : "ENTER";
      break;
    }
  }

  // 5. Insert new punch row (Above summary if summary exists, else append)
  if (summaryTitleRow > 0) {
    var insertAtRow = summaryTitleRow - 1; // Insert right above blank separator
    daySheet.insertRowBefore(insertAtRow);
    daySheet.getRange(insertAtRow, 1, 1, 5).setValues([[timeStr, uid, userName, personId, nextAction]]);
    daySheet.getRange(insertAtRow, 1, 1, 5).setHorizontalAlignment("center");
    daySheet.getRange(insertAtRow, 3).setHorizontalAlignment("left");
  } else {
    daySheet.appendRow([timeStr, uid, userName, personId, nextAction]);
    var newRowIdx = daySheet.getLastRow();
    daySheet.getRange(newRowIdx, 1, 1, 5).setHorizontalAlignment("center");
    daySheet.getRange(newRowIdx, 3).setHorizontalAlignment("left");
  }

  // 6. Recalculate and update the Summary Table below the punch logs
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
 * Calculates total entries, exits, time inside, and status for every registered user
 * and renders/updates the summary table below the punch table.
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

  var punchLimit = (summaryTitleRow > 0) ? (summaryTitleRow - 2) : (sheetData.length);

  // Initialize stats dictionary for all registered users
  var stats = {};
  for (var u = 1; u < usersData.length; u++) {
    var regUid = usersData[u][0].toString().trim().toUpperCase();
    stats[regUid] = {
      name: usersData[u][1],
      id: usersData[u][2],
      entries: 0,
      exits: 0,
      totalSeconds: 0,
      lastEnterSec: null,
      status: "Absent"
    };
  }

  // Scan punches in chronological order
  for (var p = 1; p < punchLimit; p++) {
    var pTime = sheetData[p][0];
    var pUid = sheetData[p][1].toString().trim().toUpperCase();
    var pAction = sheetData[p][4];

    if (!stats[pUid]) {
      stats[pUid] = {
        name: sheetData[p][2],
        id: sheetData[p][3],
        entries: 0,
        exits: 0,
        totalSeconds: 0,
        lastEnterSec: null,
        status: "Absent"
      };
    }

    var sec = parseTimeToSeconds(pTime);
    if (pAction === "ENTER") {
      stats[pUid].entries++;
      stats[pUid].lastEnterSec = sec;
      stats[pUid].status = "🟢 Currently Inside";
    } else if (pAction === "EXIT") {
      stats[pUid].exits++;
      if (stats[pUid].lastEnterSec !== null) {
        stats[pUid].totalSeconds += Math.max(0, sec - stats[pUid].lastEnterSec);
        stats[pUid].lastEnterSec = null;
      }
      stats[pUid].status = "Checked Out";
    }
  }

  // Prepare Summary Rows
  var summaryRows = [];
  for (var key in stats) {
    var user = stats[key];
    var durationText = formatSeconds(user.totalSeconds);
    if (user.entries === 0) {
      durationText = "0h 00m 00s";
    } else if (user.status === "🟢 Currently Inside") {
      durationText += " (Active)";
    }

    summaryRows.push([
      user.name,
      user.id,
      user.entries,
      user.exits,
      durationText,
      user.status
    ]);
  }

  // If summary section doesn't exist yet, build it
  if (summaryTitleRow === -1) {
    daySheet.appendRow([""]); // Blank row separator
    var titleRowIdx = daySheet.getLastRow() + 1;
    daySheet.appendRow(["📊 DAILY ATTENDANCE & WORKING HOURS SUMMARY"]);
    daySheet.getRange(titleRowIdx, 1, 1, 6).merge()
            .setBackground("#203764")
            .setFontColor("#FFFFFF")
            .setFontWeight("bold")
            .setHorizontalAlignment("center");

    var subHeaderIdx = titleRowIdx + 1;
    daySheet.appendRow(["Employee Name", "ID Number", "Total Entries", "Total Exits", "Total Working Hours", "Status"]);
    daySheet.getRange(subHeaderIdx, 1, 1, 6)
            .setBackground("#2F5597")
            .setFontColor("#FFFFFF")
            .setFontWeight("bold")
            .setHorizontalAlignment("center");

    for (var s = 0; s < summaryRows.length; s++) {
      daySheet.appendRow(summaryRows[s]);
      var curRow = daySheet.getLastRow();
      daySheet.getRange(curRow, 1, 1, 6).setHorizontalAlignment("center");
      daySheet.getRange(curRow, 1).setHorizontalAlignment("left");
    }
  } else {
    // Update existing summary rows in place
    var dataStartRow = summaryTitleRow + 2;
    var range = daySheet.getRange(dataStartRow, 1, summaryRows.length, 6);
    range.setValues(summaryRows);
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
