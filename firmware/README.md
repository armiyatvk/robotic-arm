# 0xhardcoded // ESP32 Control Firmware
**Low-Level Actuator Logic & Kinematic Safety**

### **Logic Architecture**
The firmware is designed for high-performance, lag-free hardware manipulation.
* **Non-Blocking Execution:** Replaced all `delay()` calls with a `millis()`-based state machine, allowing the arm to process Serial commands while moving.
* **Software Constraints:** Hardcoded safety limits protect the 3D-printed chassis:
    * **Elbow:** Constrained between 30° and 150°.
    * **Gripper:** Minimum 20° (Closed) to prevent gear binding.
* **Calibration State:** Tracks "Home" constants vs. live positions for precise homing.

### **Pin Mapping (ESP32)**
* **Base Rotation:** GPIO 14
* **Shoulder Flex:** GPIO 27
* **Elbow Extension:** GPIO 26
* **Gripper Claw:** GPIO 33

### **Setup Instructions**
1. Install the ESP32 board library in Arduino IDE.
2. Connect your ESP32 via USB-C.
3. Ensure the **Custom 5V Power Rail** is active to power the servos.
4. Upload `arm_controller.ino`.