#include <ESP32Servo.h>

Servo base, shoulder, elbow, gripper;

// CALIBRATION CONSTANTS
const int CALIB_B = 90; 
const int CALIB_S = 90;
const int CALIB_E = 90;
const int CALIB_G = 20;

int currB, currS, currE, currG;
int targetB, targetS, targetE, targetG;

unsigned long lastMoveTime = 0;
const int moveInterval = 15; // Slightly faster for responsiveness

void setup() {
  Serial.begin(115200);
  Serial.setRxBufferSize(1024); // Increase buffer to handle slider bursts
  
  base.attach(14);      
  shoulder.attach(27);  
  elbow.attach(26);     
  gripper.attach(33);   

  currB = targetB = CALIB_B;
  currS = targetS = CALIB_S;
  currE = targetE = CALIB_E;
  currG = targetG = CALIB_G;

  base.write(currB);
  shoulder.write(currS);
  elbow.write(currE);
  gripper.write(currG);
}

void loop() {
  // A. ROBUST SERIAL PARSING
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n'); // Read the whole "packet"
    if (input.length() > 1) {
      char joint = input[0];
      int val = input.substring(1).toInt(); // Convert the rest to number

      if (joint == 'R') {
        targetB = CALIB_B; targetS = CALIB_S; targetE = CALIB_E; targetG = CALIB_G;
      } else if (joint == 'B') targetB = constrain(val, 0, 180);
      else if (joint == 'S') targetS = constrain(val, 10, 170);
      else if (joint == 'E') targetE = constrain(val, 30, 150);
      else if (joint == 'G') targetG = constrain(val, 20, 90);
    }
  }

  // B. NON-BLOCKING MOVEMENT
  if (millis() - lastMoveTime >= moveInterval) {
    lastMoveTime = millis();
    if (currB != targetB) { currB < targetB ? currB++ : currB--; base.write(currB); }
    if (currS != targetS) { currS < targetS ? currS++ : currS--; shoulder.write(currS); }
    if (currE != targetE) { currE < targetE ? currE++ : currE--; elbow.write(currE); }
    if (currG != targetG) { currG < targetG ? currG++ : currG--; gripper.write(currG); }
  }
}