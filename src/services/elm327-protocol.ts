/**
 * BANDOLERO LIGHT SHOW 1.2.0
 * ELM327 & STN2120 / STN Protocol Handler & Parser
 *
 * Implements low-level AT command sequences, ISO-TP multi-frame reassembly,
 * OBD-II Mode 01 PID conversions, Mode 03/07/0A DTC decoding, Mode 09 VIN parsing,
 * and UDS (ISO 14229) frame formatting.
 */

export type ParsedLiveData = {
  rpm?: number;
  speed?: number;
  coolant?: number;
  intake?: number;
  throttle?: number;
  engineLoad?: number;
  maf?: number;
  fuelLevel?: number;
  oilTemp?: number;
  ambientTemp?: number;
  fuelRailPressure?: number;
  controlModuleVoltage?: number;
  voltage?: number;
  mil?: boolean;
  milDistance?: number;
  distanceSinceCleared?: number;
  dtcCount?: number;
  dtcs: string[];
  pendingDtcs: string[];
  permanentDtcs: string[];
  vin?: string;
  ecuName?: string;
  protocol?: string;
  adapterModel?: string;
  timestamp: number;
};

export class Elm327Protocol {
  /**
   * Cleans an ELM327 / STN raw response string:
   * Strips echoes, null characters, prompts (>), carriage returns, line feeds, and spaces.
   */
  static cleanResponse(raw: string): string {
    if (!raw) return '';
    return raw
      .replace(/[\x00\r\n>]/g, '')
      .replace(/\s+/g, '')
      .toUpperCase();
  }

  /**
   * Reassembles multi-frame ISO-TP responses (common for DTCs, VIN, Mode 09).
   * E.g.
   * 0: 49 02 01 57 41 55
   * 1: 5A 5A 5A 34 48 37 42
   * 2: 4E 30 30 30 30 30 30
   */
  static reassembleIsoTp(raw: string): string {
    const lines = raw.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    const cleanedFrames: string[] = [];

    for (const line of lines) {
      // Check for ISO-TP line sequence like "0: 49 02..." or "1: ..."
      const match = line.match(/^[0-9A-F]:\s*(.*)$/i);
      if (match) {
        cleanedFrames.push(match[1].replace(/\s+/g, ''));
      } else {
        const cleaned = line.replace(/[^0-9A-F]/gi, '');
        if (cleaned.length > 0) {
          cleanedFrames.push(cleaned);
        }
      }
    }

    return cleanedFrames.join('').toUpperCase();
  }

  /**
   * Extracts data bytes following a positive OBD-II response header (e.g. 41 0C -> bytes).
   * Positive response for mode MM is (MM + 0x40).
   */
  static extractPositiveResponse(cleanHex: string, mode: string, pid?: string): string | null {
    const modeNum = parseInt(mode, 16);
    const expectedResponseMode = (modeNum + 0x40).toString(16).toUpperCase().padStart(2, '0');
    const expectedPrefix = pid ? `${expectedResponseMode}${pid.toUpperCase()}` : expectedResponseMode;

    const index = cleanHex.indexOf(expectedPrefix);
    if (index === -1) return null;
    return cleanHex.slice(index + expectedPrefix.length);
  }

  /**
   * Decodes a standard SAE J2012 Diagnostic Trouble Code from 2 hex bytes (4 characters).
   * J2012 format:
   * High byte bits 7-6: System (00=P, 01=C, 10=B, 11=U)
   * High byte bits 5-4: Code type (0-3)
   * High byte bits 3-0: Sub-system digit
   * Low byte: Specific fault identifier (2 hex digits)
   */
  static decodeDtc(b1Hex: string, b2Hex: string): string | null {
    const b1 = parseInt(b1Hex, 16);
    const b2 = parseInt(b2Hex, 16);
    if (isNaN(b1) || isNaN(b2)) return null;
    if (b1 === 0 && b2 === 0) return null; // Empty DTC slot

    const systems = ['P', 'C', 'B', 'U'];
    const system = systems[(b1 >> 6) & 0x03];
    const digit1 = (b1 >> 4) & 0x03;
    const digit2 = (b1 & 0x0f).toString(16).toUpperCase();
    const digit3 = ((b2 >> 4) & 0x0f).toString(16).toUpperCase();
    const digit4 = (b2 & 0x0f).toString(16).toUpperCase();

    return `${system}${digit1}${digit2}${digit3}${digit4}`;
  }

  /**
   * Decodes Mode 03, Mode 07, or Mode 0A DTC response.
   */
  static parseDtcs(rawResponse: string, mode: '03' | '07' | '0A'): string[] {
    const clean = this.reassembleIsoTp(rawResponse);
    const expectedHeader = (parseInt(mode, 16) + 0x40).toString(16).toUpperCase();
    const idx = clean.indexOf(expectedHeader);
    if (idx === -1) return [];

    let payload = clean.slice(idx + expectedHeader.length);
    // In multi-frame ISO-TP, the first byte can be DTC count on CAN
    if (payload.length % 4 !== 0 && payload.length >= 2) {
      // Possible leading byte count
      payload = payload.slice(2);
    }

    const dtcs: string[] = [];
    for (let i = 0; i + 3 < payload.length; i += 4) {
      const code = this.decodeDtc(payload.slice(i, i + 2), payload.slice(i + 2, i + 4));
      if (code && !dtcs.includes(code)) {
        dtcs.push(code);
      }
    }
    return dtcs;
  }

  /**
   * Decodes Mode 09 PID 02 VIN (Vehicle Identification Number).
   */
  static parseVin(rawResponse: string): string | null {
    const clean = this.reassembleIsoTp(rawResponse);
    const header = '4902';
    const idx = clean.indexOf(header);
    if (idx === -1) return null;

    let payload = clean.slice(idx + header.length);
    // Skip message count byte if present (e.g. 01 for 1 VIN message)
    if (payload.length >= 36) {
      payload = payload.slice(2);
    }

    let ascii = '';
    for (let i = 0; i + 1 < payload.length; i += 2) {
      const charCode = parseInt(payload.slice(i, i + 2), 16);
      if (charCode >= 32 && charCode <= 126) {
        ascii += String.fromCharCode(charCode);
      }
    }

    // A valid VIN is exactly 17 alphanumeric characters (excluding I, O, Q)
    const match = ascii.match(/[A-HJ-NPR-Z0-9]{17}/i);
    return match ? match[0].toUpperCase() : null;
  }

  /**
   * Parses Mode 01 PID calculations.
   * Accepts either 2-char PID ("0D", "0C") or full Mode 01 request ("010D", "010C").
   */
  static parsePidValue(pid: string, rawResponse: string): number | boolean | null {
    const normalizedPid = pid
      .replace(/\s+/g, '')
      .toUpperCase()
      .replace(/^01([0-9A-F]{2})$/, '$1');
    const clean = this.cleanResponse(rawResponse);
    const data = this.extractPositiveResponse(clean, '01', normalizedPid);
    if (!data) return null;

    const b = (start: number, len = 2) => parseInt(data.slice(start, start + len), 16);

    switch (normalizedPid) {
      case '0C': // RPM: ((A*256)+B)/4
        if (data.length >= 4) return (b(0) * 256 + b(2)) / 4;
        break;
      case '0D': // Speed: A km/h
        if (data.length >= 2) return b(0);
        break;
      case '05': // Coolant Temp: A - 40 (°C)
        if (data.length >= 2) return b(0) - 40;
        break;
      case '0F': // Intake Air Temp: A - 40 (°C)
        if (data.length >= 2) return b(0) - 40;
        break;
      case '11': // Throttle Position: A * 100 / 255 (%)
        if (data.length >= 2) return (b(0) * 100) / 255;
        break;
      case '04': // Calculated Engine Load: A * 100 / 255 (%)
        if (data.length >= 2) return (b(0) * 100) / 255;
        break;
      case '10': // MAF air flow rate: ((A*256)+B) / 100 (g/s)
        if (data.length >= 4) return (b(0) * 256 + b(2)) / 100;
        break;
      case '2F': // Fuel Tank Level: A * 100 / 255 (%)
        if (data.length >= 2) return (b(0) * 100) / 255;
        break;
      case '5C': // Engine Oil Temperature: A - 40 (°C)
        if (data.length >= 2) return b(0) - 40;
        break;
      case '46': // Ambient Air Temperature: A - 40 (°C)
        if (data.length >= 2) return b(0) - 40;
        break;
      case '23': // Fuel Rail Pressure (diesel / direct injection): ((A*256)+B) * 10 (kPa)
        if (data.length >= 4) return (b(0) * 256 + b(2)) * 10;
        break;
      case '42': // Control Module Voltage: ((A*256)+B) / 1000 (V)
        if (data.length >= 4) return (b(0) * 256 + b(2)) / 1000;
        break;
      case '01': // MIL Status: bit 7 of byte A
        if (data.length >= 2) return (b(0) & 0x80) !== 0;
        break;
      case '21': // Distance traveled with MIL on: (A*256)+B (km)
        if (data.length >= 4) return b(0) * 256 + b(2);
        break;
      case '31': // Distance since codes cleared: (A*256)+B (km)
        if (data.length >= 4) return b(0) * 256 + b(2);
        break;
    }

    return null;
  }

  /**
   * Formats an ELM327 initialization sequence.
   * Returns commands in exact execution order.
   */
  static getInitCommands(): { cmd: string; timeout: number; desc: string }[] {
    return [
      { cmd: 'ATZ', timeout: 3000, desc: 'Reset ELM327 / STN adapter' },
      { cmd: 'ATE0', timeout: 1500, desc: 'Echo off' },
      { cmd: 'ATL0', timeout: 1500, desc: 'Linefeeds off' },
      { cmd: 'ATS0', timeout: 1500, desc: 'Spaces off' },
      { cmd: 'ATH0', timeout: 1500, desc: 'CAN headers off for OBD-II' },
      { cmd: 'ATAT1', timeout: 1500, desc: 'Adaptive timing auto 1' },
      { cmd: 'ATAL', timeout: 1500, desc: 'Allow long ISO-TP messages' },
      { cmd: 'ATSP0', timeout: 5000, desc: 'Automatic protocol search' },
      { cmd: 'ATDP', timeout: 2500, desc: 'Display detected protocol' },
      { cmd: 'ATRV', timeout: 2000, desc: 'Read battery voltage' },
    ];
  }
}
