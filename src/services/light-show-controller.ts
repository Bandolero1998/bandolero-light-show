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

export class LightShowController {
  private client: ObdBleClient | null = null;
  private isRunning = false;
  private abortRequested = false;
  private testerPresentTimer: ReturnType<typeof setInterval> | null = null;
  private logCallback?: (entry: CommandLogEntry) => void;

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
   * Pulses a specific UDS IO Control actuator a given number of times.
   */
  private async pulseActuator(didHex: string, count: number, onMs: number, offMs: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      if (this.abortRequested) break;
      await this.exec(`2F${didHex}03`, 1500);
      await this.sleep(onMs);
      await this.exec(`2F${didHex}00`, 1500);
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
        await this.exec('2F000000', 1500).catch(() => {});
        await this.exec('10 01', 1500).catch(() => {});
        await this.exec('ATSH 7DF', 1500).catch(() => {});
        await this.exec('ATCRA', 1500).catch(() => {});
        this.log('INFO', 'Kontrola svetala vraćena računaru vozila (10 01 / ATSH 7DF).');
      } catch (err: any) {
        this.log('ERROR', `Greška pri bezbednosnom resetovanju: ${err?.message}`);
      }
    } else {
      this.log('ERROR', 'OBD adapter nije povezan — lokalno zaustavljeno.');
    }
  }

  /**
   * Executes a physical actuator light test sequence on the vehicle.
   * Targets Audi A8 D4 Module 09 (Central Electrics BCM at CAN ID 0x710).
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

    // Pause live dashboard polling so it does not collide with UDS frames
    this.client.stopPolling();

    this.isRunning = true;
    this.abortRequested = false;

    this.log('INFO', `Započinjem sekvencu "${effectId.toUpperCase()}" na vozilu Audi A8 D4.`);
    this.log('INFO', 'Korak 1: Resetovanje CAN headera (7DF) i provera brzine (010D).');

    try {
      // Step 1: Restore standard OBD-II CAN header & clear RX filter BEFORE querying PID 010D
      onProgress?.('Resetovanje CAN headera (ATSH 7DF / ATCRA)...', 10);
      await this.exec('ATSH 7DF', 2000);
      await this.exec('ATCRA', 2000);

      // Query vehicle speed (PID 010D)
      onProgress?.('Provera brzine vozila (PID 010D)...', 18);
      const speedRaw = await this.exec('010D', 3000);
      const parsedSpeed = Elm327Protocol.parsePidValue('010D', speedRaw);
      const speed = typeof parsedSpeed === 'number' ? parsedSpeed : undefined;

      // Query RPM (PID 010C) if available
      let rpm: number | undefined;
      try {
        const rpmRaw = await this.exec('010C', 2500);
        const parsedRpm = Elm327Protocol.parsePidValue('010C', rpmRaw);
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

      // Step 2: ONLY AFTER confirming speed === 0 km/h, switch CAN header to Module 09 (BCM1: 0x710)
      onProgress?.('Prebacivanje CAN headera na Modul 09 (ATSH 710)...', 30);
      await this.exec('ATSH 710', 2000);

      // Step 3: Enter UDS Extended Diagnostic Session (10 03) & start TesterPresent (3E 80) loop
      onProgress?.('Otvaranje UDS Extended Session (10 03)...', 42);
      const sessionResp = await this.exec('10 03', 3000);
      if (/7F\s*10/i.test(sessionResp)) {
        this.log('INFO', 'Modul 09 je vratio 7F 10 (Extended Session odbijen — proveriti kontakt / sigurnosni pristup).');
      } else {
        this.log('INFO', 'UDS Extended Session aktivna — pokrećem TesterPresent (3E 80) na 2s.');
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
            await this.exec('2F010503', 1500);
            await this.exec('2F010603', 1500);
            await this.sleep(110);
            await this.exec('2F010500', 1500);
            await this.exec('2F010600', 1500);
            await this.sleep(90);
          }
          await this.sleep(320);
        }
      } else if (effectId === 'police_pursuit') {
        // Cross-pattern: Left High + Right Fog -> Right High + Left Fog
        for (let c = 0; c < 3 && !this.abortRequested; c++) {
          await this.exec('2F010503', 1500);
          await this.exec('2F010803', 1500);
          await this.sleep(140);
          await this.exec('2F010500', 1500);
          await this.exec('2F010800', 1500);
          await this.sleep(80);
          await this.exec('2F010603', 1500);
          await this.exec('2F010703', 1500);
          await this.sleep(140);
          await this.exec('2F010600', 1500);
          await this.exec('2F010700', 1500);
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
        await this.exec('2F010203', 2000);
        await this.sleep(400);
        await this.exec('2F010200', 2000);
        await this.sleep(200);
        await this.exec('2F010303', 2000);
        await this.sleep(400);
        await this.exec('2F010300', 2000);
      } else if (effectId === 'pulse' || effectId === 'hazard') {
        for (let cycle = 0; cycle < 2 && !this.abortRequested; cycle++) {
          await this.exec('2F010203', 1500);
          await this.exec('2F010303', 1500);
          await this.sleep(350);
          await this.exec('2F010200', 1500);
          await this.exec('2F010300', 1500);
          await this.sleep(250);
        }
      } else if (effectId === 'highbeam') {
        await this.exec('2F010503', 2000);
        await this.sleep(400);
        await this.exec('2F010500', 2000);
      }

      onProgress?.('Vraćanje kontrole modulu vozila (10 01 / ATSH 7DF)...', 90);

      // Step 5: Clean teardown — stop TesterPresent, return actuators, restore default session & OBD header
      this.stopTesterPresentLoop();
      await this.exec('2F000000', 2000).catch(() => {});
      await this.exec('10 01', 2000).catch(() => {});
      await this.exec('ATSH 7DF', 2000).catch(() => {});
      await this.exec('ATCRA', 2000).catch(() => {});

      onProgress?.('Sekvenca završena.', 100);
      this.log('INFO', 'Sekvenca uspešno poslata. Kontrola vraćena računaru (10 01 / ATSH 7DF).');
      return { success: true, message: 'Komande su uspešno poslate modulu 09 vozila.' };
    } catch (error: any) {
      this.stopTesterPresentLoop();
      this.log('ERROR', `Prekid sekvence: ${error?.message || error}`);
      await this.emergencyStop();
      throw error;
    } finally {
      this.stopTesterPresentLoop();
      this.isRunning = false;
    }
  }
}
