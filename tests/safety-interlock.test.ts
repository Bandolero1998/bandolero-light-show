import test from 'node:test';
import assert from 'node:assert';
import { SafetyInterlock } from '../src/services/safety-interlock';
import { ParsedLiveData } from '../src/services/elm327-protocol';

test('SafetyInterlock allows simulation mode unconditionally', () => {
  const status = SafetyInterlock.evaluate(null, false, true);
  assert.strictEqual(status.isSafe, true);
  assert.strictEqual(status.canArmLightShow, true);
});

test('SafetyInterlock trips lockdown when vehicle is in motion (speed > 0 km/h)', () => {
  const liveMoving: ParsedLiveData = {
    speed: 35,
    rpm: 1500,
    voltage: 13.8,
    dtcs: [],
    pendingDtcs: [],
    permanentDtcs: [],
    timestamp: Date.now(),
  };

  const status = SafetyInterlock.evaluate(liveMoving, true, false);
  assert.strictEqual(status.isSafe, false);
  assert.strictEqual(status.canArmLightShow, false);
  assert.strictEqual(status.speedVerifiedZero, false);
  assert.ok(status.criticalLockReason?.includes('VOZILO U POKRETU'));
});

test('SafetyInterlock locks when engine RPM is excessively high (> 1100 RPM)', () => {
  const liveHighRpm: ParsedLiveData = {
    speed: 0,
    rpm: 2500,
    voltage: 14.1,
    dtcs: [],
    pendingDtcs: [],
    permanentDtcs: [],
    timestamp: Date.now(),
  };

  const status = SafetyInterlock.evaluate(liveHighRpm, true, false);
  assert.strictEqual(status.isSafe, false);
  assert.strictEqual(status.canArmLightShow, false);
  assert.strictEqual(status.rpmSafe, false);
  assert.ok(status.criticalLockReason?.includes('VISOKI OBRTAJI MOTORA'));
});

test('SafetyInterlock permits actuation when vehicle safely stationary (speed 0 km/h, idle/off)', () => {
  const liveStationary: ParsedLiveData = {
    speed: 0,
    rpm: 0, // Engine off, ignition ON
    voltage: 12.4,
    dtcs: [],
    pendingDtcs: [],
    permanentDtcs: [],
    timestamp: Date.now(),
  };

  const status = SafetyInterlock.evaluate(liveStationary, true, false);
  assert.strictEqual(status.isSafe, true);
  assert.strictEqual(status.canArmLightShow, true);
  assert.strictEqual(status.speedVerifiedZero, true);
  assert.strictEqual(status.rpmSafe, true);
  assert.strictEqual(status.voltageSufficient, true);
});

test('SafetyInterlock blocks when Bluetooth connection is disconnected', () => {
  const status = SafetyInterlock.evaluate(null, false, false);
  assert.strictEqual(status.isSafe, false);
  assert.strictEqual(status.connectionActive, false);
  assert.ok(status.criticalLockReason?.includes('Bluetooth adapter nije povezan'));
});
