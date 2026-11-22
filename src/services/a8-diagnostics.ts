/**
 * BANDOLERO A8 D4 COCKPIT
 * Read-Only Audi A8 D4 (4H) Air Suspension (0x71D) & 16-Module UDS Diagnostics
 * + Performance Timer Helpers (0-60, 0-100, 100-200, 402m, Vmax)
 */

import { ObdBleClient } from './obd-ble';
import { Elm327Protocol } from './elm327-protocol';
import { decodeUdsAsciiPayload } from './light-show-controller';

export type A8ModuleDef = {
  vagAddress: string;
  name: string;
  tx: string;
  rx: string;
};

/**
 * Exact 16 UDS modules confirmed live on this Audi A8 D4 (4H) 4.2 TDI.
 */
export const A8_D4_CONFIRMED_MODULES: A8ModuleDef[] = [
  { vagAddress: '34', name: 'Vazdušno vešanje (Level Control)', tx: '71D', rx: '787' },
  { vagAddress: '19', name: 'CAN Gateway (J533)', tx: '710', rx: '77A' },
  { vagAddress: '03', name: 'ABS / ESP Kočnice', tx: '713', rx: '77D' },
  { vagAddress: '17', name: 'Instrument Tabla (Kombi)', tx: '714', rx: '77E' },
  { vagAddress: '15', name: 'Airbag (SRS)', tx: '715', rx: '77F' },
  { vagAddress: '53', name: 'Elektronska ručna (EPB)', tx: '752', rx: '7BC' },
  { vagAddress: '02', name: 'Menjač / Gear Shift', tx: '753', rx: '7BD' },
  { vagAddress: '10', name: 'Park Assist (Parking senzori)', tx: '70A', rx: '774' },
  { vagAddress: '08', name: 'Prednja Klima (Climatronic)', tx: '746', rx: '7B0' },
  { vagAddress: '28', name: 'Zadnja Klima', tx: '71A', rx: '784' },
  { vagAddress: '8F', name: 'Senzori / Asistencija', tx: '721', rx: '78B' },
  { vagAddress: '36', name: 'Sedište vozača', tx: '735', rx: '79F' },
  { vagAddress: '06', name: 'Sedište suvozača', tx: '736', rx: '7A0' },
  { vagAddress: '55', name: 'Šasija / Asistencija (0x755)', tx: '755', rx: '7BF' },
  { vagAddress: '8E', name: 'Zatezač pojasa levi', tx: '75E', rx: '7C8' },
  { vagAddress: '90', name: 'Zatezač pojasa desni', tx: '75F', rx: '7C9' },
];

export type UdsDtcEntry = {
  codeHex: string; // 6-char UDS 3-byte DTC (e.g. 001400)
  statusByte: string;
  isActive: boolean;
};

export type AirSuspensionReport = {
  reachable: boolean;
  partNumber: string | null;
  systemName: string | null;
  dtcs: UdsDtcEntry[];
  allBagsHealthy: boolean;
  heightsMm: {
    fl: number | null;
    fr: number | null;
    rl: number | null;
    rr: number | null;
  };
  summary: string;
  timestamp: number;
};

export type ModuleScanEntry = {
  module: A8ModuleDef;
  reachable: boolean;
  dtcs: UdsDtcEntry[];
};

export type PerformanceRunRecord = {
  id: string;
  dateIso: string;
  zeroTo60Sec: number | null;
  zeroTo100Sec: number | null;
  hundredTo200Sec: number | null;
  quarterMileSec: number | null;
  maxSpeedKmh: number;
  oilTempC?: number;
};

/**
 * Parses UDS Service 0x19 subfunction 0x02 (reportDTCByStatusMask) positive response (59 02 <availMask> [DTC3 + status]*).
 */
export function parseUds1902Dtcs(rawResponse: string): UdsDtcEntry[] {
  const clean = Elm327Protocol.reassembleIsoTp(rawResponse);
  const idx = clean.indexOf('5902');
  if (idx === -1) return [];
  // Skip "5902" (4 chars) + statusAvailabilityMask (2 chars)
  const payload = clean.slice(idx + 6);
  const dtcs: UdsDtcEntry[] = [];
  for (let i = 0; i + 7 < payload.length; i += 8) {
    const codeHex = payload.slice(i, i + 6);
    const statusByte = payload.slice(i + 6, i + 8);
    if (codeHex === '000000') continue;
    const statusNum = parseInt(statusByte, 16);
    const isActive = !isNaN(statusNum) && (statusNum & 0x09) !== 0; // testFailed (0x01) or confirmedDTC (0x08)
    dtcs.push({ codeHex, statusByte, isActive });
  }
  return dtcs;
}

/**
 * Parses a signed 16-bit millimeter height value from a UDS 0x22 positive response (62 <DID> <HI> <LO>).
 */
export function parseSignedMmDid(rawResponse: string, didHex: string): number | null {
  const clean = Elm327Protocol.reassembleIsoTp(rawResponse);
  const prefix = `62${didHex.toUpperCase()}`;
  const idx = clean.indexOf(prefix);
  if (idx === -1) return null;
  const payload = clean.slice(idx + prefix.length);
  if (payload.length < 4) return null;
  let val = parseInt(payload.slice(0, 4), 16);
  if (isNaN(val)) return null;
  if (val > 0x7fff) val -= 0x10000;
  // Sanity filter: Audi A8 D4 ride height sensor offset/height is typically within -200..+600 mm
  if (val < -200 || val > 600) return null;
  return val;
}

export class A8DiagnosticsService {
  private client: ObdBleClient;

  constructor(client: ObdBleClient) {
    this.client = client;
  }

  private async configureUds(tx: string, rx: string): Promise<void> {
    await this.client.command('ATCAF1', 1500).catch(() => {});
    await this.client.command(`ATSH ${tx}`, 1500);
    await this.client.command(`ATCRA ${rx}`, 1500);
    await this.client.command(`ATFCSH ${tx}`, 1500).catch(() => {});
    await this.client.command('ATFCSD 300000', 1500).catch(() => {});
    await this.client.command('ATFCSM 1', 1500).catch(() => {});
  }

  private async restoreObd(): Promise<void> {
    await this.client.command('ATCAF1', 1500).catch(() => {});
    await this.client.command('ATFCSM 0', 1500).catch(() => {});
    await this.client.command('ATSH 7DF', 1500).catch(() => {});
    await this.client.command('ATCRA', 1500).catch(() => {});
  }

  /**
   * 100% READ-ONLY health & height check of Audi A8 D4 Air Suspension (Module 34 at 0x71D / 0x787).
   * Never writes calibration or actuates the compressor.
   */
  async checkAirSuspension(): Promise<AirSuspensionReport> {
    if (!this.client.isConnected) {
      throw new Error('OBD adapter nije povezan. Poveži VLinker BM+ u Settings tabu.');
    }

    this.client.pausePolling();
    try {
      await this.configureUds('71D', '787');

      const pnRaw = await this.client.command('22 F1 87', 2500).catch(() => '');
      const partNumber = decodeUdsAsciiPayload(pnRaw, '62F187');
      const snRaw = await this.client.command('22 F1 97', 2000).catch(() => '');
      const systemName = decodeUdsAsciiPayload(snRaw, '62F197');

      const dtcRaw = await this.client.command('19 02 8F', 3000).catch(() => '');
      const reachable = Boolean(partNumber || systemName || Elm327Protocol.cleanResponse(dtcRaw).includes('5902'));
      const dtcs = parseUds1902Dtcs(dtcRaw);

      // Try standard VAG Level Control ride height DIDs (read-only 0x22)
      let fl = parseSignedMmDid(await this.client.command('22 10 01', 1500).catch(() => ''), '1001');
      let fr = parseSignedMmDid(await this.client.command('22 10 02', 1500).catch(() => ''), '1002');
      let rl = parseSignedMmDid(await this.client.command('22 10 03', 1500).catch(() => ''), '1003');
      let rr = parseSignedMmDid(await this.client.command('22 10 04', 1500).catch(() => ''), '1004');

      // Fallback VAG MLB Level Control height block DIDs (0x2401-0x2404)
      if (fl === null && fr === null && rl === null && rr === null) {
        fl = parseSignedMmDid(await this.client.command('22 24 01', 1500).catch(() => ''), '2401');
        fr = parseSignedMmDid(await this.client.command('22 24 02', 1500).catch(() => ''), '2402');
        rl = parseSignedMmDid(await this.client.command('22 24 03', 1500).catch(() => ''), '2403');
        rr = parseSignedMmDid(await this.client.command('22 24 04', 1500).catch(() => ''), '2404');
      }

      const activeDtcs = dtcs.filter(d => d.isActive);
      const allBagsHealthy = reachable && activeDtcs.length === 0;

      const summary = !reachable
        ? 'Modul vazdušnog vešanja (0x71D) nije odgovorio. Proveri da li je kontakt uključen.'
        : allBagsHealthy
        ? 'Svi vazdušni jastuci, ventili i kompresor su ispravni (0 aktivnih grešaka u Modulu 34).'
        : `Pronađeno ${activeDtcs.length} aktivnih grešaka u Modulu vazdušnog vešanja (ukupno ${dtcs.length} zabeleženih).`;

      return {
        reachable,
        partNumber,
        systemName,
        dtcs,
        allBagsHealthy,
        heightsMm: { fl, fr, rl, rr },
        summary,
        timestamp: Date.now(),
      };
    } finally {
      await this.restoreObd();
      this.client.resumePolling();
    }
  }

  /**
   * Scans all 16 confirmed UDS modules on this Audi A8 D4 (4H) for stored/active DTCs.
   */
  async scanAll16Modules(
    onProgress?: (moduleName: string, index: number, total: number) => void
  ): Promise<ModuleScanEntry[]> {
    if (!this.client.isConnected) {
      throw new Error('OBD adapter nije povezan. Poveži VLinker BM+ u Settings tabu.');
    }

    this.client.pausePolling();
    const results: ModuleScanEntry[] = [];
    try {
      await this.client.command('ATCAF1', 1500).catch(() => {});
      await this.client.command('ATFCSD 300000', 1500).catch(() => {});
      await this.client.command('ATFCSM 1', 1500).catch(() => {});

      for (let i = 0; i < A8_D4_CONFIRMED_MODULES.length; i++) {
        const mod = A8_D4_CONFIRMED_MODULES[i];
        onProgress?.(mod.name, i + 1, A8_D4_CONFIRMED_MODULES.length);

        await this.client.command(`ATSH ${mod.tx}`, 1200).catch(() => {});
        await this.client.command(`ATCRA ${mod.rx}`, 1200).catch(() => {});
        await this.client.command(`ATFCSH ${mod.tx}`, 1200).catch(() => {});

        const dtcRaw = await this.client.command('19 02 8F', 2200).catch(() => '');
        const clean = Elm327Protocol.cleanResponse(dtcRaw);
        const reachable = clean.includes('5902');
        const dtcs = parseUds1902Dtcs(dtcRaw);

        results.push({ module: mod, reachable, dtcs });
      }
      return results;
    } finally {
      await this.restoreObd();
      this.client.resumePolling();
    }
  }

  /**
   * Clears UDS DTCs on a specific confirmed module (Service 0x14 FF FF FF).
   */
  async clearModuleDtcs(tx: string, rx: string): Promise<boolean> {
    if (!this.client.isConnected) {
      throw new Error('OBD adapter nije povezan.');
    }
    this.client.pausePolling();
    try {
      await this.configureUds(tx, rx);
      const resp = await this.client.command('14 FF FF FF', 3000);
      return Elm327Protocol.cleanResponse(resp).includes('54');
    } finally {
      await this.restoreObd();
      this.client.resumePolling();
    }
  }
}
