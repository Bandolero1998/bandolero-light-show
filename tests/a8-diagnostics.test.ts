import test from 'node:test';
import assert from 'node:assert';
import {
  A8DiagnosticsService,
  A8_D4_CONFIRMED_MODULES,
  parseSignedMmDid,
  parseUds1902Dtcs,
} from '../src/services/a8-diagnostics';
import type { ObdBleClient } from '../src/services/obd-ble';

test('parseUds1902Dtcs parses zero and active UDS DTCs from 59 02 response', () => {
  assert.deepStrictEqual(parseUds1902Dtcs('59 02 FF>'), []);
  const dtcs = parseUds1902Dtcs('59 02 FF 00 14 00 09 02 01 11 00>');
  assert.strictEqual(dtcs.length, 2);
  assert.strictEqual(dtcs[0].codeHex, '001400');
  assert.strictEqual(dtcs[0].isActive, true);
  assert.strictEqual(dtcs[1].codeHex, '020111');
  assert.strictEqual(dtcs[1].isActive, false);
});

test('parseSignedMmDid parses positive and negative millimeter values', () => {
  // +385 mm = 0x0181
  assert.strictEqual(parseSignedMmDid('62 10 01 01 81>', '1001'), 385);
  // -12 mm = 0xFFF4
  assert.strictEqual(parseSignedMmDid('62 10 02 FF F4>', '1002'), -12);
});

test('A8DiagnosticsService.checkAirSuspension reports healthy bags on 0x71D', async () => {
  const mockClient = {
    isConnected: true,
    pausePolling() {},
    resumePolling() {},
    async command(cmd: string): Promise<string> {
      if (cmd === '22 F1 87') return '0: 62 F1 87 34 48 30\r1: 39 30 37 35 35 33>';
      if (cmd === '22 F1 97') return '62F1974C554654464544>';
      if (cmd === '19 02 8F') return '5902FF>';
      if (cmd === '22 10 01') return '6210010180>';
      if (cmd === '22 10 02') return '6210020181>';
      if (cmd === '22 10 03') return '6210030184>';
      if (cmd === '22 10 04') return '6210040183>';
      return 'OK>';
    },
  } as unknown as ObdBleClient;

  const svc = new A8DiagnosticsService(mockClient);
  const report = await svc.checkAirSuspension();
  assert.strictEqual(report.reachable, true);
  assert.strictEqual(report.allBagsHealthy, true);
  assert.strictEqual(report.partNumber, '4H0907553');
  assert.strictEqual(report.heightsMm.fl, 384);
  assert.strictEqual(report.heightsMm.fr, 385);
  assert.strictEqual(A8_D4_CONFIRMED_MODULES.length, 16);
});
