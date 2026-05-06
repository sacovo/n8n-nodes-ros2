# Rover-Automatisierung mit n8n und ROS2: Eine Einsteiger-Anleitung

Herzlich willkommen! In dieser Anleitung lernst du, wie du deinen Rover mit **n8n** automatisierst – ganz ohne komplexe Programmierung. Dein Rover läuft bereits mit **ROS2**, und die gesamte Umgebung inklusive **Docker** und den notwendigen Zugangsdaten (**Credentials**) ist bereits für dich vorbereitet.

---

## 1. Was ist n8n?

Stell dir **n8n** wie ein "Schweizer Taschenmesser" für Datenflüsse vor. Es ist ein Tool für die **Workflow-Automatisierung**, bei dem du verschiedene Dienste (wie Telegram, Wetter-APIs, Google Sheets) und eben auch deinen **Rover** über eine grafische Oberfläche miteinander verbindest.

Anstatt Code zu schreiben, ziehst du "Nodes" (Knotenpunkte) auf eine Arbeitsfläche und verbindest sie.

---

## 2. Wie das System funktioniert (Docker & ROS2)

Die Kommunikation zwischen n8n und deinem Rover ist bereits fertig eingerichtet:

1.  **ROS2 & Rosbridge**: Dein Rover kommuniziert über ROS2. Eine `rosbridge` stellt einen WebSocket bereit, über den n8n Befehle sendet und Daten empfängt.
2.  **Docker**: n8n und alle Abhängigkeiten laufen in Docker-Containern. Das garantiert eine stabile Umgebung, die sofort einsatzbereit ist.
3.  **Credentials**: Die Verbindung zum Rover ist in n8n bereits unter den "Credentials" hinterlegt. Du musst also keine IP-Adressen mehr suchen.

---

## 3. Erste Schritte: Start & Login

1.  Das System wird im Projektordner mit einem einfachen Befehl gestartet (falls es nicht schon läuft):
    ```bash
    docker-compose up -d
    ```
2.  Öffne deinen Browser unter `http://localhost:5678`.
3.  Du landest direkt auf der Arbeitsfläche, wo du deine Workflows gestalten kannst.

> **[Screenshot: Die n8n Arbeitsfläche mit der Node-Auswahl rechts]**

---

## 4. Die ROS2 Nodes: Deine Werkzeuge

In n8n hast du Zugriff auf spezielle Bausteine für den Rover:

-   **ROS2 Topic Trigger**: Reagiere sofort auf Ereignisse (z.B. "Batterie kritisch" oder "Ziel erreicht").
-   **ROS2 Topic Publish**: Sende einfache Befehle oder Daten (z.B. Status-LEDs ändern).
-   **ROS2 Service Call**: Führe eine gezielte Aktion aus und erhalte eine Bestätigung (z.B. "Greifarm schließen").
-   **ROS2 Action Start**: Starte langfristige Aufgaben (z.B. "Navigiere zu Raum A").

---

## 5. Logik ohne Grenzen: Loops, If-Else & Zeitpläne

n8n erlaubt es dir, komplexe Logik per Drag-and-Drop zu erstellen:

### A. Intelligente Entscheidungen (If-Node)
Filtere Daten, bevor der Rover reagiert.
*Beispiel:* Wenn der Batteriestand unter 20% sinkt, fahre zur Ladestation. Sonst fahre mit der Mission fort.

### B. Automatisierte Abläufe (Schedule-Node)
Lass deinen Rover jeden Tag um eine bestimmte Uhrzeit eine Aufgabe ausführen, ohne dass du eingreifen musst.

### C. Wiederholungen (Loops)
Arbeite Listen ab – zum Beispiel eine Liste von Koordinaten, die der Rover nacheinander anfahren soll.

---

## 6. Highlight: Interaktion mit Menschen (Formulare)

Eines der mächtigsten Features ist die Kombination von Roboter-Aktionen mit **menschlichen Entscheidungen**. Du kannst n8n so konfigurieren, dass es zwischendurch auf eine Eingabe wartet.

**Beispiel für einen hybriden Workflow:**
1.  **Trigger**: Der Rover erkennt ein unbekanntes Objekt auf seinem Weg.
2.  **Benachrichtigung**: n8n schickt dir eine Nachricht mit einem Link zu einem n8n-Formular.
3.  **Menschliche Eingabe**: Du öffnest das Formular auf deinem Handy, siehst das Kamerabild und wählst: "Objekt ignorieren" oder "Alternative Route wählen".
4.  **Service Call**: Erst nachdem du das Formular abgeschickt hast, sendet n8n den entsprechenden Befehl via **ROS2 Service Call** an den Rover zurück.

> **[Screenshot: Ein Workflow, bei dem ein 'Wait'-Node oder ein Formular-Node zwischen zwei ROS2-Aktionen steht]**

---

## 7. Beispiel: "Sicherer Paket-Transport"

Stellen wir uns eine Auslieferung vor:

1.  **Start**: Ein Mitarbeiter füllt ein n8n-Formular aus (Zielort & Paket-ID).
2.  **Action**: n8n startet den **ROS2 Action Start**-Befehl für die Navigation.
3.  **Warten**: Der Workflow pausiert, bis der Rover "Ziel erreicht" meldet (**Topic Trigger**).
4.  **Bestätigung**: n8n schickt eine E-Mail an den Empfänger mit einem Button: "Fach öffnen".
5.  **Service Call**: Erst wenn der Empfänger klickt, wird der **ROS2 Service Call** "Unlock" ausgeführt.

---

## 8. Fazit

n8n nimmt die Komplexität aus der Roboter-Programmierung. Du kannst deinen Rover mit fast jedem Web-Dienst verbinden und komplexe, interaktive Szenarien in wenigen Minuten zusammenklicken.

Viel Erfolg bei deiner ersten Mission!
