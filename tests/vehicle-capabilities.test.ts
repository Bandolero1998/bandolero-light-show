import test from 'node:test';
import assert from 'node:assert';
import { VehicleCapabilitiesDetector } from '../src/services/vehicle-capabilities';

test('VehicleCapabilitiesDetector.decodePidBitmap correctly decodes Mode 01 PID 00 bitmap', () => {
  // Example bitmap: BE 1F B8 11
  // Hex: BE (10111110) 1F (00011111) B8 (10111000) 11 (00010001)
  // Last bit is 1, meaning next block (PID 20) is supported!
  const raw = '41 00 BE 1F B8 11>';
  const res = VehicleCapabilitiesDetector.decodePidBitmap('00', raw);

  assert.strictEqual(res.hasNextBlock, true);
  // PID 01 (Status), PID 03, PID 04 (Load), PID 05 (Coolant), PID 0C (RPM), PID 0D (Speed) should be supported
  assert.ok(res.supportedPids.includes('01'));
  assert.ok(res.supportedPids.includes('04'));
  assert.ok(res.supportedPids.includes('05'));
  assert.ok(res.supportedPids.includes('0C'));
  assert.ok(res.supportedPids.includes('0D'));
  assert.ok(res.supportedPids.includes('20'));
});

test('VehicleCapabilitiesDetector.buildCapabilities builds full capability summary', () => {
  const pids = ['01', '04', '05', '0C', '0D', '10', '2F', '5C'];
  const caps = VehicleCapabilitiesDetector.buildCapabilities(
    pids,
    'ISO 15765-4 (CAN 11/500)',
    'STN2120 v5.1 / vLinker BM+',
    {},
    'WAUZZZ4H7BN123456'
  );

  assert.strictEqual(caps.hasLiveSpeed, true);
  assert.strictEqual(caps.hasEngineRpm, true);
  assert.strictEqual(caps.hasCoolantTemp, true);
  assert.strictEqual(caps.hasOilTemp, true);
  assert.strictEqual(caps.hasFuelLevel, true);
  assert.strictEqual(caps.hasMaf, true);
  assert.strictEqual(caps.supportsVin, true);
  assert.strictEqual(caps.vin, 'WAUZZZ4H7BN123456');
  assert.strictEqual(caps.protocol, 'ISO 15765-4 (CAN 11/500)');
});
