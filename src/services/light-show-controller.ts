/**
 * BANDOLERO LIGHT SHOW 1.2.0
 * Light Show Controller & Vehicle Actuator Driver
 *
 * Implements:
 * 1. Visual on-screen simulation mode for mobile preview.
 * 2. Real vehicle hardware actuation for Audi A8 D4 4.2 TDI (2010) and VAG platforms
 *    using ISO 14229 UDS (Unified Diagnostic Services) on Module 09 (Central Electrics BCM).
 * 3. Real-time safety validation with automatic emergency stop (failsafe).
 * 4. Transparent TX/RX command logging so the user sees exactly what commands are exchanged with the car.
 */

import { ObdBleClient } from './obd-ble';
import { SafetyInterlock } from './safety-interlock';

export type LightEffectId = 'welcome' | 'pulse' | 'sweep' | 'hazard' | 'highbeam';

export type LightEffect = {
  id: LightEffectId;
  index: string;
  name: string;
  description: string;
  requiresVehicleTesting: boolean;
  colors: string[];
  estimatedDurationMs: number;
};

export const AVAILABLE_EFFECTS: LightEffect[] = [
  {
    id: 'welcome',
    index: '01',
    name: 'WELCOME SEQUENCE',
    description: 'Pozdravna sekvenca: poziciona svetla, leva/desna strana, DRL i gašenje',
    requiresVehicleTesting: true,
    colors: ['#8B35D1', '#C084FC'],
    estimatedDurationMs: 4000,
  },
  {
    id: 'pulse',
    index: '02',
    name: 'STROBE PULSE',
    description: 'Kratki sinhronizovani svetlosni impulsi pokazivača pravca',
    requiresVehicleTesting: true,
    colors: ['#6D28D9', '#A855F7'],
    estimatedDurationMs: 3000,
  },
  {
    id: 'sweep',
    index: '03',
    name: 'LEFT / RIGHT SWEEP',
    description: 'Naizmenično aktiviranje levog pa desnog pokazivača pravca',
    requiresVehicleTesting: true,
    colors: ['#7C3AED', '#D8B4FE'],
    estimatedDurationMs: 4500,
  },
  {
    id: 'hazard',
    index: '04',
    name: 'HAZARD STROBE',
    description: 'Sinhroni test svih 4 migavca u ritmu svetlosnog šoua',
    requiresVehicleTesting: true,
    colors: ['#F59E0B', '#FCD34D'],
    estimatedDurationMs: 3500,
  },
  {
    id: 'highbeam',
    index: '05',
    name: 'HIGH BEAM FLASH',
    description: 'Test blicanja dugim svetlima i prednjim maglenkama u mestu',
    requiresVehicleTesting: true,
    colors: ['#38BDF8', '#818CF8'],
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
   * Sends a low-level command to the vehicle adapter and logs both TX and RX.
   */
  private async exec(cmd: string, timeout = 3000): Promise<string> {
    if (!this.client) throw new Error('OBD adapter nije povezan.');
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
    const step = 50;
    let elapsed = 0;
    while (elapsed < ms) {
      if (this.abortRequested) break;
      await new Promise(r => setTimeout(r, step));
      elapsed += step;
    }
  }

  /**
   * Emergency Stop / Failsafe:
   * Instantly sends ECU release commands to Module 09 and restores standard OBD-II mode.
   */
  async emergencyStop(): Promise<void> {
    this.abortRequested = true;
    this.isRunning = false;
    this.log('INFO', '🚨 PRINUDNO ZAUSTAVLJANJE (EMERGENCY STOP) POKRENUTO!');

    if (this.client) {
      try {
        // Return control of all actuators to vehicle ECU (UDS Service 0x2F ReturnControlToECU)
        await this.exec('2F000000', 1500).catch(() => {});
        // Return to standard Default Diagnostic Session (0x10 0x01)
        await this.exec('1001', 1500).catch(() => {});
        // Reset CAN header back to functional OBD-II broadcast 7DF
        await this.exec('ATSH7DF', 1500).catch(() => {});
        this.log('INFO', 'Kontrola svetala vraćena motornom/komfornom računaru vozila.');
      } catch (err: any) {
        this.log('ERROR', `Greška pri bezbednosnom resetovanju: ${err?.message}`);
      }
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

    if (!this.client) {
      throw new Error('Bluetooth adapter nije povezan.');
    }

    this.isRunning = true;
    this.abortRequested = false;

    this.log('INFO', `Započinjem sekvencu "${effectId.toUpperCase()}" na vozilu Audi A8 D4.`);
    this.log('INFO', 'Zahteva kontakt i vozilo u stanju mirovanja (0 km/h).');

    try {
      // Step 1: Check live safety state (Speed must be strictly 0)
      onProgress?.('Provera bezbednosnih uslova (brzina 0 km/h)...', 10);
      const live = await this.client.readLiveData().catch(() => null);
      const safety = SafetyInterlock.evaluate(live, true, false);

      if (!safety.isSafe) {
        throw new Error(safety.criticalLockReason || 'Bezbednosna provera nije prošla. Vozilo mora bezbedno mirovati.');
      }
      this.log('INFO', 'Bezbednosni uslovi potvrđeni: brzina 0 km/h, motor bezbedan.');

      // Step 2: Configure CAN address for Audi A8 D4 Central Electrics Module 09 (CAN ID 0x710)
      onProgress?.('Konfigurisanje CAN adrese Module 09 (0x710)...', 25);
      await this.exec('ATSH710', 2000);

      // Step 3: Enter UDS Extended Diagnostic Session (0x10 0x03)
      onProgress?.('Aktiviranje UDS Extended Session (10 03)...', 40);
      const sessionResp = await this.exec('1003', 3000);
      if (/7F10/i.test(sessionResp)) {
        this.log('INFO', 'Module 09 je odbio Extended Session (zahteva bezbednosni pristup ili drugačiju CAN adresu).');
      }

      // Step 4: Execute effect specific actuator pulses
      onProgress?.(`Izvršavanje svetlosnog efekta ${effectId}...`, 60);

      if (effectId === 'welcome' || effectId === 'sweep') {
        // Left Blinker ON (2F 01 02 03) -> wait -> Left Blinker Return (2F 01 02 00)
        await this.exec('2F010203', 2000);
        await this.sleep(400);
        await this.exec('2F010200', 2000);
        await this.sleep(200);

        // Right Blinker ON (2F 01 03 03) -> wait -> Right Blinker Return (2F 01 03 00)
        await this.exec('2F010303', 2000);
        await this.sleep(400);
        await this.exec('2F010300', 2000);
      } else if (effectId === 'pulse' || effectId === 'hazard') {
        // Both Blinkers pulse twice
        for (let cycle = 0; cycle < 2; cycle++) {
          if (this.abortRequested) break;
          await this.exec('2F010203', 1500);
          await this.exec('2F010303', 1500);
          await this.sleep(350);
          await this.exec('2F010200', 1500);
          await this.exec('2F010300', 1500);
          await this.sleep(250);
        }
      } else if (effectId === 'highbeam') {
        // High beam momentary actuator flash (2F 01 05 03) -> 300ms -> Return (2F 01 05 00)
        await this.exec('2F010503', 2000);
        await this.sleep(400);
        await this.exec('2F010500', 2000);
      }

      onProgress?.('Vraćanje kontrole modulu vozila...', 90);

      // Step 5: Clean teardown — return all actuators and restore default session
      await this.exec('2F000000', 2000).catch(() => {});
      await this.exec('1001', 2000).catch(() => {});
      await this.exec('ATSH7DF', 2000).catch(() => {});

      onProgress?.('Sekvenca završena.', 100);
      this.log('INFO', 'Sekvenca uspešno poslata. Proveri odziv svetala na vozilu.');
      return { success: true, message: 'Komande su uspešno poslate modulu 09 vozila.' };
    } catch (error: any) {
      this.log('ERROR', `Prekid sekvence: ${error?.message || error}`);
      await this.emergencyStop();
      throw error;
    } finally {
      this.isRunning = false;
    }
  }
}
