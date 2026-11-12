#include <SPI.h>
#include <MFRC522.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ================= WIFI & WEBHOOK CONFIGURATION =================
// Replace with your local Wi-Fi credentials:
const char* WIFI_SSID         = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD     = "YOUR_WIFI_PASSWORD";

// Paste your Google Apps Script Web App Deployment URL here:
const char* GOOGLE_SCRIPT_URL = "YOUR_GOOGLE_SCRIPT_WEB_APP_URL";

// ================= HARDWARE PIN CONFIG =================
#define SS_PIN    5
#define RST_PIN   22

#define GREEN_LED 2
#define RED_LED   4
#define BUZZER    15

// OLED I2C Pins (GPIO 27 avoids conflict with RC522 RST on GPIO 22)
#define OLED_SDA  21
#define OLED_SCL  27

// ================= OLED DISPLAY CONFIG =================
#define SCREEN_WIDTH   128
#define SCREEN_HEIGHT  64
#define OLED_RESET     -1
#define SCREEN_ADDRESS 0x3C  // Change to 0x3D if your OLED stays blank

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
bool oledReady = false;

MFRC522 rfid(SS_PIN, RST_PIN);
WiFiClientSecure client;

// ================= OLED HELPER FUNCTIONS =================
String fitText(String text, unsigned int maxChars) {
  text.trim();
  if (text.length() <= maxChars) return text;
  if (maxChars <= 3) return text.substring(0, maxChars);
  return text.substring(0, maxChars - 3) + "...";
}

void drawCenteredText(const String& text, int y, int textSize) {
  int16_t x1, y1;
  uint16_t w, h;
  display.setTextSize(textSize);
  display.getTextBounds(text.c_str(), 0, y, &x1, &y1, &w, &h);
  int x = (SCREEN_WIDTH - (int)w) / 2;
  if (x < 0) x = 0;
  display.setCursor(x, y);
  display.print(text);
}

void showHeader(const String& title) {
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  drawCenteredText(fitText(title, 21), 2, 1);
  display.drawLine(0, 13, SCREEN_WIDTH, 13, SSD1306_WHITE);
}

void showPromptScreen(const String& header, const String& line1, const String& line2 = "", int textSize = 2) {
  if (!oledReady) return;
  display.clearDisplay();
  showHeader(header);

  if (line2.length() == 0) {
    drawCenteredText(line1, 30, textSize);
  } else if (textSize == 2) {
    drawCenteredText(line1, 21, 2);
    drawCenteredText(line2, 43, 2);
  } else {
    drawCenteredText(line1, 24, 1);
    drawCenteredText(line2, 40, 1);
  }

  display.display();
}

void showIdlePrompt() {
  showPromptScreen("ATTENDANCE", "Scan your", "ID", 2);
}

void showIdentityScreen(const String& empName, const String& empId) {
  if (!oledReady) return;
  display.clearDisplay();
  showHeader("ID RECOGNIZED");

  display.setTextSize(1);
  display.setCursor(2, 20);
  display.println("Name:");
  display.setCursor(2, 30);
  display.println(fitText(empName, 20));

  display.setCursor(2, 44);
  display.print("ID: ");
  display.println(fitText(empId, 16));

  display.display();
}

void showStateScreen(const String& stateLabel, const String& empName) {
  if (!oledReady) return;
  display.clearDisplay();
  showHeader(fitText(empName, 21));
  drawCenteredText(stateLabel, 28, 3);
  display.display();
}

void showTryAgainError(const String& reasonHeader) {
  if (!oledReady) return;
  display.clearDisplay();
  showHeader(reasonHeader);
  drawCenteredText("Please try", 23, 2);
  drawCenteredText("again", 43, 2);
  display.display();
}

// Extracts either quoted strings ("name":"John") or unquoted values ("id":101)
String extractJsonField(const String& json, const String& key) {
  String pattern = "\"" + key + "\"";
  int keyIdx = json.indexOf(pattern);
  if (keyIdx == -1) return "";

  int colonIdx = json.indexOf(':', keyIdx + pattern.length());
  if (colonIdx == -1) return "";

  int valStart = colonIdx + 1;
  while (valStart < (int)json.length() &&
         (json[valStart] == ' ' || json[valStart] == '\t' || json[valStart] == '\r' || json[valStart] == '\n')) {
    valStart++;
  }
  if (valStart >= (int)json.length()) return "";

  if (json[valStart] == '"') {
    valStart++;
    int valEnd = json.indexOf('"', valStart);
    if (valEnd == -1) return "";
    return json.substring(valStart, valEnd);
  }

  int valEnd = valStart;
  while (valEnd < (int)json.length() &&
         json[valEnd] != ',' &&
         json[valEnd] != '}' &&
         json[valEnd] != ' ') {
    valEnd++;
  }
  String raw = json.substring(valStart, valEnd);
  if (raw == "null") return "";
  return raw;
}

// ================= SOUND & LED FEEDBACK =================
void instantCardDetectedChirp() {
  digitalWrite(GREEN_LED, HIGH);
  digitalWrite(BUZZER, HIGH);
  delay(60);
  digitalWrite(BUZZER, LOW);
}

void enterSuccessSignal() {
  digitalWrite(GREEN_LED, HIGH);
  digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER, HIGH);
  delay(350);
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(BUZZER, LOW);
}

void exitSuccessSignal() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(GREEN_LED, HIGH);
    digitalWrite(RED_LED, HIGH);
    digitalWrite(BUZZER, HIGH);
    delay(120);
    digitalWrite(GREEN_LED, LOW);
    digitalWrite(RED_LED, LOW);
    digitalWrite(BUZZER, LOW);
    delay(90);
  }
}

void cardNotRegisteredSignal() {
  digitalWrite(GREEN_LED, LOW);
  for (int i = 0; i < 3; i++) {
    digitalWrite(RED_LED, HIGH);
    digitalWrite(BUZZER, HIGH);
    delay(100);
    digitalWrite(RED_LED, LOW);
    digitalWrite(BUZZER, LOW);
    delay(80);
  }
}

void errorSignal() {
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, HIGH);
  digitalWrite(BUZZER, HIGH);
  delay(550);
  digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER, LOW);
}

// ================= WIFI CONNECT HELPER =================
void connectToWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Searching for Wi-Fi '");
  Serial.print(WIFI_SSID);
  Serial.print("'");

  int dotStep = 0;
  while (WiFi.status() != WL_CONNECTED) {
    String dots = ".";
    if (dotStep % 3 == 1) dots = "..";
    else if (dotStep % 3 == 2) dots = "...";

    showPromptScreen("SYSTEM BOOT", "Searching for", "WiFi" + dots, 1);
    dotStep++;

    delay(350);
    Serial.print(".");
    digitalWrite(GREEN_LED, !digitalRead(GREEN_LED));
  }
  digitalWrite(GREEN_LED, LOW);

  Serial.println("\n[+] Connected to the network!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // Short ready chime + display connected confirmation
  digitalWrite(BUZZER, HIGH);
  digitalWrite(GREEN_LED, HIGH);
  showPromptScreen("NETWORK READY", "Connected to", "Network", 1);
  delay(120);
  digitalWrite(BUZZER, LOW);
  digitalWrite(GREEN_LED, LOW);

  delay(1400);
  showIdlePrompt();
}

// ================= SETUP =================
void setup() {
  setCpuFrequencyMhz(240);
  Serial.begin(115200);

  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER, LOW);

  // Initialize OLED on custom I2C pins (SDA = 21, SCL = 27)
  Wire.begin(OLED_SDA, OLED_SCL);
  if (display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    oledReady = true;
    showPromptScreen("SYSTEM BOOT", "Searching for", "WiFi...", 1);
  } else {
    Serial.println("[-] OLED init failed. Check SDA=21, SCL=27 or address 0x3D.");
  }

  // Initialize SPI & RC522 RFID reader
  SPI.begin(18, 19, 23, SS_PIN);
  rfid.PCD_Init();

  Serial.println("\n==========================================");
  Serial.println("   ESP32 RFID Attendance + OLED Display");
  Serial.println("==========================================");

  connectToWiFi();

  client.setInsecure();
  Serial.println("[+] System Ready! Scan your ID...\n");
}

// ================= SEND ATTENDANCE DATA =================
void sendAttendanceData(const String& uid) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[-] Wi-Fi disconnected.");
    showTryAgainError("NO NETWORK");
    errorSignal();
    WiFi.reconnect();
    delay(2500);
    return;
  }

  HTTPClient http;

  String encodedUid = "";
  for (unsigned int i = 0; i < uid.length(); i++) {
    if (uid[i] == ' ') encodedUid += "%20";
    else encodedUid += uid[i];
  }

  String requestUrl = String(GOOGLE_SCRIPT_URL) + "?uid=" + encodedUid;

  http.begin(client, requestUrl);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(8000);

  int httpCode = http.GET();

  if (httpCode > 0) {
    String payload = http.getString();
    Serial.print("HTTP ");
    Serial.print(httpCode);
    Serial.print(" | ");
    Serial.println(payload);

    String status = extractJsonField(payload, "status");
    String action = extractJsonField(payload, "action");
    String empName = extractJsonField(payload, "name");
    if (empName == "") empName = extractJsonField(payload, "user");
    if (empName == "") empName = extractJsonField(payload, "employee");
    if (empName == "") empName = "Employee";

    String empId = extractJsonField(payload, "id");
    if (empId == "") empId = extractJsonField(payload, "id_number");
    if (empId == "") empId = uid;  // Fallback to Card UID if sheet ID isn't returned

    if (action == "ENTER" || action == "EXIT") {
      String stateLabel = (action == "ENTER") ? "ENTRY" : "EXIT";
      Serial.println(">> Identity: " + empName + " | ID: " + empId);
      Serial.println(">> State: [" + stateLabel + "]");

      // Step 1: Display corresponding Name and ID first (same for Entry & Exit)
      showIdentityScreen(empName, empId);
      delay(1400);

      // Step 2: Display ENTRY or EXIT state with LED/buzzer confirmation
      showStateScreen(stateLabel, empName);
      if (action == "ENTER") {
        enterSuccessSignal();
      } else {
        exitSuccessSignal();
      }
      delay(2200);
    } else if (status == "unregistered") {
      Serial.println(">> Result: Card Not Registered in Users sheet!");
      showTryAgainError("UNREGISTERED ID");
      cardNotRegisteredSignal();
      delay(2500);
    } else {
      Serial.println(">> Result: Invalid/Error response from server.");
      showTryAgainError("SERVER ERROR");
      errorSignal();
      delay(2500);
    }
  } else {
    Serial.printf("[-] HTTP request failed: %s\n", http.errorToString(httpCode).c_str());
    showTryAgainError("SCAN ERROR");
    errorSignal();
    delay(2500);
  }

  http.end();
}

// ================= MAIN LOOP =================
void loop() {
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  instantCardDetectedChirp();
  showPromptScreen("CARD SCANNED", "Verifying...", "", 1);

  String cardUID = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) cardUID += "0";
    cardUID += String(rfid.uid.uidByte[i], HEX);
    if (i < rfid.uid.size - 1) cardUID += " ";
  }
  cardUID.toUpperCase();

  Serial.println("------------------------------------------");
  Serial.print("Scanned Card UID: ");
  Serial.println(cardUID);

  sendAttendanceData(cardUID);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  // Always clear previous result/error and return to idle prompt
  showIdlePrompt();
  Serial.println("Ready for next scan...\n");
}
