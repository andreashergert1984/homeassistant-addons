## 2.83.0.8

- Geräte ohne Kamera (Wandgerät mit Handscanner): oben und unten mehr Rand, damit der Hinweis von Fully Kiosk ohne Lizenz die Modusknöpfe und die Knöpfe der Eingabeblätter nicht verdeckt.

## 2.83.0.7

- Kamera pro Gerät abschaltbar ("Kamera aus" im Kamerabild, "Kamera an" über der Liste), für Geräte mit Handscanner. Ohne Kamera läuft kein Kamerabild und kein Dekodieren mehr; der Platz geht an eine größere Statuszeile und die Liste "Zuletzt" mit den letzten acht Buchungen dieses Geräts (rückgängig gemachte durchgestrichen).

## 2.83.0.6

- Handscanner (USB oder Bluetooth-HID, z. B. NETUM L8BL Pro): Scans kommen jetzt auch an, wenn im HA-Panel die HA-Oberfläche um das Terminal den Fokus hat. Das Terminal hört dafür auf den äußeren HA-Rahmen mit (gleicher Ursprung über Ingress); nach einem Neuladen des Rahmens wird nichts doppelt gebucht, in Eingabefeldern bleibt der Scan im Feld.

## 2.83.0.5

- Kamera umschaltbar (Knopf "Kamera wechseln" im Kamerabild, wird im Geraet gemerkt): Frontkamera fuer ein Wandgeraet, vor dessen Display man den Artikel haelt. Bild der Frontkamera gespiegelt.
- Gut sichtbares Aufblitzen nach jedem Scan (gruen gebucht, orange letzter Bestand oder Fehlmenge, rot Fehler); Ton wird bei der ersten Beruehrung freigeschaltet.
- Dekodieren pausiert bei ausgeschaltetem Bildschirm (spart Akku).

## 2.83.0.4

- ZXing-Scanner korrigiert: decodeFromCanvas gibt es in der Bibliothek nicht, der Aufruf schlug jedes Bild still fehl. Jetzt per BinaryBitmap/HybridBinarizer/HTMLCanvasElementLuminanceSource und decodeBitmap, gegen echten EAN-13 geprueft.

## 2.83.0.3

- Scanner nutzt jetzt standardmaessig ZXing (reines JavaScript). Der native BarcodeDetector lief auf Android ueber die Google Play Services und liess die Home-Assistant-App auf Geraeten ohne Google (z. B. LineageOS ohne GApps) abstuerzen. Der native Detektor ist weiter per ?scanner=native (einmalig in der URL, wird gemerkt) waehlbar.
