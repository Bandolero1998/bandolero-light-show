# BANDOLERO LIGHT SHOW 1.2.0

Mobilna aplikacija (Expo SDK 58 / React Native 0.88 / TypeScript) za upravljanje garažom vozila, uživo OBD-II dijagnostiku i svetlosni šou (Light Show) sa strogom bezbednosnom proverom i UDS komunikacijom sa modulima vozila.

---

## 🚗 Prvo testno vozilo i adapter

- **Vozilo:** Audi A8 D4 4.2 TDI (2010. godište)
- **OBD Adapter:** Vgate / VLinker BM+ (Bluetooth LE dual mode)
- **Komunikacioni protokol:** ISO 15765-4 (CAN bus 11-bit / 500 kbaud)
- **Modul svetala:** Module 09 (Central Electrics BCM na CAN ID `0x710`)
- **Dijagnostički servis:** ISO 14229 UDS (Extended Session `10 03`, IO Control `2F ...`)

---

## 🌟 Ključne funkcije i implementacija

### 1. Bluetooth BLE & ELM327 / STN2120 Transporter
- Implementiran preko `react-native-ble-plx` sa podrškom za VLinker BM+, Vgate i ELM327 adaptere.
- Prepoznaje `vLinker BM-IOS`, `vLinker BM+`, `Vgate`, `iCar Pro` i druge adaptere pretražujući `device.name` i `device.localName`.
- Automatska inicijalizacija adaptera: `ATZ`, `ATE0`, `ATL0`, `ATS0`, `ATH0`, `ATAT1`, `ATAL` (ISO-TP multi-frame), `ATSP0` i merenje napona preko `ATRV`.
- Automatsko prepoznavanje UART GATT servisa (`FFF0`, `6E400001`, `FFE0`).

### 2. Prikaz stvarnih podataka vozila i dijagnostika (Diagnostics)
- **Podaci uživo (Mode 01):**
  - Broj obrtaja motora (RPM - PID `010C`)
  - Brzina kretanja vozila (Speed - PID `010D`)
  - Temperatura rashladne tečnosti (Coolant - PID `0105`)
  - Temperatura motornog ulja (Oil Temp - PID `015C`, karakteristično za VAG TDI)
  - Temperatura usisnog vazduha (Intake - PID `010F`)
  - Položaj leptira / pedale gasa (Throttle - PID `0111`)
  - Izračunato opterećenje motora (Load - PID `0104`)
  - Protok mase vazduha (MAF - PID `0110`)
  - Nivo goriva u rezervoaru (Fuel level - PID `012F`)
  - Pritisak goriva u Common Rail magistrali (Fuel rail pressure - PID `0123`)
  - Napon na OBD priključku / pin 16 (Voltage - `ATRV` i `0142`)
- **Dijagnostički kodovi grešaka (DTC):**
  - Status MIL upozoravajuće lampice (Check Engine)
  - Sačuvane greške motora (Mode 03 Stored DTCs)
  - Nepotvrđene greške motora (Mode 07 Pending DTCs)
  - Dekodiranje po SAE J2012 standardu (P0xxx, P1xxx, Uxxxx, itd.)
  - Funkcija brisanja grešaka (Mode 04 DTC Clear) sa bezbednosnim dijalogom potvrde.
- **Režim kontinualnog praćenja (Live Stream):** Automatsko periodično osvežavanje parametara u realnom vremenu.

### 3. Sistem za prepoznavanje podržanih funkcija vozila (Capabilities)
- Skenira Mode 01 PID bitmaske (`0100`, `0120`, `0140`, `0160`).
- Skenira Mode 09 PID 02 za očitavanje 17-cifrenog VIN broja šasije.
- Prilagođava live polling loop tako da ispituje samo senzore koje vozilo zaista podržava, eliminišući nepotrebna čekanja.

### 4. Light Show (Svetlosni šou) i komande vozilu
- **Dva operativna režima:**
  1. **📱 Ekranska simulacija (Visual Preview):**
     - Bezbedan grafički prikaz rada prednjih svetala, migavaca i DRL dioda na ekranu telefona.
     - Ne šalje podatke vozilu, služi za testiranje sekvenci.
  2. **🚗 Test na vozilu (VLinker BM+ & Audi A8 D4 Module 09):**
     - **Jasno označen:** `⚠️ ZAHTEVA FIZIČKO TESTIRANJE NA VOZILU`.
     - Šalje stvarne UDS komande na CAN ID `0x710` modulu komfora i centralne elektrike (BCM).
     - UDS Extended Session (`10 03`) i InputOutputControlByIdentifier (`2F ...`).
     - **Komandna konzola uživo:** Prikazuje sirovi TX i RX hex log (npr. `TX: ATSH710`, `RX: OK`, `TX: 2F010203`, `RX: 6F...`).

### 5. Bezbednosne provere (Safety Interlock)
- **Strogo mirovanje:** Svetlosni šou na vozilu je DOZVOLJEN SAMO kada je očitana brzina vozila **0 km/h**.
- **Obrtaji motora:** Motor mora biti ugašen (kontakt ON) ili u bezbednom leru (< 1100 RPM).
- **Automatski prekid (Failsafe):** Ako se detektuje kretanje vozila (brzina > 0 km/h) ili prekid veze, sekvenca se istog trenutka prekida i kontrola se vraća računaru vozila.
- **🚨 Prinudno zaustavljanje (PANIC STOP):** Dugme dostupno u svakom trenutku koje šalje `2F 00 00 00` (Return Control to ECU) i vraća modul u fabrički režim (`10 01`).

### 6. AI Dijagnostički asistent & Garaža
- Povezan sa standardnim OpenAI Chat Completions API (`gpt-4o-mini`, `gpt-4o`).
- Automatski prilaže aktivno vozilo (Audi A8 D4), očitane parametre uživo i DTC kodove grešaka.
- API ključ se trajno čuva u lokalnoj memoriji telefona.
- Kompletna garaža sa brzim šablonima za Audi, BMW, Mercedes i VW.

---

## 🛠️ Razvoj i testiranje

### Zahtevi:
- Node.js 20 ili 22
- npm 10+

### Pokretanje provera:
```bash
# Instalacija zavisnosti
npm install

# Pokretanje automatskih testova (16 unit testova)
npm test

# TypeScript typecheck (0 grešaka)
npm run typecheck

# Expo provera konfiguracije
npx expo-doctor
```

---

## 📱 Build konfiguracije (Android & iOS)

Aplikacija koristi Continuous Native Generation (CNG) prema Expo standardu.

### 1. Android (APK / AAB)
- `app.json` i `plugins/withBluetoothPermissions.js` automatski konfigurišu dozvole:
  - `BLUETOOTH_SCAN` (sa `neverForLocation` flagom za Android 12+)
  - `BLUETOOTH_CONNECT`
  - `ACCESS_FINE_LOCATION` (za Android 11 i starije)
- GitHub Actions workflow: `.github/workflows/android-build.yml`
- EAS Build konfiguracija u `eas.json` omogućava pravljenje standalone APK paketa:
  ```bash
  npx eas-cli build -p android --profile preview
  ```

### 2. iOS (Unsigned IPA / Development build)
- `infoPlist` sadrži `NSBluetoothAlwaysUsageDescription` i `NSBluetoothPeripheralUsageDescription`.
- GitHub Actions workflow: `.github/workflows/ios-unsigned.yml`
- EAS Build konfiguracija u `eas.json` (simulator ili ad-hoc).
