/**
 * BANDOLERO LIGHT SHOW 1.2.0
 * Light Show Controller & Vehicle Actuator Driver
 *
 * Implements:
 * 1. Visual on-screen simulation mode for mobile preview (headlight white/xenon color).
 * 2. Real vehicle hardware actuation for Audi A8 D4 4.2 TDI (2010) and VAG platforms
 *    using ISO 14229 UDS (Unified Diagnostic Services) on Module 09 (Central Electrics BCM).
 * 3. Police-style Wig-Wag, Triple Strobe, Dual Sync, Pursuit, and Interceptor headlight modes.
 * 4. Real-time safety validation with automatic emergency stop (failsafe).
 * 5. Transparent TX/RX command logging so the user sees exactly what commands are exchanged with the car.
 */

import { ObdBleClient } from './obd-ble';
import { Elm327Protocol } from './elm327-protocol';
import { SafetyInterlock } from './safety-interlock';

export type LightEffectId =
  | 'police_wigwag'
  | 'police_triple'
  | 'police_sync'
  | 'police_pursuit'
  | 'police_interceptor'
  | 'welcome'
  | 'pulse'
  | 'sweep'
  | 'hazard'
  | 'highbeam';

export type LightEffect = {
  id: LightEffectId;
  index: string;
  name: string;
  description: string;
  category: 'POLICE HEADLIGHT' | 'STANDARD';
  requiresVehicleTesting: boolean;
  colors: string[];
  estimatedDurationMs: number;
};

export const AVAILABLE_EFFECTS: LightEffect[] = [
  {
    id: 'police_wigwag',
    index: '01',
    name: 'POLICE WIG-WAG (2x L / 2x D)',
    description: 'Klasično policijsko duplo blicanje: levi far 2x, pa desni far 2x u boji fara',
    category: 'POLICE HEADLIGHT',
    requiresVehicleTesting: true,
    colors: ['#FFFFFF', '#E0F2FE'],
    estimatedDurationMs: 4000,
  },
  {
    id: 'police_triple',
    index: '02',
    name: 'POLICE TRIPLE STROBE (3x RAFAL)',
    description: 'Agresivni trostruki stroboskopski blic: 3x levi far pa 3x desni far',
    category: 'POLICE HEADLIGHT',
    requiresVehicleTesting: true,
    colors: ['#F8FAFC', '#BAE6FD'],
    estimatedDurationMs: 4200,
  },
  {
    id: 'police_sync',
    index: '03',
    name: 'POLICE DUAL SYNC (OBA FARA)',
    description: 'Sinhroni brzi dupli blic oba fara istovremeno sa kratkom pauzom',
    category: 'POLICE HEADLIGHT',
    requiresVehicleTesting: true,
    colors: ['#FFFFFF', '#F1F5F9'],
    estimatedDurationMs: 3600,
  },
  {
    id: 'police_pursuit',
    index: '04',
    name: 'POLICE PURSUIT (FAR + MAGLENKE)',
    description: 'Brza potera: unakrsno blicanje farova i prednjih maglenki u boji fara',
    category: 'POLICE HEADLIGHT',
    requiresVehicleTesting: true,
    colors: ['#FFFFFF', '#E2E8F0'],
    estimatedDurationMs: 4500,
  },
  {
    id: 'police_interceptor',
    index: '05',
    name: 'POLICE INTERCEPTOR (BRZA SMENA)',
    description: 'Ultra-brza smena levi/desni far + DRL strob efekat bez pauze',
    category: 'POLICE HEADLIGHT',
    requiresVehicleTesting: true,
    colors: ['#F8FAFC', '#CBD5E1'],
    estimatedDurationMs: 4000,
  },
  {
    id: 'welcome',
    index: '06',
    name: 'WELCOME SEQUENCE',
    description: 'Pozdravna sekvenca: poziciona svetla, leva/desna strana, DRL i gašenje',
    category: 'STANDARD',
    requiresVehicleTesting: true,
    colors: ['#F8FAFC', '#EF4444'],
    estimatedDurationMs: 4000,
  },
  {
    id: 'pulse',
    index: '07',
    name: 'STROBE PULSE',
    description: 'Kratki sinhronizovani svetlosni impulsi farova i pozicija',
    category: 'STANDARD',
    requiresVehicleTesting: true,
    colors: ['#FFFFFF', '#FCA5A5'],
    estimatedDurationMs: 3000,
  },
  {
    id: 'sweep',
    index: '08',
    name: 'LEFT / RIGHT SWEEP',
    description: 'Naizmenično aktiviranje levog pa desnog pokazivača pravca',
    category: 'STANDARD',
    requiresVehicleTesting: true,
    colors: ['#F59E0B', '#FDE68A'],
    estimatedDurationMs: 4500,
  },
  {
    id: 'hazard',
    index: '09',
    name: 'HAZARD STROBE',
    description: 'Sinhroni test svih 4 migavca u ritmu svetlosnog šoua',
    category: 'STANDARD',
    requiresVehicleTesting: true,
    colors: ['#F59E0B', '#FCD34D'],
    estimatedDurationMs: 3500,
  },
  {
    id: 'highbeam',
    index: '10',
    name: 'HIGH BEAM FLASH',
    description: 'Test blicanja dugim svetlima i prednjim maglenkama u mestu',
    category: 'STANDARD',
    requiresVehicleTesting: true,
    colors: ['#FFFFFF', '#E0F2FE'],
    estimatedDurationMs: 3000,
  },
];

export type CommandLogEntry = {
  timestamp: number;
  direction: 'TX' | 'RX' | 'INFO' | 'ERROR';
  text: string;
};

export type Uds2fResult = {
  accepted: boolean;
  nrc?: string;
  nrcDescription?: string;
  rawClean: string;
};

export type DiscoveredDid = {
  did: string;
  status: '6F' | 'NRC';
  nrc?: string;
  detail: string;
};

export type Module09ScanResult = {
  targetLabel: string;
  partNumber: string | null;
  systemName: string | null;
  sessionResponse: string;
  discoveredDids: DiscoveredDid[];
  scannedCount: number;
};

export function decodeUdsAsciiPayload(rawResponse: string, expectedPositivePrefix: string): string | null {
  const clean = Elm327Protocol.reassembleIsoTp(rawResponse);
  const prefix = expectedPositivePrefix.toUpperCase();
  const idx = clean.indexOf(prefix);
  if (idx === -1) return null;
  const payload = clean.slice(idx + prefix.length);
  let ascii = '';
  for (let i = 0; i + 1 < payload.length; i += 2) {
    const code = parseInt(payload.slice(i, i + 2), 16);
    if (code >= 32 && code <= 126) {
      ascii += String.fromCharCode(code);
    }
  }
  const trimmed = ascii.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const UDS_NRC_DESCRIPTIONS: Record<string, string> = {
  '11': 'ServiceNotSupported (usluga 2F nije podržana)',
  '12': 'SubFunctionNotSupported (nepodržana podfunkcija)',
  '13': 'IncorrectMessageLengthOrInvalidFormat (pogrešna dužina ili format poruke)',
  '22': 'ConditionsNotCorrect (pogrešni uslovi — proveri kontakt / motor / brzinu)',
  '24': 'RequestSequenceError (pogrešan redosled komandi)',
  '31': 'RequestOutOfRange (pogrešan DID — adresa ne postoji na BCM1)',
  '33': 'SecurityAccessDenied (potreban Security Access za Modul 09)',
  '78': 'ResponsePending (modul obrađuje zahtev)',
  '7E': 'SubFunctionNotSupportedInActiveSession (ne radi u trenutnoj sesiji)',
  '7F': 'ServiceNotSupportedInActiveSession (2F nije podržan u ovoj sesiji)',
};

export function parseUds2fResponse(rawResponse: string): Uds2fResult {
  const clean = Elm327Protocol.cleanResponse(rawResponse);
  if (clean.includes('6F')) {
    return { accepted: true, rawClean: clean };
  }
  const negMatch = clean.match(/7F2F([0-9A-F]{2})/);
  if (negMatch) {
    const nrc = negMatch[1];
    return {
      accepted: false,
      nrc,
      nrcDescription: UDS_NRC_DESCRIPTIONS[nrc] || `Nepoznat UDS NRC kod (0x${nrc})`,
      rawClean: clean,
    };
  }
  const anyNeg = clean.match(/7F[0-9A-F]{2}([0-9A-F]{2})/);
  if (anyNeg) {
    const nrc = anyNeg[1];
    return {
      accepted: false,
      nrc,
      nrcDescription: UDS_NRC_DESCRIPTIONS[nrc] || `UDS negativan odgovor (NRC 0x${nrc})`,
      rawClean: clean,
    };
  }
  return {
    accepted: false,
    nrcDescription: clean ? `Neočekivan odgovor (${clean})` : 'Nema odgovora (NO DATA)',
    rawClean: clean,
  };
}

export class LightShowController {
  private client: ObdBleClient | null = null;
  private isRunning = false;
  private abortRequested = false;
  private udsSessionActive = false;
  private testerPresentTimer: ReturnType<typeof setInterval> | null = null;
  private logCallback?: (entry: CommandLogEntry) => void;
  private actuatorStats: {
    accepted: number;
    rejected: number;
    lastNrc?: string;
    lastNrcDescription?: string;
  } = { accepted: 0, rejected: 0 };

  /**
   * Audi A8 D4 (4H) / VAG UDS physical CAN Tx/Rx pairs for Module 09 (BCM1 / Central Electrics).
   * Primary: 0x70E -> 0x778 (standard VAG UDS Module 09 BCM1)
   * Fallback: 0x710 -> 0x77A (alternate VAG gateway/BCM addressing)
   */
  private static readonly MODULE09_TARGETS = [
    { tx: '70E', rx: '778', label: 'Modul 09 BCM1 (0x70E / 0x778)' },
    { tx: '710', rx: '77A', label: 'Modul 09 alt (0x710 / 0x77A)' },
  ];

  constructor(client: ObdBleClient | null, onLog?: (entry: CommandLogEntry) => void) {
    this.client = client;
    this.logCallback = onLog;
  }

  setClient(client: ObdBleClient | null) {
    this.client = client;
  }

  private log(direction: CommandLogEntry['direction'], text: string) {
    this.logCallback?.({ timestamp: Date.now(), direction, text });
  }

  /**
   * Waits briefly for any in-flight BLE command (e.g. background polling) to finish
   * so our UDS/AT commands do not collide with "OBD komunikacija je zauzeta".
   */
  private async waitUntilIdle(maxWaitMs = 2000): Promise<void> {
    let waited = 0;
    while (this.client?.isBusy && waited < maxWaitMs) {
      await new Promise(r => setTimeout(r, 50));
      waited += 50;
    }
  }

  /**
   * Starts UDS TesterPresent (3E 80) keep-alive timer every 2 seconds
   * so Module 09 (BCM1) does not drop the Extended Diagnostic Session.
   */
  private startTesterPresentLoop() {
    this.stopTesterPresentLoop();
    this.testerPresentTimer = setInterval(() => {
      if (this.abortRequested || !this.isRunning || !this.client?.isConnected) {
        this.stopTesterPresentLoop();
        return;
      }
      if (this.client.isBusy) {
        return; // Skip tick if another UDS frame is currently in flight
      }
      this.exec('3E 80', 1200).catch(() => {
        // Suppress positive response (0x80) may not return a data frame on all ECUs
      });
    }, 2000);
  }

  private stopTesterPresentLoop() {
    if (this.testerPresentTimer) {
      clearInterval(this.testerPresentTimer);
      this.testerPresentTimer = null;
    }
  }

  /**
   * Sends a low-level command to the vehicle adapter and logs both TX and RX.
   */
  private async exec(cmd: string, timeout = 3000): Promise<string> {
    if (!this.client || !this.client.isConnected) {
      throw new Error('OBD adapter nije povezan. Poveži VLinker BM+ u Settings tabu.');
    }
    this.log('TX', cmd);
    try {
      const rx = await this.client.command(cmd, timeout);
      this.log('RX', rx.replace(/[\r\n>]/g, ' ').trim() || 'OK');
      return rx;
    } catch (e: any) {
      this.log('ERROR', `Greška pri slanju ${cmd}: ${e?.message || e}`);
      throw e;
    }
  }

  /**
   * Delay helper with early abort check.
   */
  private async sleep(ms: number): Promise<void> {
    const step = 40;
    let elapsed = 0;
    while (elapsed < ms) {
      if (this.abortRequested) break;
      await new Promise(r => setTimeout(r, step));
      elapsed += step;
    }
  }

  /**
   * Sends a UDS 0x2F (IO Control) actuator command and evaluates 6F (positive) vs 7F (negative).
   */
  private async exec2f(cmd: string, timeout = 1500): Promise<Uds2fResult> {
    const rx = await this.exec(cmd, timeout);
    const parsed = parseUds2fResponse(rx);
    if (parsed.accepted) {
      this.actuatorStats.accepted++;
    } else {
      this.actuatorStats.rejected++;
      if (parsed.nrc) {
        this.actuatorStats.lastNrc = parsed.nrc;
        this.actuatorStats.lastNrcDescription = parsed.nrcDescription;
      } else if (!this.actuatorStats.lastNrcDescription) {
        this.actuatorStats.lastNrcDescription = parsed.nrcDescription;
      }
    }
    return parsed;
  }

  /**
   * Pulses a specific UDS IO Control actuator a given number of times.
   */
  private async pulseActuator(didHex: string, count: number, onMs: number, offMs: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      if (this.abortRequested) break;
      await this.exec2f(`2F${didHex}03`, 1500);
      await this.sleep(onMs);
      await this.exec2f(`2F${didHex}00`, 1500);
      if (i < count - 1) {
        await this.sleep(offMs);
      }
    }
  }

  /**
   * Emergency Stop / Failsafe:
   * Stops TesterPresent loop, sends ECU release commands to Module 09,
   * returns to Default Session (10 01), and restores standard OBD-II header (ATSH 7DF).
   */
  async emergencyStop(): Promise<void> {
    this.abortRequested = true;
    this.isRunning = false;
    this.stopTesterPresentLoop();
    this.log('INFO', '🚨 PRINUDNO ZAUSTAVLJANJE (EMERGENCY STOP) POKRENUTO!');

    if (this.client && this.client.isConnected) {
      try {
        await this.waitUntilIdle(1500);
        if (this.udsSessionActive) {
          await this.exec('2F000000', 1500).catch(() => {});
          await this.exec('10 01', 1500).catch(() => {});
          this.udsSessionActive = false;
        }
        await this.exec('ATSH 7DF', 1500).catch(() => {});
        await this.exec('ATCRA', 1500).catch(() => {});
        this.log('INFO', 'Kontrola svetala vraćena računaru vozila (10 01 / ATSH 7DF).');
      } catch (err: any) {
        this.log('ERROR', `Greška pri bezbednosnom resetovanju: ${err?.message}`);
      } finally {
        this.client.resumePolling?.();
      }
    } else {
      this.udsSessionActive = false;
      this.log('ERROR', 'OBD adapter nije povezan — lokalno zaustavljeno.');
    }
  }

  /**
   * Executes a physical actuator light test sequence on the vehicle.
   * Targets Audi A8 D4 Module 09 (Central Electrics BCM1: 0x70E/0x778, fallback 0x710/0x77A).
   */
  async runVehicleSequence(
    effectId: LightEffectId,
    onProgress?: (step: string, percent: number) => void
  ): Promise<{ success: boolean; message: string }> {
    if (this.isRunning) {
      throw new Error('Sekvenca je već u toku.');
    }

    if (!this.client || !this.client.isConnected) {
      throw new Error('OBD adapter nije povezan. Prvo poveži VLinker BM+ u Settings tabu.');
    }

    // Temporarily pause background live polling (and wait for any in-flight PID frame to finish)
    if (typeof this.client.pausePolling === 'function') {
      this.client.pausePolling();
    } else {
      this.client.stopPolling();
    }
    await this.waitUntilIdle(2000);

    this.isRunning = true;
    this.abortRequested = false;
    this.udsSessionActive = false;
    this.actuatorStats = { accepted: 0, rejected: 0 };

    this.log('INFO', `Započinjem sekvencu "${effectId.toUpperCase()}" na vozilu Audi A8 D4.`);
    this.log('INFO', 'Korak 1: Resetovanje CAN headera (7DF) i provera brzine (010D).');

    try {
      // Step 1: Restore standard OBD-II CAN header & clear RX filter BEFORE querying PID 010D
      onProgress?.('Resetovanje CAN headera (ATSH 7DF / ATCRA)...', 10);
      await this.exec('ATSH 7DF', 2000);
      await this.exec('ATCRA', 2000);

      // Query vehicle speed (PID 010D -> Mode 01, PID 0D)
      onProgress?.('Provera brzine vozila (PID 010D)...', 18);
      const speedRaw = await this.exec('010D', 3000);
      const parsedSpeed = Elm327Protocol.parsePidValue('0D', speedRaw);
      const speed = typeof parsedSpeed === 'number' ? parsedSpeed : undefined;

      // Query RPM (PID 010C -> Mode 01, PID 0C) if available
      let rpm: number | undefined;
      try {
        const rpmRaw = await this.exec('010C', 2500);
        const parsedRpm = Elm327Protocol.parsePidValue('0C', rpmRaw);
        rpm = typeof parsedRpm === 'number' ? parsedRpm : undefined;
      } catch {}

      const safety = SafetyInterlock.evaluate(
        { speed, rpm, dtcs: [], pendingDtcs: [], permanentDtcs: [], timestamp: Date.now() },
        true,
        false
      );
      if (!safety.isSafe) {
        throw new Error(
          safety.criticalLockReason || 'Bezbednosna provera nije prošla. Vozilo mora bezbedno mirovati (0 km/h).'
        );
      }
      this.log('INFO', `Bezbednost potvrđena: brzina ${speed} km/h${rpm !== undefined ? `, obrtaji ${Math.round(rpm)} RPM` : ''}.`);

      // Step 2 & 3: ONLY AFTER confirming speed === 0 km/h, switch CAN header + RX filter to Module 09
      // and open UDS Extended Diagnostic Session (10 03).
      let activeTarget = LightShowController.MODULE09_TARGETS[0];
      let sessionOpened = false;

      for (const target of LightShowController.MODULE09_TARGETS) {
        if (this.abortRequested) break;
        onProgress?.(`Povezivanje na ${target.label}...`, 32);
        await this.exec(`ATSH ${target.tx}`, 2000);
        await this.exec(`ATCRA ${target.rx}`, 2000);

        onProgress?.(`Otvaranje UDS Extended Session (10 03) na 0x${target.tx}...`, 42);
        const sessionResp = await this.exec('10 03', 3000);
        const cleanSession = Elm327Protocol.cleanResponse(sessionResp);

        if (cleanSession.includes('5003')) {
          activeTarget = target;
          sessionOpened = true;
          this.udsSessionActive = true;
          this.log('INFO', `UDS Extended Session aktivna na ${target.label} — pokrećem TesterPresent (3E 80) na 2s.`);
          break;
        }

        if (cleanSession.includes('7F10')) {
          activeTarget = target;
          this.udsSessionActive = true;
          this.log('INFO', `${target.label} je odgovorio sa 7F 10 (Extended Session odbijen — nastavljam test / proveriti kontakt).`);
          break;
        }

        this.log('INFO', `${target.label} nije odgovorio na 10 03 (NO DATA) — probam sledeću CAN adresu...`);
      }

      if (!sessionOpened && !this.udsSessionActive) {
        // Keep last target active so user still sees actuator TX/RX diagnostics on vehicle
        this.udsSessionActive = true;
        this.log('INFO', `Nije dobijen 50 03 odgovor ni na 0x70E ni na 0x710 — šaljem komande na ${activeTarget.label}.`);
      }

      this.startTesterPresentLoop();

      // Step 4: Execute effect specific actuator pulses
      onProgress?.(`Izvršavanje svetlosnog efekta ${effectId}...`, 60);

      if (effectId === 'police_wigwag') {
        // Classic Police Wig-Wag: Left headlight 2x -> Right headlight 2x (3 cycles)
        for (let c = 0; c < 3 && !this.abortRequested; c++) {
          await this.pulseActuator('0105', 2, 120, 90);
          await this.sleep(100);
          await this.pulseActuator('0106', 2, 120, 90);
          await this.sleep(100);
        }
      } else if (effectId === 'police_triple') {
        // Aggressive Police Triple Strobe: Left 3x -> Right 3x (2 cycles)
        for (let c = 0; c < 2 && !this.abortRequested; c++) {
          await this.pulseActuator('0105', 3, 90, 75);
          await this.sleep(120);
          await this.pulseActuator('0106', 3, 90, 75);
          await this.sleep(120);
        }
      } else if (effectId === 'police_sync') {
        // Dual Sync Police Flash: Both headlights double-flash together with pause
        for (let c = 0; c < 3 && !this.abortRequested; c++) {
          for (let f = 0; f < 2 && !this.abortRequested; f++) {
            await this.exec2f('2F010503', 1500);
            await this.exec2f('2F010603', 1500);
            await this.sleep(110);
            await this.exec2f('2F010500', 1500);
            await this.exec2f('2F010600', 1500);
            await this.sleep(90);
          }
          await this.sleep(320);
        }
      } else if (effectId === 'police_pursuit') {
        // Cross-pattern: Left High + Right Fog -> Right High + Left Fog
        for (let c = 0; c < 3 && !this.abortRequested; c++) {
          await this.exec2f('2F010503', 1500);
          await this.exec2f('2F010803', 1500);
          await this.sleep(140);
          await this.exec2f('2F010500', 1500);
          await this.exec2f('2F010800', 1500);
          await this.sleep(80);
          await this.exec2f('2F010603', 1500);
          await this.exec2f('2F010703', 1500);
          await this.sleep(140);
          await this.exec2f('2F010600', 1500);
          await this.exec2f('2F010700', 1500);
          await this.sleep(80);
        }
      } else if (effectId === 'police_interceptor') {
        // Rapid alternating L -> R -> L -> R
        for (let c = 0; c < 5 && !this.abortRequested; c++) {
          await this.pulseActuator('0105', 1, 100, 0);
          await this.sleep(60);
          await this.pulseActuator('0106', 1, 100, 0);
          await this.sleep(60);
        }
      } else if (effectId === 'welcome' || effectId === 'sweep') {
        await this.exec2f('2F010203', 2000);
        await this.sleep(400);
        await this.exec2f('2F010200', 2000);
        await this.sleep(200);
        await this.exec2f('2F010303', 2000);
        await this.sleep(400);
        await this.exec2f('2F010300', 2000);
      } else if (effectId === 'pulse' || effectId === 'hazard') {
        for (let cycle = 0; cycle < 2 && !this.abortRequested; cycle++) {
          await this.exec2f('2F010203', 1500);
          await this.exec2f('2F010303', 1500);
          await this.sleep(350);
          await this.exec2f('2F010200', 1500);
          await this.exec2f('2F010300', 1500);
          await this.sleep(250);
        }
      } else if (effectId === 'highbeam') {
        await this.exec2f('2F010503', 2000);
        await this.sleep(400);
        await this.exec2f('2F010500', 2000);
      }

      onProgress?.('Vraćanje kontrole modulu vozila (10 01 / ATSH 7DF)...', 90);

      // Step 5: Clean teardown — stop TesterPresent, return actuators, restore default session & OBD header
      this.stopTesterPresentLoop();
      await this.exec('10 01', 2000).catch(() => {});
      this.udsSessionActive = false;
      await this.exec('ATSH 7DF', 2000).catch(() => {});
      await this.exec('ATCRA', 2000).catch(() => {});

      onProgress?.('Sekvenca završena.', 100);

      if (this.actuatorStats.accepted === 0) {
        const nrcCode = this.actuatorStats.lastNrc ? `7F 2F ${this.actuatorStats.lastNrc}` : 'bez 6F odgovora';
        const reason = this.actuatorStats.lastNrcDescription || 'Modul 09 nije prihvatio 2F komande.';
        const warningMsg = `Modul 09 je odbio komande (${nrcCode}): ${reason}. Nijedna 2F komanda nije vratila pozitivan 6F odgovor — upotrebi Manual 2F DID Tester ispod da pronađeš ispravnu DID adresu za tvoj BCM1.`;
        this.log('ERROR', warningMsg);
        return { success: false, message: warningMsg };
      }

      this.log('INFO', `Sekvenca završena (${this.actuatorStats.accepted} prihvaćenih 6F komandi). Kontrola vraćena računaru (10 01 / ATSH 7DF).`);
      return {
        success: true,
        message: `Modul 09 je prihvatio ${this.actuatorStats.accepted} komandi (pozitivan 6F odgovor).`,
      };
    } catch (error: any) {
      this.stopTesterPresentLoop();
      this.log('ERROR', `Prekid sekvence: ${error?.message || error}`);
      await this.emergencyStop();
      throw error;
    } finally {
      this.stopTesterPresentLoop();
      this.udsSessionActive = false;
      this.isRunning = false;
      this.client?.resumePolling?.();
    }
  }

  /**
   * Manual 2F DID Tester for live Audi A8 D4 BCM1 discovery:
   * 1. Verifies vehicle is stationary (ATSH 7DF -> ATCRA -> 010D == 0 km/h)
   * 2. Connects to Module 09 (0x70E/0x778, fallback 0x710/0x77A) & opens Extended Session (10 03)
   * 3. Sends 2F <DID> 03 <STATE> (default 01 = ON), logs 6F vs 7F immediately
   * 4. Waits 1.5s, sends 2F <DID> 00 (ReturnControlToECU = OFF)
   * 5. Restores Default Session (10 01) and OBD header (ATSH 7DF / ATCRA)
   */
  async testManualDid(
    didInput: string,
    controlStateInput = '01'
  ): Promise<{ accepted: boolean; did: string; nrc?: string; message: string }> {
    if (this.isRunning) {
      throw new Error('Sekvenca je već u toku.');
    }
    if (!this.client || !this.client.isConnected) {
      throw new Error('OBD adapter nije povezan. Prvo poveži VLinker BM+ u Settings tabu.');
    }

    const cleanDid = didInput.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    if (cleanDid.length !== 4) {
      throw new Error('Unesi tačno 4 hex karaktera za DID (npr. F123 ili 3B10).');
    }

    const cleanState = controlStateInput.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    if (cleanState.length > 0 && cleanState.length % 2 !== 0) {
      throw new Error('Control state mora imati paran broj hex cifara (npr. 01 ili 64).');
    }

    if (typeof this.client.pausePolling === 'function') {
      this.client.pausePolling();
    } else {
      this.client.stopPolling();
    }
    await this.waitUntilIdle(2000);

    this.isRunning = true;
    this.abortRequested = false;
    this.udsSessionActive = false;

    this.log('INFO', `=== MANUAL 2F DID TEST: 0x${cleanDid} (state: ${cleanState || 'bez bajta'}) ===`);

    try {
      // 1. Stationary speed check
      await this.exec('ATSH 7DF', 2000);
      await this.exec('ATCRA', 2000);
      const speedRaw = await this.exec('010D', 3000);
      const parsedSpeed = Elm327Protocol.parsePidValue('0D', speedRaw);
      const speed = typeof parsedSpeed === 'number' ? parsedSpeed : undefined;
      if (speed === undefined) {
        throw new Error('Brzina vozila (PID 010D) nije očitana.');
      }
      if (speed > 0) {
        throw new Error(`VOZILO U POKRETU (${speed} km/h) — test je blokiran dok vozilo ne stane.`);
      }

      // 2. Connect to Module 09 & open Extended Session (10 03)
      for (const target of LightShowController.MODULE09_TARGETS) {
        await this.exec(`ATSH ${target.tx}`, 2000);
        await this.exec(`ATCRA ${target.rx}`, 2000);
        const sess = await this.exec('10 03', 3000);
        const cleanSess = Elm327Protocol.cleanResponse(sess);
        if (cleanSess.includes('5003') || cleanSess.includes('7F10')) {
          this.udsSessionActive = true;
          this.log('INFO', `Modul 09 aktivan na ${target.label} (${cleanSess}).`);
          break;
        }
      }
      this.udsSessionActive = true;

      // 3. Send 2F <DID> 03 <STATE> (ShortTermAdjustment - ON)
      const onCmd = `2F${cleanDid}03${cleanState}`;
      const onResp = await this.exec(onCmd, 2500);
      const parsed = parseUds2fResponse(onResp);

      if (parsed.accepted) {
        this.log('INFO', `✅ DID 0x${cleanDid} RADI! Pozitivan odgovor: ${parsed.rawClean}`);
      } else {
        const nrcTag = parsed.nrc ? `7F 2F ${parsed.nrc}` : 'ODBIJENO';
        this.log('ERROR', `❌ DID 0x${cleanDid} NE RADI (${nrcTag}): ${parsed.nrcDescription}`);
      }

      // 4. Wait 1.5s then send ReturnControlToECU (2F <DID> 00)
      await this.sleep(1500);
      await this.exec(`2F${cleanDid}00`, 2000).catch(() => {});

      // 5. Cleanly restore Default Session & OBD-II header
      await this.exec('10 01', 2000).catch(() => {});
      this.udsSessionActive = false;
      await this.exec('ATSH 7DF', 2000).catch(() => {});
      await this.exec('ATCRA', 2000).catch(() => {});

      if (parsed.accepted) {
        return {
          accepted: true,
          did: cleanDid,
          message: `✅ DID 0x${cleanDid} RADI! Modul 09 je vratio pozitivan odgovor (${parsed.rawClean}) i kontrola je vraćena posle 1.5s.`,
        };
      }
      const nrcLabel = parsed.nrc ? `7F 2F ${parsed.nrc}` : parsed.rawClean || 'NO DATA';
      return {
        accepted: false,
        did: cleanDid,
        nrc: parsed.nrc,
        message: `❌ DID 0x${cleanDid} NE RADI (${nrcLabel}): ${parsed.nrcDescription}`,
      };
    } catch (error: any) {
      this.log('ERROR', `Prekid DID testa: ${error?.message || error}`);
      await this.emergencyStop();
      throw error;
    } finally {
      this.udsSessionActive = false;
      this.isRunning = false;
      this.client?.resumePolling?.();
    }
  }

  /**
   * Reads Audi A8 D4 Module 09 (BCM1) Part Number (22 F1 87) & System Name (22 F1 97),
   * opens Extended Session (10 03), and safely scans common VAG UDS 0x2F DID ranges
   * using non-destructive ReturnControlToECU (2F <DID> 00) to discover all supported DIDs.
   */
  async scanModule09Dids(
    onProgress?: (step: string, percent: number) => void
  ): Promise<Module09ScanResult> {
    if (this.isRunning) {
      throw new Error('Sekvenca je već u toku.');
    }
    if (!this.client || !this.client.isConnected) {
      throw new Error('OBD adapter nije povezan. Prvo poveži VLinker BM+ u Settings tabu.');
    }

    if (typeof this.client.pausePolling === 'function') {
      this.client.pausePolling();
    } else {
      this.client.stopPolling();
    }
    await this.waitUntilIdle(2000);

    this.isRunning = true;
    this.abortRequested = false;
    this.udsSessionActive = false;

    this.log('INFO', '=== SKENIRANJE MODULA 09 (PART # + 2F DID DISCOVERY) ===');

    try {
      // 1. Stationary safety check
      onProgress?.('Provera mirovanja (ATSH 7DF / 010D)...', 5);
      await this.exec('ATSH 7DF', 2000);
      await this.exec('ATCRA', 2000);
      const speedRaw = await this.exec('010D', 3000);
      const parsedSpeed = Elm327Protocol.parsePidValue('0D', speedRaw);
      const speed = typeof parsedSpeed === 'number' ? parsedSpeed : undefined;
      if (speed === undefined) {
        throw new Error('Brzina vozila (PID 010D) nije očitana.');
      }
      if (speed > 0) {
        throw new Error(`VOZILO U POKRETU (${speed} km/h) — skeniranje je blokirano dok vozilo ne stane.`);
      }

      // 2. Identify active Module 09 target & read Part Number (22 F1 87) + System Name (22 F1 97)
      let activeTarget = LightShowController.MODULE09_TARGETS[0];
      let partNumber: string | null = null;
      let systemName: string | null = null;
      let sessionResponse = 'NO DATA';

      for (const target of LightShowController.MODULE09_TARGETS) {
        if (this.abortRequested) break;
        onProgress?.(`Identifikacija ${target.label} (22 F1 87)...`, 12);
        await this.exec(`ATSH ${target.tx}`, 2000);
        await this.exec(`ATCRA ${target.rx}`, 2000);

        const pnRaw = await this.exec('22 F1 87', 3000).catch(() => '');
        const pn = decodeUdsAsciiPayload(pnRaw, '62F187');
        const snRaw = await this.exec('22 F1 97', 2500).catch(() => '');
        const sn = decodeUdsAsciiPayload(snRaw, '62F197');
        const sessRaw = await this.exec('10 03', 3000).catch(() => '');
        const cleanSess = Elm327Protocol.cleanResponse(sessRaw);

        if (pn || sn || cleanSess.includes('5003') || cleanSess.includes('7F10')) {
          activeTarget = target;
          partNumber = pn;
          systemName = sn;
          sessionResponse = cleanSess || 'NO DATA';
          this.udsSessionActive = true;
          this.log(
            'INFO',
            `Pronađen modul na ${target.label}: Part#=${pn || 'nepoznat'}, Name=${sn || 'nepoznat'}, Session=${sessionResponse}`
          );
          break;
        }
      }

      if (!this.udsSessionActive) {
        throw new Error('Modul 09 nije odgovorio ni na 0x70E ni na 0x710. Proveri da li je kontakt uključen.');
      }

      // 3. Build VAG UDS 0x2F candidate DID ranges (256 non-destructive probes: 2F <DID> 00)
      const ranges: { start: number; end: number; label: string }[] = [
        { start: 0x3b00, end: 0x3b3f, label: '3B00–3B3F' },
        { start: 0x5400, end: 0x543f, label: '5400–543F' },
        { start: 0xf400, end: 0xf43f, label: 'F400–F43F' },
        { start: 0x0200, end: 0x023f, label: '0200–023F' },
      ];

      const allDids: string[] = [];
      for (const r of ranges) {
        for (let id = r.start; id <= r.end; id++) {
          allDids.push(id.toString(16).toUpperCase().padStart(4, '0'));
        }
      }

      const discoveredDids: DiscoveredDid[] = [];
      let scannedCount = 0;

      for (let i = 0; i < allDids.length; i++) {
        if (this.abortRequested) break;
        const did = allDids[i];

        // Keep Extended Session alive every 35 queries
        if (i > 0 && i % 35 === 0) {
          await this.client.command('3E 80', 1200).catch(() => {});
        }

        if (i % 16 === 0) {
          const pct = Math.min(92, 18 + Math.round((i / allDids.length) * 74));
          onProgress?.(`Skeniram DID 0x${did} (${i}/${allDids.length}) — pronađeno: ${discoveredDids.length}`, pct);
        }

        let rx = '';
        try {
          rx = await this.client.command(`2F${did}00`, 1200);
        } catch {
          continue;
        }
        scannedCount++;

        const parsed = parseUds2fResponse(rx);
        if (parsed.accepted) {
          const hit: DiscoveredDid = { did, status: '6F', detail: `6F (${parsed.rawClean})` };
          discoveredDids.push(hit);
          this.log('INFO', `✅ PRONAĐEN DID 0x${did}: pozitivan 6F odgovor (${parsed.rawClean})`);
        } else if (parsed.nrc && parsed.nrc !== '31') {
          // NRC != 31 (e.g. 33 SecurityAccess, 22 ConditionsNotCorrect, 13 Length) means DID EXISTS!
          const hit: DiscoveredDid = {
            did,
            status: 'NRC',
            nrc: parsed.nrc,
            detail: `7F 2F ${parsed.nrc} (${parsed.nrcDescription})`,
          };
          discoveredDids.push(hit);
          this.log('INFO', `⚡ POSTOJEĆI DID 0x${did}: 7F 2F ${parsed.nrc} — ${parsed.nrcDescription}`);
        }
      }

      // 4. Clean teardown
      onProgress?.('Zatvaranje sesije (10 01 / ATSH 7DF)...', 96);
      await this.exec('10 01', 2000).catch(() => {});
      this.udsSessionActive = false;
      await this.exec('ATSH 7DF', 2000).catch(() => {});
      await this.exec('ATCRA', 2000).catch(() => {});

      onProgress?.('Skeniranje završeno.', 100);
      this.log(
        'INFO',
        `Skeniranje završeno (${scannedCount} DID-ova). Part#: ${partNumber || 'N/A'} | Pronađeno validnih DID-ova: ${discoveredDids.length}.`
      );

      return {
        targetLabel: activeTarget.label,
        partNumber,
        systemName,
        sessionResponse,
        discoveredDids,
        scannedCount,
      };
    } catch (error: any) {
      this.log('ERROR', `Greška pri skeniranju Modula 09: ${error?.message || error}`);
      await this.emergencyStop();
      throw error;
    } finally {
      this.udsSessionActive = false;
      this.isRunning = false;
      this.client?.resumePolling?.();
    }
  }
}
