#include <SPI.h>
#include <MFRC522.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ================= WIFI CONFIGURATION =================
// Replace with your local Wi-Fi credentials:
const char* WIFI_SSID     = "YOUR_WIFI_NAME";        
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";    

// Paste your Google Apps Script Web App Deployment URL here:
const char* GOOGLE_SCRIPT_URL = "YOUR_GOOGLE_SCRIPT_WEB_APP_URL";

// ================= HARDWARE PIN CONFIG =================
#define SS_PIN    5
#define RST_PIN   22

#define GREEN_LED 2
#define RED_LED   4
#define BUZZER    15

MFRC522 rfid(SS_PIN, RST_PIN);
WiFiClientSecure client;

// ================= SOUND & LED FEEDBACK =================
// Immediate 0ms tactile feedback when card touches the reader
void instantCardDetectedChirp() {
  digitalWrite(GREEN_LED, HIGH);
  digitalWrite(BUZZER, HIGH);
  delay(60); // Quick 60ms click
  digitalWrite(BUZZER, LOW);
}

// 1. ENTER: Solid Green LED ON + 1 solid confirmation beep
void enterSuccessSignal() {
  Serial.println(">> Result: [ENTER] Recorded Successfully!");
  digitalWrite(GREEN_LED, HIGH);
  digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER, HIGH);
  delay(400);
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(BUZZER, LOW);
}

// 2. EXIT: Green & Red LEDs ON + 2 short confirmation beeps
void exitSuccessSignal() {
  Serial.println(">> Result: [EXIT] Recorded Successfully!");
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

// 3. UNREGISTERED CARD: Red LED ON + 3 warning beeps
void cardNotRegisteredSignal() {
  Serial.println(">> Result: Card Not Registered in Users sheet!");
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

// 4. CONNECTION / TIMEOUT ERROR: Red LED ON + 1 long buzz
void errorSignal() {
  Serial.println(">> Result: Connection or Server Error!");
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, HIGH);
  digitalWrite(BUZZER, HIGH);
  delay(600);
  digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER, LOW);
}

// ================= SETUP =================
void setup() {
  // Boost ESP32 CPU frequency to 240MHz for accelerated SSL/TLS cryptography
  setCpuFrequencyMhz(240);

  Serial.begin(115200);

  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER, LOW);

  // Initialize SPI & RC522 RFID reader
  SPI.begin(18, 19, 23, 5);
  rfid.PCD_Init();

  Serial.println("\n==========================================");
  Serial.println("   ESP32 RFID Attendance (High-Speed Mode)");
  Serial.println("==========================================");

  // Configure Wi-Fi & disable power-save sleep to eliminate network lag
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to '");
  Serial.print(WIFI_SSID);
  Serial.print("'");

  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
    digitalWrite(GREEN_LED, !digitalRead(GREEN_LED));
  }
  digitalWrite(GREEN_LED, LOW);

  Serial.println("\n[+] Wi-Fi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // Allow self-signed / public Google SSL endpoint
  client.setInsecure();

  // Ready signal: short beep
  digitalWrite(BUZZER, HIGH);
  digitalWrite(GREEN_LED, HIGH);
  delay(100);
  digitalWrite(BUZZER, LOW);
  digitalWrite(GREEN_LED, LOW);

  Serial.println("[+] System Ready! Scan your card...\n");
}

// ================= SEND ATTENDANCE DATA =================
void sendAttendanceData(String uid) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[-] Wi-Fi disconnected. Reconnecting...");
    WiFi.reconnect();
    errorSignal();
    return;
  }

  HTTPClient http;

  // Encode spaces as %20 for URL query string
  String encodedUid = "";
  for (unsigned int i = 0; i < uid.length(); i++) {
    if (uid[i] == ' ') encodedUid += "%20";
    else encodedUid += uid[i];
  }

  String requestUrl = String(GOOGLE_SCRIPT_URL) + "?uid=" + encodedUid;

  http.begin(client, requestUrl);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS); // Follow Google 302 redirects
  http.setTimeout(8000); // 8-second request timeout

  int httpCode = http.GET();

  if (httpCode > 0) {
    String payload = http.getString();
    Serial.print("HTTP ");
    Serial.print(httpCode);
    Serial.print(" | ");
    Serial.println(payload);

    if (payload.indexOf("\"action\":\"ENTER\"") > 0) {
      enterSuccessSignal();
    } else if (payload.indexOf("\"action\":\"EXIT\"") > 0) {
      exitSuccessSignal();
    } else if (payload.indexOf("\"status\":\"unregistered\"") > 0) {
      cardNotRegisteredSignal();
    } else {
      errorSignal();
    }
  } else {
    Serial.printf("[-] HTTP request failed: %s\n", http.errorToString(httpCode).c_str());
    errorSignal();
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

  // Instant tactile feedback to acknowledge tap
  instantCardDetectedChirp();

  // Read UID bytes into uppercase hex string: "XX XX XX XX"
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

  // Halt card to prevent repeated reads while holding on reader
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  delay(1000); // Debounce cooldown before accepting next tap
  Serial.println("\nReady for next card...");
}
