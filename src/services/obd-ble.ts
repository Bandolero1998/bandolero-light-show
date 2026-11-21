/**
 * BANDOLERO LIGHT SHOW 1.2.0
 * Bluetooth LE & ELM327/STN OBD Client
 *
 * Designed for Vgate / VLinker BM+ (BLE dual mode) and compatible ELM327 / STN adapters.
 * Implements GATT UART transport, multi-protocol negotiation, PID discovery,
 * real-time sensor polling, and diagnostic trouble code read/clear.
 */

import { Platform } from 'react-native';
import { Elm327Protocol, ParsedLiveData } from './elm327-protocol';
import { VehicleCapabilities, VehicleCapabilitiesDetector } from './vehicle-capabilities';

export type AdapterInfo = {
  id: string;
  name: string;
  rssi?: number | null;
  isKnownObd?: boolean;
};

export type LiveData = ParsedLiveData;

type BleDevice = {
  id: string;
  name?: string | null;
  localName?: string | null;
  rssi?: number | null;
  connect: (options?: any) => Promise<any>;
  discoverAllServicesAndCharacteristics: () => Promise<any>;
  services: () => Promise<any[]>;
  characteristicsForService: (serviceUuid: string) => Promise<any[]>;
  cancelConnection: () => Promise<any>;
  onDisconnected: (callback: (error: any, device: any) => void) => { remove: () => void };
  monitorCharacteristicForService: (
    serviceUUID: string,
    characteristicUUID: string,
    callback: (error: any, characteristic: any) => void
  ) => { remove: () => void };
  writeCharacteristicWithResponseForService: (
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string
  ) => Promise<any>;
  writeCharacteristicWithoutResponseForService: (
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string
  ) => Promise<any>;
};

type Characteristic = {
  uuid: string;
  serviceUUID: string;
  isWritableWithResponse?: boolean;
  isWritableWithoutResponse?: boolean;
  isNotifiable?: boolean;
  isIndicatable?: boolean;
};

const bleModule = () => {
  if (Platform.OS === 'web') {
    throw new Error('Bluetooth OBD veza radi samo u iOS/Android aplikaciji, ne u web pregledaču.');
  }
  return require('react-native-ble-plx');
};

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(input: string): string {
  let output = '';
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i) & 255;
    const hasB = i + 1 < input.length;
    const hasC = i + 2 < input.length;
    const b = hasB ? input.charCodeAt(i + 1) & 255 : 0;
    const c = hasC ? input.charCodeAt(i + 2) & 255 : 0;
    output +=
      B64_CHARS[a >> 2] +
      B64_CHARS[((a & 3) << 4) | (b >> 4)] +
      (hasB ? B64_CHARS[((b & 15) << 2) | (c >> 6)] : '=') +
      (hasC ? B64_CHARS[c & 63] : '=');
  }
  return output;
}

function fromBase64(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  let output = '';
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_CHARS.indexOf(clean[i]);
    const b = B64_CHARS.indexOf(clean[i + 1]);
    const c = clean[i + 2] === '=' ? -1 : B64_CHARS.indexOf(clean[i + 2]);
    const d = clean[i + 3] === '=' ? -1 : B64_CHARS.indexOf(clean[i + 3]);
    if (a < 0 || b < 0) continue;
    output += String.fromCharCode((a << 2) | (b >> 4));
    if (c >= 0) output += String.fromCharCode(((b & 15) << 4) | (c >> 2));
    if (d >= 0 && c >= 0) output += String.fromCharCode(((c & 3) << 6) | d);
  }
  return output;
}

export class ObdBleClient {
  private manager: any = null;
  private device: BleDevice | null = null;
  private writer: Characteristic | null = null;
  private reader: Characteristic | null = null;
  private subscription: { remove: () => void } | null = null;
  private buffer = '';
  private pending: {
    resolve: (response: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private disconnectHandler: (() => void) | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private capabilities: VehicleCapabilities | null = null;

  constructor() {
    if (Platform.OS !== 'web') {
      try {
        const { BleManager } = bleModule();
        this.manager = new BleManager();
      } catch (e) {
        console.warn('BleManager initialization deferred or unavailable:', e);
      }
    }
  }

  get isConnected(): boolean {
    return this.device !== null && this.writer !== null && this.reader !== null;
  }

  get currentCapabilities(): VehicleCapabilities | null {
    return this.capabilities;
  }

  /**
   * Scans for nearby BLE OBD adapters (VLinker BM+, Vgate, ELM327, etc.)
   */
  async scan(onFound: (adapter: AdapterInfo) => void, seconds = 12): Promise<void> {
    if (!this.manager) {
      const { BleManager } = bleModule();
      this.manager = new BleManager();
    }
    await this.stopScan();

    return new Promise((resolve, reject) => {
      let isDone = false;
      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          this.manager.stopDeviceScan();
          resolve();
        }
      }, seconds * 1000);

      try {
        this.manager.startDeviceScan(null, { allowDuplicates: false }, (error: any, device: BleDevice | null) => {
          if (error) {
            clearTimeout(timer);
            isDone = true;
            this.manager.stopDeviceScan();
            reject(error);
            return;
          }
          if (device) {
            const rawName = device.name || device.localName || '';
            const isKnown = /vlinker|vgate|obd|elm|stn|bm.?ios|bm\+|icar|viecar|konnwei/i.test(rawName);
            const displayName = rawName || (device.id ? `OBD Device (${device.id.slice(0, 5)})` : 'Nepoznat uređaj');

            onFound({
              id: device.id,
              name: displayName,
              rssi: device.rssi,
              isKnownObd: isKnown,
            });
          }
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  async stopScan(): Promise<void> {
    try {
      if (this.manager) await this.manager.stopDeviceScan();
    } catch {}
  }

  /**
   * Connects to a selected BLE OBD adapter, identifies GATT UART services,
   * configures ELM327/STN parameters, and queries vehicle protocol.
   */
  async connect(
    deviceId: string,
    onDisconnect?: () => void
  ): Promise<{ name: string; protocol: string; adapterModel: string; voltage?: number }> {
    await this.disconnect();

    if (!this.manager) {
      const { BleManager } = bleModule();
      this.manager = new BleManager();
    }

    const connectedDevice = (await this.manager.connectToDevice(deviceId, {
      timeout: 15000,
      autoConnect: false,
    })) as BleDevice;

    this.device = (await connectedDevice.discoverAllServicesAndCharacteristics()) as BleDevice;
    const services = await this.device.services();

    // Prioritized list of known OBD UART service UUIDs:
    // 1. FFF0: Vgate / VLinker BM+ UART
    // 2. 6E400001: Nordic UART Service (NUS)
    // 3. FFE0: TI CC2540 BLE-UART
    // 4. Any service containing both writable and notifiable characteristics
    let selectedPair: { writer: Characteristic; reader: Characteristic } | null = null;

    for (const service of services) {
      const chars = (await this.device.characteristicsForService(service.uuid)) as Characteristic[];
      const writer = chars.find(c => c.isWritableWithResponse) || chars.find(c => c.isWritableWithoutResponse);
      const reader = chars.find(c => c.isNotifiable || c.isIndicatable);

      if (writer && reader) {
        selectedPair = { writer, reader };
        // If it's a known OBD service, stop searching immediately
        const sUuid = service.uuid.toLowerCase();
        if (sUuid.includes('fff0') || sUuid.includes('6e400001') || sUuid.includes('ffe0')) {
          break;
        }
      }
    }

    if (!selectedPair) {
      await this.disconnect();
      throw new Error(
        'Povezan je Bluetooth uređaj, ali nije pronađen OBD UART komunikacioni kanal (write + notify). Proveri da li je izabran ispravan VLinker adapter.'
      );
    }

    this.writer = selectedPair.writer;
    this.reader = selectedPair.reader;
    this.buffer = '';

    this.subscription = this.device.monitorCharacteristicForService(
      this.reader.serviceUUID,
      this.reader.uuid,
      (error: any, characteristic: any) => {
        if (error) {
          if (this.pending) {
            this.pending.reject(new Error(error.message || 'BLE notifikacija je prijavila grešku'));
            this.pending = null;
          }
          return;
        }
        if (!characteristic?.value) return;

        try {
          this.buffer += fromBase64(characteristic.value);
        } catch {
          return;
        }

        // ELM327 prompt character '>' signals end of response
        if (this.pending && (this.buffer.includes('>') || this.buffer.includes('\r\n\r\n'))) {
          const p = this.pending;
          this.pending = null;
          clearTimeout(p.timer);
          const answer = this.buffer;
          this.buffer = '';
          p.resolve(answer);
        }
      }
    );

    this.disconnectHandler = onDisconnect || null;
    this.device.onDisconnected(() => {
      this.stopPolling();
      this.device = null;
      this.writer = null;
      this.reader = null;
      this.subscription?.remove();
      this.subscription = null;
      this.disconnectHandler?.();
    });

    try {
      // 1. Adapter reset & identification
      const adapterModel = (await this.command('ATI', 4000)).replace(/[\r\n>]/g, ' ').trim() || 'vLinker BM+ / ELM327';

      // 2. Configure ELM327 / STN communication parameters
      await this.command('ATE0', 2000); // Echo Off
      await this.command('ATL0', 2000); // Linefeeds Off
      await this.command('ATS0', 2000); // Spaces Off
      await this.command('ATH0', 2000); // Headers Off
      await this.command('ATAT1', 2000); // Adaptive Timing Auto 1
      await this.command('ATAL', 2000); // Allow Long messages (ISO-TP)
      await this.command('ATSP0', 6000); // Automatic Protocol Search

      // 3. Read battery voltage from pin 16
      let voltage: number | undefined;
      try {
        const vRaw = await this.command('ATRV', 2500);
        const vNum = parseFloat(vRaw.replace(/[^0-9.]/g, ''));
        if (!isNaN(vNum)) voltage = vNum;
      } catch {}

      // 4. Query detected vehicle protocol
      const protoRaw = await this.command('ATDP', 4000);
      const protocol = protoRaw.replace(/[\r\n>]/g, '').trim() || 'ISO 15765-4 (CAN)';

      // 5. Test ECU response with Mode 01 PID 00
      const ecuTest = await this.command('0100', 8000);
      if (/NO DATA|UNABLE TO CONNECT|BUS INIT|STOPPED/i.test(ecuTest)) {
        throw new Error(
          'Bluetooth veza sa adapterom je uspostavljena, ali motorni računar vozila nije odgovorio. Proveri da je kontakt uključen i da je VLinker BM+ čvrsto spojen na OBD-II port.'
        );
      }

      const deviceDisplayName = this.device?.name || this.device?.localName || 'vLinker BM+';
      return {
        name: deviceDisplayName,
        protocol,
        adapterModel,
        voltage,
      };
    } catch (err) {
      await this.disconnect();
      throw err;
    }
  }

  /**
   * Sends an AT or OBD hex command and awaits the prompt response.
   */
  async command(cmd: string, timeout = 3500): Promise<string> {
    if (!this.writer || !this.device) {
      throw new Error('OBD adapter nije povezan.');
    }
    if (this.pending) {
      throw new Error('OBD komunikacija je zauzeta prethodnom komandom.');
    }

    this.buffer = '';
    const responsePromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`Vreme za odgovor na komandu "${cmd}" je isteklo (${timeout}ms).`));
      }, timeout);
      this.pending = { resolve, reject, timer };
    });

    const payloadBase64 = toBase64(`${cmd}\r`);
    if (this.writer.isWritableWithResponse) {
      await this.device.writeCharacteristicWithResponseForService(
        this.writer.serviceUUID,
        this.writer.uuid,
        payloadBase64
      );
    } else {
      await this.device.writeCharacteristicWithoutResponseForService(
        this.writer.serviceUUID,
        this.writer.uuid,
        payloadBase64
      );
    }

    return responsePromise;
  }

  /**
   * Scans and maps all vehicle capabilities and supported PIDs (Mode 01 PID 00, 20, 40, etc.).
   */
  async scanCapabilities(): Promise<VehicleCapabilities> {
    if (!this.isConnected) {
      throw new Error('Adapter nije povezan.');
    }

    const allPids: string[] = [];
    const bitmaps: Record<string, string> = {};

    // 1. Mode 01 PID 00 (PIDs 01 - 20)
    try {
      const resp00 = await this.command('0100', 4000);
      bitmaps['00'] = resp00;
      const b00 = VehicleCapabilitiesDetector.decodePidBitmap('00', resp00);
      allPids.push(...b00.supportedPids);

      // 2. Mode 01 PID 20 (PIDs 21 - 40) if supported
      if (b00.hasNextBlock) {
        const resp20 = await this.command('0120', 3500);
        bitmaps['20'] = resp20;
        const b20 = VehicleCapabilitiesDetector.decodePidBitmap('20', resp20);
        allPids.push(...b20.supportedPids);

        // 3. Mode 01 PID 40 (PIDs 41 - 60) if supported
        if (b20.hasNextBlock) {
          const resp40 = await this.command('0140', 3500);
          bitmaps['40'] = resp40;
          const b40 = VehicleCapabilitiesDetector.decodePidBitmap('40', resp40);
          allPids.push(...b40.supportedPids);
        }
      }
    } catch {}

    // Read VIN (Mode 09 PID 02)
    let vin: string | null = null;
    try {
      const vinResp = await this.command('0902', 4500);
      vin = Elm327Protocol.parseVin(vinResp);
    } catch {}

    const protoRaw = await this.command('ATDP', 2500).catch(() => 'Automatski');
    const protocol = protoRaw.replace(/[\r\n>]/g, '').trim();
    const adapterModel = (await this.command('ATI', 2500).catch(() => 'vLinker BM+'))
      .replace(/[\r\n>]/g, ' ')
      .trim();

    const capabilities = VehicleCapabilitiesDetector.buildCapabilities(
      allPids,
      protocol,
      adapterModel,
      bitmaps,
      vin
    );
    this.capabilities = capabilities;
    return capabilities;
  }

  /**
   * Reads a full snapshot of live OBD-II metrics and DTCs.
   */
  async readLiveData(): Promise<LiveData> {
    const result: LiveData = {
      dtcs: [],
      pendingDtcs: [],
      permanentDtcs: [],
      timestamp: Date.now(),
    };

    const isSupported = (pid: string) => {
      if (!this.capabilities) return true;
      return this.capabilities.supportedPids.includes(pid);
    };

    // Engine RPM (010C)
    if (isSupported('0C')) {
      try {
        const r = await this.command('010C', 2500);
        const val = Elm327Protocol.parsePidValue('0C', r);
        if (typeof val === 'number') result.rpm = val;
      } catch {}
    }

    // Vehicle Speed (010D)
    if (isSupported('0D')) {
      try {
        const r = await this.command('010D', 2500);
        const val = Elm327Protocol.parsePidValue('0D', r);
        if (typeof val === 'number') result.speed = val;
      } catch {}
    }

    // Engine Coolant Temperature (0105)
    if (isSupported('05')) {
      try {
        const r = await this.command('0105', 2500);
        const val = Elm327Protocol.parsePidValue('05', r);
        if (typeof val === 'number') result.coolant = val;
      } catch {}
    }

    // Intake Air Temperature (010F)
    if (isSupported('0F')) {
      try {
        const r = await this.command('010F', 2500);
        const val = Elm327Protocol.parsePidValue('0F', r);
        if (typeof val === 'number') result.intake = val;
      } catch {}
    }

    // Throttle Position (0111)
    if (isSupported('11')) {
      try {
        const r = await this.command('0111', 2500);
        const val = Elm327Protocol.parsePidValue('11', r);
        if (typeof val === 'number') result.throttle = val;
      } catch {}
    }

    // Calculated Engine Load (0104)
    if (isSupported('04')) {
      try {
        const r = await this.command('0104', 2500);
        const val = Elm327Protocol.parsePidValue('04', r);
        if (typeof val === 'number') result.engineLoad = val;
      } catch {}
    }

    // MAF Air Flow Rate (0110)
    if (isSupported('10')) {
      try {
        const r = await this.command('0110', 2500);
        const val = Elm327Protocol.parsePidValue('10', r);
        if (typeof val === 'number') result.maf = val;
      } catch {}
    }

    // Fuel Tank Level (012F)
    if (isSupported('2F')) {
      try {
        const r = await this.command('012F', 2500);
        const val = Elm327Protocol.parsePidValue('2F', r);
        if (typeof val === 'number') result.fuelLevel = val;
      } catch {}
    }

    // Engine Oil Temperature (015C - common on VAG TDI)
    if (isSupported('5C')) {
      try {
        const r = await this.command('015C', 2500);
        const val = Elm327Protocol.parsePidValue('5C', r);
        if (typeof val === 'number') result.oilTemp = val;
      } catch {}
    }

    // Ambient Air Temperature (0146)
    if (isSupported('46')) {
      try {
        const r = await this.command('0146', 2500);
        const val = Elm327Protocol.parsePidValue('46', r);
        if (typeof val === 'number') result.ambientTemp = val;
      } catch {}
    }

    // Fuel Rail Pressure (0123 - diesel common rail for Audi 4.2 TDI)
    if (isSupported('23')) {
      try {
        const r = await this.command('0123', 2500);
        const val = Elm327Protocol.parsePidValue('23', r);
        if (typeof val === 'number') result.fuelRailPressure = val;
      } catch {}
    }

    // Control Module Voltage (0142)
    if (isSupported('42')) {
      try {
        const r = await this.command('0142', 2500);
        const val = Elm327Protocol.parsePidValue('42', r);
        if (typeof val === 'number') result.controlModuleVoltage = val;
      } catch {}
    }

    // Battery Voltage via ATRV
    try {
      const v = await this.command('ATRV', 2000);
      const num = parseFloat(v.replace(/[^0-9.]/g, ''));
      if (!isNaN(num)) result.voltage = num;
    } catch {}

    // MIL Status & DTC Count (0101)
    if (isSupported('01')) {
      try {
        const r = await this.command('0101', 2500);
        const milVal = Elm327Protocol.parsePidValue('01', r);
        if (typeof milVal === 'boolean') result.mil = milVal;
      } catch {}
    }

    // Distance traveled with MIL on (0121)
    if (isSupported('21')) {
      try {
        const r = await this.command('0121', 2500);
        const val = Elm327Protocol.parsePidValue('21', r);
        if (typeof val === 'number') result.milDistance = val;
      } catch {}
    }

    // Stored Fault Codes (Mode 03)
    try {
      const dtcResp = await this.command('03', 3500);
      result.dtcs = Elm327Protocol.parseDtcs(dtcResp, '03');
    } catch {}

    // Pending Fault Codes (Mode 07)
    try {
      const pResp = await this.command('07', 3000);
      result.pendingDtcs = Elm327Protocol.parseDtcs(pResp, '07');
    } catch {}

    return result;
  }

  /**
   * Clears stored diagnostic trouble codes and turns off MIL (Mode 04).
   * Note: Requires engine to be off with ignition on.
   */
  async clearDtcCodes(): Promise<boolean> {
    if (!this.isConnected) throw new Error('Adapter nije povezan.');
    const resp = await this.command('04', 5000);
    return !/ERROR|NO DATA/i.test(resp);
  }

  /**
   * Starts a continuous live polling loop for real-time dashboard display.
   */
  startPolling(onData: (data: LiveData) => void, intervalMs = 800) {
    this.stopPolling();
    let isFetching = false;

    this.pollingTimer = setInterval(async () => {
      if (isFetching || !this.isConnected) return;
      isFetching = true;
      try {
        const data = await this.readLiveData();
        onData(data);
      } catch {} finally {
        isFetching = false;
      }
    }, intervalMs);
  }

  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  async disconnect(): Promise<void> {
    this.stopPolling();
    await this.stopScan();
    this.subscription?.remove();
    this.subscription = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Veza sa OBD adapterom je prekinuta.'));
      this.pending = null;
    }
    const currentDevice = this.device;
    this.device = null;
    this.writer = null;
    this.reader = null;
    if (currentDevice) {
      try {
        await currentDevice.cancelConnection();
      } catch {}
    }
  }

  async destroy(): Promise<void> {
    await this.disconnect();
    try {
      this.manager?.destroy();
    } catch {}
  }
}
