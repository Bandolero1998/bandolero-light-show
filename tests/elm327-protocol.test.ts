import test from 'node:test';
import assert from 'node:assert';
import { Elm327Protocol } from '../src/services/elm327-protocol';

test('Elm327Protocol.cleanResponse removes echo, prompt, carriage return, and spaces', () => {
  const raw = '01 0C\r\r41 0C 1A F8\r\n>';
  const clean = Elm327Protocol.cleanResponse(raw);
  assert.strictEqual(clean, '010C410C1AF8');
});

test('Elm327Protocol.parsePidValue decodes Mode 01 PID 0C (Engine RPM)', () => {
  // RPM = ((A*256)+B)/4. For 0x1A 0xF8 = (26*256 + 248)/4 = 6904/4 = 1726 RPM
  const raw = '41 0C 1A F8>';
  const rpm = Elm327Protocol.parsePidValue('0C', raw);
  assert.strictEqual(rpm, 1726);
});

test('Elm327Protocol.parsePidValue decodes Mode 01 PID 0D (Vehicle Speed)', () => {
  // Speed = A km/h. For 0x00 = 0 km/h, 0x4B = 75 km/h
  const raw0 = '41 0D 00>';
  assert.strictEqual(Elm327Protocol.parsePidValue('0D', raw0), 0);

  const raw75 = '41 0D 4B>';
  assert.strictEqual(Elm327Protocol.parsePidValue('0D', raw75), 75);
});

test('Elm327Protocol.parsePidValue decodes Mode 01 PID 05 (Coolant Temperature)', () => {
  // Coolant = A - 40. For 0x82 (130) -> 90 °C
  const raw = '41 05 82>';
  assert.strictEqual(Elm327Protocol.parsePidValue('05', raw), 90);
});

test('Elm327Protocol.parsePidValue decodes Mode 01 PID 5C (Oil Temperature)', () => {
  // Oil Temp = A - 40. For 0x87 (135) -> 95 °C
  const raw = '41 5C 87>';
  assert.strictEqual(Elm327Protocol.parsePidValue('5C', raw), 95);
});

test('Elm327Protocol.decodeDtc converts standard SAE J2012 fault codes correctly', () => {
  // P0101: Mass Air Flow Sensor Circuit Range/Performance
  // P = 00, digit 0 = 0, digit 1 = 1, byte 2 = 01 -> 0x01 0x01
  assert.strictEqual(Elm327Protocol.decodeDtc('01', '01'), 'P0101');

  // P0401: Exhaust Gas Recirculation Flow Insufficient
  // 0x04 0x01 -> P0401
  assert.strictEqual(Elm327Protocol.decodeDtc('04', '01'), 'P0401');

  // U0100: Lost Communication with ECM/PCM
  // U = 11 (bit 7-6 = 3 -> 0xC0). 0xC1 0x00 -> U0100
  assert.strictEqual(Elm327Protocol.decodeDtc('C1', '00'), 'U0100');

  // Empty slot (00 00) returns null
  assert.strictEqual(Elm327Protocol.decodeDtc('00', '00'), null);
});

test('Elm327Protocol.parseDtcs extracts Mode 03 stored fault codes', () => {
  const raw = '43 01 01 04 01 00 00>';
  const dtcs = Elm327Protocol.parseDtcs(raw, '03');
  assert.deepStrictEqual(dtcs, ['P0101', 'P0401']);
});

test('Elm327Protocol.parseVin parses 17-character VIN from Mode 09 PID 02 ISO-TP frames', () => {
  // Audi A8 D4 sample VIN: WAUZZZ4H7BN000000
  // Multi-line CAN ISO-TP response:
  const raw = `0: 49 02 01 57 41 55\r
1: 5A 5A 5A 34 48 37 42\r
2: 4E 30 30 30 30 30 30>`;

  const vin = Elm327Protocol.parseVin(raw);
  assert.strictEqual(vin, 'WAUZZZ4H7BN000000');
});
