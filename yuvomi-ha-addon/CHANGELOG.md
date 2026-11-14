## 2.83.0.3

- Scanner nutzt jetzt standardmaessig ZXing (reines JavaScript). Der native BarcodeDetector lief auf Android ueber die Google Play Services und liess die Home-Assistant-App auf Geraeten ohne Google (z. B. LineageOS ohne GApps) abstuerzen. Der native Detektor ist weiter per ?scanner=native (einmalig in der URL, wird gemerkt) waehlbar.
