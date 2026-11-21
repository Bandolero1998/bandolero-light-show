import test from 'node:test';
import assert from 'node:assert';
import { AVAILABLE_EFFECTS } from '../src/services/light-show-controller';

test('LightShowController provides configured effects with testing indicators', () => {
  assert.ok(AVAILABLE_EFFECTS.length >= 4);
  const welcome = AVAILABLE_EFFECTS.find(e => e.id === 'welcome');
  assert.ok(welcome !== undefined);
  assert.strictEqual(welcome!.requiresVehicleTesting, true);
  assert.ok(welcome!.colors.length > 0);

  const hazard = AVAILABLE_EFFECTS.find(e => e.id === 'hazard');
  assert.ok(hazard !== undefined);
  assert.strictEqual(hazard!.requiresVehicleTesting, true);
});
