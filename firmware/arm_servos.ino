#include <ESP32Servo.h>
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include "secrets.h"
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

Servo base, shoulder, elbow, gripper;

const int CALIB_B = 90, CALIB_S = 90, CALIB_E = 90, CALIB_G = 20;
int currB, currS, currE, currG;
int targetB, targetS, targetE, targetG;

unsigned long lastMoveTime = 0;
const int moveInterval = 15;

// Shared state — volatile so both cores read fresh values
volatile int cmdTarget_B = -1, cmdTarget_S = -1, cmdTarget_E = -1, cmdTarget_G = -1;
volatile bool doReset = false;

// ── Serial buffer (non-blocking) ──────────────────────
String serialBuf = "";

void processCommand(String input) {
    input.trim();
    if (input.length() < 2) return;
    char joint = input[0];
    int val = input.substring(1).toInt();
    if      (joint == 'R') doReset = true;
    else if (joint == 'B') cmdTarget_B = constrain(val, 0, 180);
    else if (joint == 'S') cmdTarget_S = constrain(val, 10, 170);
    else if (joint == 'E') cmdTarget_E = constrain(val, 30, 150);
    else if (joint == 'G') cmdTarget_G = constrain(val, 10, 90);
}

// ── Core 0: Firebase + heartbeat (runs independently) ─
void firebaseTask(void* param) {
    unsigned long lastCheck = 0, lastHB = 0;
    for (;;) {
        if (Firebase.ready()) {
            // Poll command every 250ms
            if (millis() - lastCheck > 250) {
                lastCheck = millis();
                if (Firebase.RTDB.getString(&fbdo, "/arm/command")) {
                    String cmd = fbdo.stringData();
                    if (cmd.length() > 1) {
                        processCommand(cmd);
                        Firebase.RTDB.setString(&fbdo, "/arm/command", "");
                    }
                }
            }
            // Heartbeat every 5s
            if (millis() - lastHB > 5000) {
                lastHB = millis();
                Firebase.RTDB.setInt(&fbdo, "/arm/lastSeen", millis());
            }
        }
        vTaskDelay(10 / portTICK_PERIOD_MS); // yield to RTOS
    }
}

// ── Core 1: setup + servo loop ────────────────────────
void setup() {
    Serial.begin(115200);
    Serial.setTimeout(5);           // ← USB non-blocking: 5ms max wait
    Serial.setRxBufferSize(1024);

    WiFi.begin(SECRET_SSID, SECRET_PASS);
    while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
    Serial.println("\n✓ WiFi: " + WiFi.localIP().toString());

    config.api_key = SECRET_API_KEY;
    config.database_url = SECRET_DB_URL;
    config.signer.test_mode = true;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);

    base.attach(14); shoulder.attach(27);
    elbow.attach(26); gripper.attach(33);

    currB = targetB = CALIB_B; currS = targetS = CALIB_S;
    currE = targetE = CALIB_E; currG = targetG = CALIB_G;
    base.write(currB); shoulder.write(currS);
    elbow.write(currE); gripper.write(currG);

    // Start Firebase on Core 0
    xTaskCreatePinnedToCore(firebaseTask, "Firebase", 8192, NULL, 1, NULL, 0);
}

void loop() {  // runs on Core 1
    // 1. Apply any commands from either USB or cloud
    if (doReset) {
        targetB = CALIB_B; targetS = CALIB_S;
        targetE = CALIB_E; targetG = CALIB_G;
        doReset = false;
    }
    if (cmdTarget_B >= 0) { targetB = cmdTarget_B; cmdTarget_B = -1; }
    if (cmdTarget_S >= 0) { targetS = cmdTarget_S; cmdTarget_S = -1; }
    if (cmdTarget_E >= 0) { targetE = cmdTarget_E; cmdTarget_E = -1; }
    if (cmdTarget_G >= 0) { targetG = cmdTarget_G; cmdTarget_G = -1; }

    // 2. Non-blocking USB serial
    while (Serial.available()) {
        char c = Serial.read();
        if (c == '\n') { processCommand(serialBuf); serialBuf = ""; }
        else serialBuf += c;
    }

    // 3. Servo sweep — runs every 15ms, never blocked by network
    if (millis() - lastMoveTime >= moveInterval) {
        lastMoveTime = millis();
        if (currB != targetB) { currB < targetB ? currB++ : currB--; base.write(currB); }
        if (currS != targetS) { currS < targetS ? currS++ : currS--; shoulder.write(currS); }
        if (currE != targetE) { currE < targetE ? currE++ : currE--; elbow.write(currE); }
        if (currG != targetG) { currG < targetG ? currG++ : currG--; gripper.write(currG); }
    }
}