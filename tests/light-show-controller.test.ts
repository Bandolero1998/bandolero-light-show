import test from 'node:test';
import assert from 'node:assert';
import { AVAILABLE_EFFECTS, LightShowController, parseUds2fResponse } from '../src/services/light-show-controller';
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
  let pollingPausedCount = 0;
  let pollingResumedCount = 0;
  const mockClient = {
    isConnected: true,
    isBusy: false,
    stopPolling() {},
    pausePolling() {
      pollingPausedCount++;
    },
    resumePolling() {
      pollingResumedCount++;
    },
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
  assert.strictEqual(pollingPausedCount, 1);
  assert.strictEqual(pollingResumedCount, 1);
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
  assert.strictEqual(sent[sent.length - 3], '10 01');
  assert.strictEqual(sent[sent.length - 2], 'ATSH 7DF');
  assert.strictEqual(sent[sent.length - 1], 'ATCRA');
});

test('parseUds2fResponse detects 6F positive and 7F 2F XX negative NRC codes', () => {
  assert.strictEqual(parseUds2fResponse('6F010503>').accepted, true);

  const nrc31 = parseUds2fResponse('7F2F31>');
  assert.strictEqual(nrc31.accepted, false);
  assert.strictEqual(nrc31.nrc, '31');

  const nrc33 = parseUds2fResponse('7F 2F 33>');
  assert.strictEqual(nrc33.accepted, false);
  assert.strictEqual(nrc33.nrc, '33');

  const nrc22 = parseUds2fResponse('7F2F22>');
  assert.strictEqual(nrc22.accepted, false);
  assert.strictEqual(nrc22.nrc, '22');
});

test('LightShowController reports failure when Module 09 rejects 2F with 7F2F31', async () => {
  const mockClient = {
    isConnected: true,
    isBusy: false,
    stopPolling() {},
    pausePolling() {},
    resumePolling() {},
    async command(cmd: string): Promise<string> {
      if (cmd === '010D') return '410D00 410D00>';
      if (cmd === '010C') return '410C0000 410C0000>';
      if (cmd === '10 03') return '5003003201F4>';
      if (cmd.startsWith('2F')) return '7F2F31>';
      return 'OK>';
    },
  } as unknown as ObdBleClient;

  const controller = new LightShowController(mockClient);
  const res = await controller.runVehicleSequence('highbeam');

  assert.strictEqual(res.success, false);
  assert.ok(res.message.includes('7F 2F 31'));
});

test('LightShowController.testManualDid sends 10 03, 2F <DID> 03 01, 2F <DID> 00, and restores 10 01', async () => {
  const sent: string[] = [];
  const mockClient = {
    isConnected: true,
    isBusy: false,
    stopPolling() {},
    pausePolling() {},
    resumePolling() {},
    async command(cmd: string): Promise<string> {
      sent.push(cmd);
      if (cmd === '010D') return '410D00>';
      if (cmd === '10 03') return '5003003201F4>';
      if (cmd === '2FF1230301') return '6FF12303>';
      if (cmd === '2FF12300') return '6FF12300>';
      return 'OK>';
    },
  } as unknown as ObdBleClient;

  const controller = new LightShowController(mockClient);
  const res = await controller.testManualDid('f123', '01');

  assert.strictEqual(res.accepted, true);
  assert.strictEqual(res.did, 'F123');
  assert.ok(sent.includes('10 03'));
  assert.ok(sent.includes('2FF1230301'));
  assert.ok(sent.includes('2FF12300'));
  assert.strictEqual(sent[sent.length - 3], '10 01');
  assert.strictEqual(sent[sent.length - 2], 'ATSH 7DF');
  assert.strictEqual(sent[sent.length - 1], 'ATCRA');
});
