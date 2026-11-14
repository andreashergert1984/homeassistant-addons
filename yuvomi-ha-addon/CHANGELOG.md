## 2.83.0.4

- ZXing-Scanner korrigiert: decodeFromCanvas gibt es in der Bibliothek nicht, der Aufruf schlug jedes Bild still fehl. Jetzt per BinaryBitmap/HybridBinarizer/HTMLCanvasElementLuminanceSource und decodeBitmap, gegen echten EAN-13 geprueft.

## 2.83.0.3

- Scanner nutzt jetzt standardmaessig ZXing (reines JavaScript). Der native BarcodeDetector lief auf Android ueber die Google Play Services und liess die Home-Assistant-App auf Geraeten ohne Google (z. B. LineageOS ohne GApps) abstuerzen. Der native Detektor ist weiter per ?scanner=native (einmalig in der URL, wird gemerkt) waehlbar.
