/**
 * ESP32 RFID Attendance System - Google Apps Script Backend
 * 
 * Automatically manages master user registry and logs punches into
 * auto-generated daily sheets with Enter/Exit toggling.
 */

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var uid = e.parameter.uid;
  
  if (!uid) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: "No UID provided"}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  uid = uid.trim().toUpperCase();

  // 1. Master User Lookup in "Users" tab
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

  // If card is not registered
  if (!found) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "unregistered",
      uid: uid,
      message: "Card not registered"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. Resolve Daily Sheet (Format: DD-MM-YYYY, e.g., 07-11-2026)
  var now = new Date();
  var timeZone = Session.getScriptTimeZone();
  var todaySheetName = Utilities.formatDate(now, timeZone, "dd-MM-yyyy");
  var timeStr = Utilities.formatDate(now, timeZone, "HH:mm:ss");

  var daySheet = ss.getSheetByName(todaySheetName);
  
  // Auto-generate sheet for new days
  if (!daySheet) {
    daySheet = ss.insertSheet(todaySheetName);
    daySheet.appendRow(["Time", "Card_UID", "Name", "ID_Number", "Action"]);
    
    // Style headers
    var headerRange = daySheet.getRange(1, 1, 1, 5);
    headerRange.setBackground("#1F4E79")
               .setFontColor("#FFFFFF")
               .setFontWeight("bold")
               .setHorizontalAlignment("center");
  }

  // 3. Fast Reverse Scan: determine if this punch is ENTER or EXIT
  var lastRow = daySheet.getLastRow();
  var nextAction = "ENTER"; // default if first tap of the day

  if (lastRow > 1) {
    var scanCount = Math.min(lastRow - 1, 50); // Scan recent logs
    var startRow = lastRow - scanCount + 1;
    var recentLogs = daySheet.getRange(startRow, 1, scanCount, 5).getValues();

    for (var j = recentLogs.length - 1; j >= 0; j--) {
      var rowUid = recentLogs[j][1].toString().trim().toUpperCase();
      if (rowUid === uid) {
        var lastAction = recentLogs[j][4];
        nextAction = (lastAction === "ENTER") ? "EXIT" : "ENTER";
        break;
      }
    }
  }

  // 4. Record punch into today's sheet
  daySheet.appendRow([timeStr, uid, userName, personId, nextAction]);

  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    name: userName,
    action: nextAction,
    time: timeStr,
    sheet: todaySheetName
  })).setMimeType(ContentService.MimeType.JSON);
}
