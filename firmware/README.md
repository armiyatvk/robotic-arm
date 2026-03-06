# 0xhardcoded // ESP32 IoT Control Firmware
**Dual-Core Actuator Logic & Asynchronous Cloud Sync**

### **Logic Architecture**
This firmware is designed for high-performance, lag-free hardware manipulation by splitting tasks across the ESP32's two physical cores.

* **Core 0 (Network & Cloud):** Runs an isolated FreeRTOS task that maintains the Wi-Fi connection, authenticates with Firebase, polls for new database commands every 250ms, and sends a 5-second "Heartbeat" timestamp to the cloud.
* **Core 1 (Kinematics & Serial):** Runs the primary non-blocking `millis()` loop. It instantly parses incoming USB strings and updates the servos every 15ms. 
* **Asymptotic Easing Filter:** Instead of rigid 1-degree steps, the firmware uses float-based proportional math to accelerate and smoothly decelerate the servos as they approach their target coordinates.

### **Hardware Safety Constraints**
Hardcoded limits protect the 3D-printed chassis from tearing itself apart:
* **Elbow:** Constrained between 30° and 150°.
* **Gripper:** Minimum 20° (Closed) to prevent gear binding.

### **Pin Mapping (ESP32)**
* **Base Rotation:** GPIO 14
* **Shoulder Flex:** GPIO 27
* **Elbow Extension:** GPIO 26
* **Gripper Claw:** GPIO 33

### **Setup Instructions**
1. Install the `ESP32Servo` and `Firebase_ESP_Client` libraries in the Arduino IDE.
2. Duplicate the `secrets.example.h` file and rename it to `secrets.h`.
3. Add your specific Wi-Fi credentials and 39-character Firebase API key to `secrets.h`.
4. Connect the ESP32 via USB-C and ensure your external 5V servo power rail is active (with a shared ground).
5. Upload the sketch.