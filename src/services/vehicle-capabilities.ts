/**
 * BANDOLERO LIGHT SHOW 1.2.0
 * Vehicle Capabilities & PID Discovery Engine
 *
 * Implements standard OBD-II PID support detection via Mode 01 PID 00, 20, 40, 60
 * and Mode 09 PID 00 service discovery.
 */

import { Elm327Protocol } from './elm327-protocol';

export type SupportedFeature = {
  pid: string;
  name: string;
  category: 'engine' | 'speed' | 'temperature' | 'fuel' | 'diagnostics' | 'vehicle';
  unit?: string;
};

export const KNOWN_PIDS: Record<string, { name: string; category: SupportedFeature['category']; unit?: string }> = {
  '01': { name: 'Status & MIL / DTC Count', category: 'diagnostics' },
  '03': { name: 'Fuel System Status', category: 'fuel' },
  '04': { name: 'Engine Load', category: 'engine', unit: '%' },
  '05': { name: 'Engine Coolant Temperature', category: 'temperature', unit: '°C' },
  '06': { name: 'Short Term Fuel Trim Bank 1', category: 'fuel', unit: '%' },
  '07': { name: 'Long Term Fuel Trim Bank 1', category: 'fuel', unit: '%' },
  '0B': { name: 'Intake Manifold Absolute Pressure', category: 'engine', unit: 'kPa' },
  '0C': { name: 'Engine RPM', category: 'engine', unit: 'rpm' },
  '0D': { name: 'Vehicle Speed', category: 'speed', unit: 'km/h' },
  '0E': { name: 'Timing Advance', category: 'engine', unit: '°' },
  '0F': { name: 'Intake Air Temperature', category: 'temperature', unit: '°C' },
  '10': { name: 'MAF Air Flow Rate', category: 'engine', unit: 'g/s' },
  '11': { name: 'Throttle Position', category: 'engine', unit: '%' },
  '1F': { name: 'Run Time Since Engine Start', category: 'engine', unit: 's' },
  '21': { name: 'Distance Traveled with MIL on', category: 'diagnostics', unit: 'km' },
  '23': { name: 'Fuel Rail Pressure (Diesel Common Rail)', category: 'fuel', unit: 'kPa' },
  '2F': { name: 'Fuel Tank Input Level', category: 'fuel', unit: '%' },
  '31': { name: 'Distance Traveled Since Codes Cleared', category: 'diagnostics', unit: 'km' },
  '42': { name: 'Control Module Voltage', category: 'vehicle', unit: 'V' },
  '46': { name: 'Ambient Air Temperature', category: 'temperature', unit: '°C' },
  '5C': { name: 'Engine Oil Temperature', category: 'temperature', unit: '°C' },
};

export type VehicleCapabilities = {
  supportedPids: string[];
  features: SupportedFeature[];
  hasLiveSpeed: boolean;
  hasEngineRpm: boolean;
  hasCoolantTemp: boolean;
  hasOilTemp: boolean;
  hasFuelLevel: boolean;
  hasMaf: boolean;
  hasFuelRailPressure: boolean;
  supportsVin: boolean;
  supportsMode03: boolean;
  supportsMode07: boolean;
  supportsMode04Clear: boolean;
  rawBitmaps: Record<string, string>;
  protocol: string;
  adapterModel: string;
  vin?: string | null;
  detectedAt: number;
};

export class VehicleCapabilitiesDetector {
  /**
   * Decodes a 32-bit hex bitmap response into an array of supported PIDs.
   * basePid is '00' (for 01-20), '20' (for 21-40), '40' (for 41-60), etc.
   */
  static decodePidBitmap(basePidHex: string, rawResponse: string): { supportedPids: string[]; hasNextBlock: boolean } {
    const clean = Elm327Protocol.cleanResponse(rawResponse);
    const data = Elm327Protocol.extractPositiveResponse(clean, '01', basePidHex);
    if (!data || data.length < 8) {
      return { supportedPids: [], hasNextBlock: false };
    }

    const basePidNumber = parseInt(basePidHex, 16);
    const hex8 = data.slice(0, 8);
    const num = parseInt(hex8, 16);
    if (isNaN(num)) return { supportedPids: [], hasNextBlock: false };

    const supportedPids: string[] = [];
    // 32 bits: bit 31 = basePid + 1, bit 0 = basePid + 32
    for (let i = 0; i < 32; i++) {
      const bitPosition = 31 - i;
      const isSet = (num & (1 << bitPosition)) !== 0;
      if (isSet) {
        const pidNum = basePidNumber + i + 1;
        const pidHex = pidNum.toString(16).toUpperCase().padStart(2, '0');
        supportedPids.push(pidHex);
      }
    }

    // Bit 0 (the 32nd PID) indicates if the next 32-PID block is supported
    const hasNextBlock = (num & 1) !== 0;
    return { supportedPids, hasNextBlock };
  }

  /**
   * Analyzes an array of supported PIDs and constructs a comprehensive VehicleCapabilities object.
   */
  static buildCapabilities(
    allSupportedPids: string[],
    protocol: string,
    adapterModel: string,
    rawBitmaps: Record<string, string> = {},
    vin?: string | null
  ): VehicleCapabilities {
    const features: SupportedFeature[] = [];

    for (const pid of allSupportedPids) {
      const known = KNOWN_PIDS[pid];
      if (known) {
        features.push({
          pid,
          name: known.name,
          category: known.category,
          unit: known.unit,
        });
      } else {
        features.push({
          pid,
          name: `OBD-II PID 0x${pid}`,
          category: 'engine',
        });
      }
    }

    return {
      supportedPids: allSupportedPids,
      features,
      hasLiveSpeed: allSupportedPids.includes('0D'),
      hasEngineRpm: allSupportedPids.includes('0C'),
      hasCoolantTemp: allSupportedPids.includes('05'),
      hasOilTemp: allSupportedPids.includes('5C'),
      hasFuelLevel: allSupportedPids.includes('2F'),
      hasMaf: allSupportedPids.includes('10'),
      hasFuelRailPressure: allSupportedPids.includes('23'),
      supportsVin: vin !== null && vin !== undefined,
      supportsMode03: true,
      supportsMode07: true,
      supportsMode04Clear: true,
      rawBitmaps,
      protocol,
      adapterModel,
      vin,
      detectedAt: Date.now(),
    };
  }
}
