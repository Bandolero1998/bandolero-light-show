/**
 * BANDOLERO LIGHT SHOW 1.2.0
 * Automotive Safety Interlock System
 *
 * Enforces mandatory stationary safety conditions before and during any vehicle
 * light actuation. If vehicle motion is detected (speed > 0 km/h or rpm > 1100),
 * or if communication is lost, the interlock immediately trips and triggers an emergency stop.
 */

import { ParsedLiveData } from './elm327-protocol';

export type SafetyStatus = {
  isSafe: boolean;
  canArmLightShow: boolean;
  reasons: string[];
  speedVerifiedZero: boolean;
  rpmSafe: boolean;
  voltageSufficient: boolean;
  connectionActive: boolean;
  criticalLockReason?: string;
};

export class SafetyInterlock {
  /**
   * Maximum vehicle speed permitted for light show (must be stationary).
   */
  static readonly MAX_ALLOWED_SPEED_KMH = 0;

  /**
   * Maximum safe RPM permitted for light show (engine off or stationary idle in Park/Neutral).
   */
  static readonly MAX_ALLOWED_RPM = 1100;

  /**
   * Minimum battery voltage to protect vehicle battery from excessive drain during actuation tests.
   */
  static readonly MIN_BATTERY_VOLTAGE = 11.5;

  /**
   * Evaluates current vehicle safety conditions.
   *
   * @param live Latest verified live data from OBD-II Mode 01
   * @param isConnected Whether the BLE adapter is actively connected
   * @param isSimulationMode If true, relaxes hardware checks for on-screen preview only
   */
  static evaluate(
    live: ParsedLiveData | null,
    isConnected: boolean,
    isSimulationMode = false
  ): SafetyStatus {
    // In simulation mode, on-screen visual preview is always safe
    if (isSimulationMode) {
      return {
        isSafe: true,
        canArmLightShow: true,
        reasons: ['Režim ekranske simulacije — komande se ne šalju vozilu.'],
        speedVerifiedZero: true,
        rpmSafe: true,
        voltageSufficient: true,
        connectionActive: false,
      };
    }

    const reasons: string[] = [];

    if (!isConnected) {
      return {
        isSafe: false,
        canArmLightShow: false,
        reasons: ['OBD adapter nije povezan via Bluetooth BLE.'],
        speedVerifiedZero: false,
        rpmSafe: false,
        voltageSufficient: false,
        connectionActive: false,
        criticalLockReason: 'Bluetooth adapter nije povezan.',
      };
    }

    if (!live) {
      return {
        isSafe: false,
        canArmLightShow: false,
        reasons: ['Podaci o kretanju vozila još nisu očitani sa motornog računara.'],
        speedVerifiedZero: false,
        rpmSafe: false,
        voltageSufficient: false,
        connectionActive: true,
        criticalLockReason: 'Potrebno je očitati brzinu i obrtaje vozila pre pokretanja.',
      };
    }

    // 1. Mandatory Speed Check
    let speedVerifiedZero = false;
    if (live.speed !== undefined) {
      if (live.speed > this.MAX_ALLOWED_SPEED_KMH) {
        return {
          isSafe: false,
          canArmLightShow: false,
          reasons: [`Vozilo se kreće! Očitana brzina je ${live.speed} km/h. Svetlosni šou je strogo zabranjen tokom kretanja.`],
          speedVerifiedZero: false,
          rpmSafe: false,
          voltageSufficient: true,
          connectionActive: true,
          criticalLockReason: `VOZILO U POKRETU (${live.speed} km/h) — BEZBEDNOSNA BLOKADA!`,
        };
      }
      speedVerifiedZero = true;
      reasons.push('Brzina vozila: 0 km/h (potvrđeno mirovanje)');
    } else {
      reasons.push('Upozorenje: Brzina vozila (PID 010D) nije očitana');
    }

    // 2. Engine RPM Check
    let rpmSafe = false;
    if (live.rpm !== undefined) {
      if (live.rpm > this.MAX_ALLOWED_RPM) {
        return {
          isSafe: false,
          canArmLightShow: false,
          reasons: [`Obrtaji motora su previsoki (${Math.round(live.rpm)} rpm). Dozvoljen je samo rad u mestu (< 1100 rpm) ili ugašen motor.`],
          speedVerifiedZero,
          rpmSafe: false,
          voltageSufficient: true,
          connectionActive: true,
          criticalLockReason: `VISOKI OBRTAJI MOTORA (${Math.round(live.rpm)} rpm) — ZAUSTAVITI VOZILO!`,
        };
      }
      rpmSafe = true;
      reasons.push(live.rpm === 0 ? 'Motor ugašen (kontakt uključen)' : `Motor u leru (${Math.round(live.rpm)} rpm)`);
    } else {
      rpmSafe = true;
      reasons.push('Obrtaji motora nisu očitani');
    }

    // 3. Battery Voltage Check
    let voltageSufficient = true;
    const voltage = live.voltage ?? live.controlModuleVoltage;
    if (voltage !== undefined) {
      if (voltage < this.MIN_BATTERY_VOLTAGE) {
        voltageSufficient = false;
        reasons.push(`Nizak napon akumulatora (${voltage.toFixed(1)} V). Preporučuje se dopuna.`);
      } else {
        reasons.push(`Napon akumulatora: ${voltage.toFixed(1)} V (stabilno)`);
      }
    }

    const isSafe = speedVerifiedZero && rpmSafe && voltageSufficient;
    return {
      isSafe,
      canArmLightShow: isSafe,
      reasons,
      speedVerifiedZero,
      rpmSafe,
      voltageSufficient,
      connectionActive: true,
      criticalLockReason: isSafe ? undefined : reasons[0],
    };
  }
}
