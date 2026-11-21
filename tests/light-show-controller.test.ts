import test from 'node:test';
import assert from 'node:assert';
import { AVAILABLE_EFFECTS, LightShowController } from '../src/services/light-show-controller';
import type { ObdBleClient } from '../src/services/obd-ble';

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

test('LightShowController parses ATS0 dual-ECU 410D00 response and completes UDS sequence', async () => {
  const sent: string[] = [];
  const mockClient = {
    isConnected: true,
    isBusy: false,
    stopPolling() {},
    async command(cmd: string): Promise<string> {
      sent.push(cmd);
      if (cmd === '010D') return '410D00 410D00>';
      if (cmd === '010C') return '410C0000 410C0000>';
      if (cmd === '10 03') return '5003003201F4>';
      if (cmd.startsWith('2F')) return '6F010503>';
      return 'OK>';
    },
  } as unknown as ObdBleClient;

  const controller = new LightShowController(mockClient);
  const res = await controller.runVehicleSequence('highbeam');

  assert.strictEqual(res.success, true);
  // Verify exact pre-check and UDS sequence order
  assert.strictEqual(sent[0], 'ATSH 7DF');
  assert.strictEqual(sent[1], 'ATCRA');
  assert.strictEqual(sent[2], '010D');
  assert.strictEqual(sent[3], '010C');
  assert.strictEqual(sent[4], 'ATSH 70E');
  assert.strictEqual(sent[5], 'ATCRA 778');
  assert.strictEqual(sent[6], '10 03');
  assert.ok(sent.includes('2F010503'));
  assert.ok(sent.includes('2F010500'));
  assert.strictEqual(sent[sent.length - 4], '2F000000');
  assert.strictEqual(sent[sent.length - 3], '10 01');
  assert.strictEqual(sent[sent.length - 2], 'ATSH 7DF');
  assert.strictEqual(sent[sent.length - 1], 'ATCRA');
});
