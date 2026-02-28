# 4-DOF Robotic Arm & Web-Controller
**A Full-Stack Hardware Engineering & IoT Integration Study**

### **Project Overview**
This project is a complete engineering loop bridging physical fabrication, power electronics, and modern web technologies. It features a custom 3D-printed 4-DOF robotic arm controlled in real-time via a Next.js interface using the Web Serial API.

### **The Engineering Challenge: Power Distribution Hack**
A key hurdle was the current draw of four simultaneous servos, which exceeded the ESP32’s onboard regulator capacity. 
* **The Solution:** I engineered a custom power distribution rail on a breadboard.
* **The Hack:** I manually modified a USB cable to provide a dedicated 5V power source directly to the servos, bypassing the microcontroller to prevent brownouts.
* **Stability:** Established a common ground between the MacBook Air, ESP32, and the external power rail to ensure signal integrity.

### **Technical Stack**
* **Fabrication:** Bambu Lab P1S (3D Printing).
* **Hardware:** ESP32 (Freenove WROOM), 4x MG90S Servos.
* **Frontend:** Next.js (React), Tailwind CSS, Web Serial API.
* **Firmware:** C++ (Arduino IDE) with non-blocking `millis()` logic.

### **Repository Structure**
* `/firmware`: ESP32 control logic and kinematic safety constraints.
* `/web-ui`: The Next.js component powering the interface on armiyatvk.com.
* `/docs`: System architecture diagrams and wiring schematics.