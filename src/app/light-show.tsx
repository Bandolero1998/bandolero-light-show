import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useAppStore } from '@/store/app-store';
import { getSharedObdClient } from '@/services/obd-ble';
import { AudiSpeedometer } from '@/components/audi-speedometer';
import {
  A8DiagnosticsService,
  AirSuspensionReport,
  ModuleScanEntry,
  PerformanceRunRecord,
} from '@/services/a8-diagnostics';

type CockpitTab = 'speedo' | 'suspension' | 'modules';
type TimerState = 'idle' | 'armed' | 'running' | 'finished';

export default function A8CockpitScreen() {
  const {
    vehicles,
    activeVehicleId,
    lastObdData,
    connectionStatus,
    performanceRuns,
    addPerformanceRun,
    clearPerformanceRuns,
  } = useAppStore();

  const sharedClient = getSharedObdClient();
  const active = vehicles.find(v => v.id === activeVehicleId);
  const isConnected = sharedClient.isConnected || connectionStatus === 'connected';

  const [tab, setTab] = useState<CockpitTab>('speedo');
  const [mirrorHud, setMirrorHud] = useState(false);

  // Demo simulation for testing the classic Audi speedometer & 0-100 timer indoors
  const [isDemoRunning, setIsDemoRunning] = useState(false);
  const [demoSpeed, setDemoSpeed] = useState(0);
  const [demoRpm, setDemoRpm] = useState(720);

  // Performance timer state (0-60, 0-100, 100-200, 402m, Vmax)
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [zeroTo60, setZeroTo60] = useState<number | null>(null);
  const [zeroTo100, setZeroTo100] = useState<number | null>(null);
  const [hundredTo200, setHundredTo200] = useState<number | null>(null);
  const [quarterMile, setQuarterMile] = useState<number | null>(null);
  const [maxSpeed, setMaxSpeed] = useState(0);

  const runStartMsRef = useRef<number | null>(null);
  const hit100MsRef = useRef<number | null>(null);
  const lastSampleMsRef = useRef<number | null>(null);
  const distanceMetersRef = useRef<number>(0);

  // Air Suspension (0x71D) Read-Only Health Check
  const [isCheckingAir, setIsCheckingAir] = useState(false);
  const [airReport, setAirReport] = useState<AirSuspensionReport | null>(null);

  // Full 16-Module A8 D4 Scan
  const [isScanningModules, setIsScanningModules] = useState(false);
  const [scanProgressText, setScanProgressText] = useState<string | null>(null);
  const [moduleResults, setModuleResults] = useState<ModuleScanEntry[]>([]);

  const liveSpeed = isDemoRunning ? demoSpeed : (lastObdData?.speed ?? 0);
  const liveRpm = isDemoRunning ? demoRpm : lastObdData?.rpm;
  const oilTemp = lastObdData?.oilTemp;
  const coolantTemp = lastObdData?.coolant;
  const voltage = lastObdData?.voltage ?? lastObdData?.controlModuleVoltage;
  const railBar =
    lastObdData?.fuelRailPressure !== undefined
      ? Math.round(lastObdData.fuelRailPressure / 100)
      : undefined;

  // Demo 0-205 km/h acceleration curve (Audi A8 D4 4.2 TDI ~5.5s 0-100)
  useEffect(() => {
    if (!isDemoRunning) return;
    const started = Date.now();
    const id = setInterval(() => {
      const t = (Date.now() - started) / 1000;
      if (t >= 18) {
        setIsDemoRunning(false);
        setDemoSpeed(0);
        setDemoRpm(720);
        return;
      }
      // Realistic 4.2 TDI acceleration profile: 0-100 in ~5.5s, 100-200 in ~11.5s
      const spd = Math.min(205, Math.round(215 * (1 - Math.exp(-t / 8.8))));
      const gearRpm = 1800 + ((spd * 48) % 2400);
      setDemoSpeed(spd);
      setDemoRpm(Math.min(4400, Math.round(gearRpm)));
    }, 60);
    return () => clearInterval(id);
  }, [isDemoRunning]);

  // Performance timer tracking on every speed update (live OBD or Demo)
  useEffect(() => {
    if (timerState !== 'armed' && timerState !== 'running') return;
    const now = Date.now();

    if (timerState === 'armed') {
      if (liveSpeed >= 2) {
        runStartMsRef.current = now;
        lastSampleMsRef.current = now;
        distanceMetersRef.current = 0;
        hit100MsRef.current = null;
        setTimerState('running');
        setMaxSpeed(liveSpeed);
      }
      return;
    }

    if (timerState === 'running' && runStartMsRef.current !== null) {
      const elapsed = (now - runStartMsRef.current) / 1000;
      setElapsedSec(elapsed);

      if (lastSampleMsRef.current !== null) {
        const dtSec = (now - lastSampleMsRef.current) / 1000;
        distanceMetersRef.current += (liveSpeed / 3.6) * dtSec;
      }
      lastSampleMsRef.current = now;

      setMaxSpeed(prev => Math.max(prev, liveSpeed));

      if (zeroTo60 === null && liveSpeed >= 60) {
        setZeroTo60(Number(elapsed.toFixed(2)));
      }
      if (zeroTo100 === null && liveSpeed >= 100) {
        setZeroTo100(Number(elapsed.toFixed(2)));
        hit100MsRef.current = now;
      }
      if (hundredTo200 === null && hit100MsRef.current !== null && liveSpeed >= 200) {
        setHundredTo200(Number(((now - hit100MsRef.current) / 1000).toFixed(2)));
      }
      if (quarterMile === null && distanceMetersRef.current >= 402.3) {
        setQuarterMile(Number(elapsed.toFixed(2)));
      }
    }
  }, [liveSpeed, timerState, zeroTo60, zeroTo100, hundredTo200, quarterMile]);

  const armTimer = () => {
    setElapsedSec(0);
    setZeroTo60(null);
    setZeroTo100(null);
    setHundredTo200(null);
    setQuarterMile(null);
    setMaxSpeed(0);
    runStartMsRef.current = null;
    hit100MsRef.current = null;
    distanceMetersRef.current = 0;
    setTimerState('armed');
  };

  const stopAndSaveRun = () => {
    setIsDemoRunning(false);
    setTimerState('finished');
    if (zeroTo60 !== null || zeroTo100 !== null || maxSpeed >= 40) {
      const record: PerformanceRunRecord = {
        id: `run-${Date.now()}`,
        dateIso: new Date().toLocaleString('sr-RS', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        zeroTo60Sec: zeroTo60,
        zeroTo100Sec: zeroTo100,
        hundredTo200Sec: hundredTo200,
        quarterMileSec: quarterMile,
        maxSpeedKmh: Math.round(maxSpeed),
        oilTempC: oilTemp !== undefined ? Math.round(oilTemp) : undefined,
      };
      addPerformanceRun(record);
    }
  };

  const startDemoRun = () => {
    armTimer();
    setDemoSpeed(0);
    setDemoRpm(750);
    setIsDemoRunning(true);
  };

  const handleCheckAirSuspension = async () => {
    if (!sharedClient.isConnected) {
      Alert.alert(
        'OBD adapter nije povezan',
        'Poveži VLinker BM+ u Settings tabu pre provere vazdušnog vešanja.'
      );
      return;
    }
    setIsCheckingAir(true);
    try {
      const svc = new A8DiagnosticsService(sharedClient);
      const report = await svc.checkAirSuspension();
      setAirReport(report);
    } catch (err: any) {
      Alert.alert('Greška', err?.message || 'Provera vazdušnog vešanja nije uspela.');
    } finally {
      setIsCheckingAir(false);
    }
  };

  const handleScanAllModules = async () => {
    if (!sharedClient.isConnected) {
      Alert.alert(
        'OBD adapter nije povezan',
        'Poveži VLinker BM+ u Settings tabu pre skeniranja modula.'
      );
      return;
    }
    setIsScanningModules(true);
    setModuleResults([]);
    try {
      const svc = new A8DiagnosticsService(sharedClient);
      const results = await svc.scanAll16Modules((name, idx, total) => {
        setScanProgressText(`Skeniram (${idx}/${total}): ${name}...`);
      });
      setModuleResults(results);
    } catch (err: any) {
      Alert.alert('Greška', err?.message || 'Skeniranje modula nije uspelo.');
    } finally {
      setIsScanningModules(false);
      setScanProgressText(null);
    }
  };

  const handleClearModuleDtcs = async (entry: ModuleScanEntry) => {
    Alert.alert(
      `Obriši greške: ${entry.module.name}`,
      `Da li želiš da pošalješ UDS 14 FF FF FF za brisanje grešaka u modulu ${entry.module.vagAddress} (0x${entry.module.tx})?`,
      [
        { text: 'Otkaži', style: 'cancel' },
        {
          text: 'Obriši',
          style: 'destructive',
          onPress: async () => {
            try {
              const svc = new A8DiagnosticsService(sharedClient);
              const ok = await svc.clearModuleDtcs(entry.module.tx, entry.module.rx);
              Alert.alert(
                ok ? 'Obrisano' : 'Nije potvrđeno',
                ok
                  ? `Greške u modulu ${entry.module.name} su obrisane.`
                  : 'Modul nije vratio pozitivan 54 odgovor.'
              );
              if (ok) {
                setModuleResults(prev =>
                  prev.map(r => (r.module.tx === entry.module.tx ? { ...r, dtcs: [] } : r))
                );
              }
            } catch (err: any) {
              Alert.alert('Greška', err?.message || 'Brisanje grešaka nije uspelo.');
            }
          },
        },
      ]
    );
  };

  const oilWarm = oilTemp !== undefined && oilTemp >= 80;

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.brand}>BANDOLERO</Text>
        <Text style={s.title}>A8 D4 COCKPIT</Text>
        <Text style={s.sub}>
          {active ? `${active.make.toUpperCase()} ${active.model.toUpperCase()} ${active.engine}` : 'AUDI A8 D4 4.2 TDI'} ·{' '}
          {isConnected ? 'VLINKER ONLINE' : 'OFFLINE'}
        </Text>

        {/* Top 3-Tab Switcher */}
        <View style={s.tabBar}>
          <TouchableOpacity
            style={[s.tabBtn, tab === 'speedo' && s.tabBtnActive]}
            onPress={() => setTab('speedo')}
          >
            <Text style={[s.tabText, tab === 'speedo' && s.tabTextActive]}>BRZINOMER</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tabBtn, tab === 'suspension' && s.tabBtnActive]}
            onPress={() => setTab('suspension')}
          >
            <Text style={[s.tabText, tab === 'suspension' && s.tabTextActive]}>VEŠANJE</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tabBtn, tab === 'modules' && s.tabBtnActive]}
            onPress={() => setTab('modules')}
          >
            <Text style={[s.tabText, tab === 'modules' && s.tabTextActive]}>16 MODULA</Text>
          </TouchableOpacity>
        </View>

        {/* ==================== TAB 1: CLASSIC AUDI A8 SPEEDOMETER & 0-100 ==================== */}
        {tab === 'speedo' && (
          <View>
            <View style={s.speedoCard}>
              <View style={s.speedoHeaderRow}>
                <View style={s.warmPill}>
                  <View
                    style={[
                      s.warmDot,
                      {
                        backgroundColor:
                          oilTemp === undefined ? '#71717A' : oilWarm ? '#10B981' : '#38BDF8',
                      },
                    ]}
                  />
                  <Text style={s.warmText}>
                    {oilTemp === undefined
                      ? 'ULJE: --°C'
                      : oilWarm
                      ? `ULJE ${Math.round(oilTemp)}°C · READY`
                      : `ULJE ${Math.round(oilTemp)}°C · ZAGREVA SE`}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[s.hudBtn, mirrorHud && s.hudBtnActive]}
                  onPress={() => setMirrorHud(!mirrorHud)}
                >
                  <Text style={[s.hudBtnText, mirrorHud && { color: '#fff' }]}>
                    {mirrorHud ? 'HUD ON' : 'HUD OGLEDALO'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={s.speedoCenter}>
                <AudiSpeedometer
                  speedKmh={liveSpeed}
                  rpm={liveRpm}
                  maxSpeed={280}
                  mirrorHud={mirrorHud}
                  size={274}
                />
              </View>

              {/* Live 4.2 TDI Telemetry Strip */}
              <View style={s.telemetryRow}>
                <View style={s.teleCell}>
                  <Text style={s.teleLabel}>VODA</Text>
                  <Text style={s.teleVal}>
                    {coolantTemp !== undefined ? `${Math.round(coolantTemp)}°C` : '--'}
                  </Text>
                </View>
                <View style={s.teleCell}>
                  <Text style={s.teleLabel}>ULJE</Text>
                  <Text style={s.teleVal}>
                    {oilTemp !== undefined ? `${Math.round(oilTemp)}°C` : '--'}
                  </Text>
                </View>
                <View style={s.teleCell}>
                  <Text style={s.teleLabel}>RAIL</Text>
                  <Text style={s.teleVal}>{railBar !== undefined ? `${railBar} bar` : '--'}</Text>
                </View>
                <View style={s.teleCell}>
                  <Text style={s.teleLabel}>NAPON</Text>
                  <Text style={s.teleVal}>
                    {voltage !== undefined ? `${voltage.toFixed(1)}V` : '--'}
                  </Text>
                </View>
              </View>
            </View>

            {/* 0-100 / 100-200 / 402m Performance Timer */}
            <View style={s.perfCard}>
              <View style={s.perfHeader}>
                <Text style={s.perfTitle}>⏱ 0–100 / 100–200 / 402m TAJMER</Text>
                <Text style={s.perfBadge}>
                  {timerState === 'armed'
                    ? 'ČEKA START...'
                    : timerState === 'running'
                    ? `${elapsedSec.toFixed(2)} s`
                    : timerState === 'finished'
                    ? 'ZAVRŠENO'
                    : 'SPREMAN'}
                </Text>
              </View>

              <View style={s.splitGrid}>
                <View style={s.splitBox}>
                  <Text style={s.splitLabel}>0 – 60 km/h</Text>
                  <Text style={s.splitVal}>
                    {zeroTo60 !== null ? `${zeroTo60.toFixed(2)} s` : '--.-- s'}
                  </Text>
                </View>
                <View style={[s.splitBox, s.splitBoxHighlight]}>
                  <Text style={[s.splitLabel, { color: '#FCA5A5' }]}>0 – 100 km/h</Text>
                  <Text style={[s.splitVal, { color: '#fff', fontSize: 22 }]}>
                    {zeroTo100 !== null ? `${zeroTo100.toFixed(2)} s` : '--.-- s'}
                  </Text>
                </View>
                <View style={s.splitBox}>
                  <Text style={s.splitLabel}>100 – 200 km/h</Text>
                  <Text style={s.splitVal}>
                    {hundredTo200 !== null ? `${hundredTo200.toFixed(2)} s` : '--.-- s'}
                  </Text>
                </View>
                <View style={s.splitBox}>
                  <Text style={s.splitLabel}>402m · Vmax</Text>
                  <Text style={s.splitVal}>
                    {quarterMile !== null ? `${quarterMile.toFixed(2)}s` : `${Math.round(maxSpeed)} km/h`}
                  </Text>
                </View>
              </View>

              <View style={s.actionRow}>
                {timerState === 'running' || timerState === 'armed' ? (
                  <TouchableOpacity style={[s.primaryBtn, { flex: 1 }]} onPress={stopAndSaveRun}>
                    <Text style={s.primaryBtnText}>⏹ ZAUSTAVI & SAČUVAJ</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[s.primaryBtn, { flex: 1 }]} onPress={armTimer}>
                    <Text style={s.primaryBtnText}>▶ PRIPREMI START (0–100)</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={s.secondaryBtn}
                  onPress={isDemoRunning ? stopAndSaveRun : startDemoRun}
                >
                  <Text style={s.secondaryBtnText}>
                    {isDemoRunning ? 'STOP DEMO' : 'DEMO 0–200'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Saved Best Runs */}
            {performanceRuns.length > 0 && (
              <View style={s.historyCard}>
                <View style={s.perfHeader}>
                  <Text style={s.perfTitle}>🏆 SAČUVANA MERENJA ({performanceRuns.length})</Text>
                  <TouchableOpacity onPress={clearPerformanceRuns}>
                    <Text style={s.clearLink}>Obriši</Text>
                  </TouchableOpacity>
                </View>
                {performanceRuns.slice(0, 6).map(r => (
                  <View key={r.id} style={s.historyRow}>
                    <Text style={s.historyDate}>{r.dateIso}</Text>
                    <Text style={s.historyMetric}>
                      0–100: <Text style={{ color: '#fff', fontWeight: '900' }}>{r.zeroTo100Sec !== null ? `${r.zeroTo100Sec.toFixed(2)}s` : '--'}</Text>
                    </Text>
                    <Text style={s.historyMetric}>
                      100–200: {r.hundredTo200Sec !== null ? `${r.hundredTo200Sec.toFixed(2)}s` : '--'}
                    </Text>
                    <Text style={s.historyMetric}>Max {r.maxSpeedKmh}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ==================== TAB 2: AIR SUSPENSION (0x71D) READ-ONLY CHECK ==================== */}
        {tab === 'suspension' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>🛞 VAZDUŠNO VEŠANJE — PROVERA JASTUKA (0x71D)</Text>
            <Text style={s.cardSub}>
              100% bezbedno čitanje (Read-Only) iz Modula 34 (Level Control). Proverava ispravnost sva 4 jastuka, ventila, kompresora i očitava visinu bez ikakvog rizika po kompresor ili kalibraciju.
            </Text>

            {/* 4-Corner Visual Car Air Bag Status */}
            <View style={s.airDiagram}>
              <View style={s.airRow}>
                <View
                  style={[
                    s.bagBox,
                    airReport?.allBagsHealthy && s.bagBoxOk,
                    airReport && !airReport.allBagsHealthy && airReport.reachable && s.bagBoxWarn,
                  ]}
                >
                  <Text style={s.bagCorner}>PREDNJI LEVI (FL)</Text>
                  <Text style={s.bagStatus}>
                    {!airReport
                      ? 'ČEKA PROVERU'
                      : airReport.heightsMm.fl !== null
                      ? `${airReport.heightsMm.fl} mm`
                      : airReport.allBagsHealthy
                      ? 'JASTUK OK ✓'
                      : 'PROVERI DTC'}
                  </Text>
                </View>
                <View
                  style={[
                    s.bagBox,
                    airReport?.allBagsHealthy && s.bagBoxOk,
                    airReport && !airReport.allBagsHealthy && airReport.reachable && s.bagBoxWarn,
                  ]}
                >
                  <Text style={s.bagCorner}>PREDNJI DESNI (FR)</Text>
                  <Text style={s.bagStatus}>
                    {!airReport
                      ? 'ČEKA PROVERU'
                      : airReport.heightsMm.fr !== null
                      ? `${airReport.heightsMm.fr} mm`
                      : airReport.allBagsHealthy
                      ? 'JASTUK OK ✓'
                      : 'PROVERI DTC'}
                  </Text>
                </View>
              </View>

              <Text style={s.carCenterIcon}>🚘</Text>

              <View style={s.airRow}>
                <View
                  style={[
                    s.bagBox,
                    airReport?.allBagsHealthy && s.bagBoxOk,
                    airReport && !airReport.allBagsHealthy && airReport.reachable && s.bagBoxWarn,
                  ]}
                >
                  <Text style={s.bagCorner}>ZADNJI LEVI (RL)</Text>
                  <Text style={s.bagStatus}>
                    {!airReport
                      ? 'ČEKA PROVERU'
                      : airReport.heightsMm.rl !== null
                      ? `${airReport.heightsMm.rl} mm`
                      : airReport.allBagsHealthy
                      ? 'JASTUK OK ✓'
                      : 'PROVERI DTC'}
                  </Text>
                </View>
                <View
                  style={[
                    s.bagBox,
                    airReport?.allBagsHealthy && s.bagBoxOk,
                    airReport && !airReport.allBagsHealthy && airReport.reachable && s.bagBoxWarn,
                  ]}
                >
                  <Text style={s.bagCorner}>ZADNJI DESNI (RR)</Text>
                  <Text style={s.bagStatus}>
                    {!airReport
                      ? 'ČEKA PROVERU'
                      : airReport.heightsMm.rr !== null
                      ? `${airReport.heightsMm.rr} mm`
                      : airReport.allBagsHealthy
                      ? 'JASTUK OK ✓'
                      : 'PROVERI DTC'}
                  </Text>
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={[s.primaryBtn, (!isConnected || isCheckingAir) && s.disabledBtn]}
              onPress={handleCheckAirSuspension}
              disabled={!isConnected || isCheckingAir}
            >
              {isCheckingAir ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.primaryBtnText}>🔍 PROVERI JASTUKE I VISINU (0x71D)</Text>
              )}
            </TouchableOpacity>

            {airReport && (
              <View
                style={[
                  s.reportBox,
                  airReport.allBagsHealthy ? s.reportBoxOk : s.reportBoxErr,
                ]}
              >
                <Text style={s.reportTitle}>
                  {airReport.allBagsHealthy
                    ? '✅ SVI JASTUCI I KOMPRESOR SU DOBRI'
                    : '⚠️ PROVERI STANJE VEŠANJA'}
                </Text>
                <Text style={s.reportText}>{airReport.summary}</Text>
                {airReport.partNumber && (
                  <Text style={s.reportMeta}>
                    Modul 34: {airReport.partNumber} {airReport.systemName ? `(${airReport.systemName})` : ''}
                  </Text>
                )}
                {airReport.dtcs.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    {airReport.dtcs.map((d, i) => (
                      <Text key={i} style={s.dtcLine}>
                        • UDS DTC 0x{d.codeHex} (status 0x{d.statusByte}) {d.isActive ? '— AKTIVNA' : '— memorisana'}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* ==================== TAB 3: FULL 16-MODULE A8 D4 DOCTOR ==================== */}
        {tab === 'modules' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>🩺 AUDI A8 D4 — 16-MODULE AUTO-SCAN</Text>
            <Text style={s.cardSub}>
              Skenira greške (UDS 19 02) na svih 16 modula potvrđenih na tvom Audi A8 D4: Vazdušno vešanje, ABS, Menjač, Tabla, Airbag, Ručna, Klima, Park senzori, Gateway, Sedišta i Pojasevi.
            </Text>

            <TouchableOpacity
              style={[s.primaryBtn, (!isConnected || isScanningModules) && s.disabledBtn]}
              onPress={handleScanAllModules}
              disabled={!isConnected || isScanningModules}
            >
              {isScanningModules ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.primaryBtnText}>🔍 SKENIRAJ SVIH 16 MODULA</Text>
              )}
            </TouchableOpacity>

            {scanProgressText && (
              <Text style={s.progressNote}>{scanProgressText}</Text>
            )}

            {moduleResults.length > 0 && (
              <View style={{ marginTop: 14, gap: 8 }}>
                {moduleResults.map(entry => {
                  const hasFaults = entry.dtcs.length > 0;
                  return (
                    <View
                      key={entry.module.tx}
                      style={[
                        s.modRow,
                        hasFaults ? s.modRowFault : entry.reachable ? s.modRowOk : s.modRowOff,
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.modName}>
                          [{entry.module.vagAddress}] {entry.module.name}
                        </Text>
                        <Text style={s.modMeta}>
                          0x{entry.module.tx}/0x{entry.module.rx} ·{' '}
                          {!entry.reachable
                            ? 'Nije odgovorio'
                            : hasFaults
                            ? `${entry.dtcs.length} grešaka (${entry.dtcs.map(d => d.codeHex).slice(0, 3).join(', ')})`
                            : '0 grešaka — OK ✓'}
                        </Text>
                      </View>
                      {hasFaults && (
                        <TouchableOpacity
                          style={s.clearModBtn}
                          onPress={() => handleClearModuleDtcs(entry)}
                        >
                          <Text style={s.clearModText}>OBRIŠI</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#050507' },
  content: { padding: 20, paddingTop: 68, paddingBottom: 140 },
  brand: { color: '#EF4444', fontSize: 11, fontWeight: '900', letterSpacing: 5 },
  title: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 8 },
  sub: { color: '#8E868A', fontSize: 10, letterSpacing: 2, marginTop: 4, marginBottom: 16 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#110D0F',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2E161A',
  },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 9 },
  tabBtnActive: { backgroundColor: '#DC2626' },
  tabText: { color: '#94868A', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  tabTextActive: { color: '#fff' },
  speedoCard: {
    backgroundColor: '#0E0B0C',
    borderWidth: 1,
    borderColor: '#3A151B',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
  },
  speedoHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  warmPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#161114',
    borderWidth: 1,
    borderColor: '#2E161A',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  warmDot: { width: 7, height: 7, borderRadius: 4 },
  warmText: { color: '#E2E8F0', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  hudBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  hudBtnActive: { backgroundColor: '#DC2626', borderColor: '#EF4444' },
  hudBtnText: { color: '#D4D4D8', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  speedoCenter: { alignItems: 'center', marginVertical: 6 },
  telemetryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#261316',
  },
  teleCell: { alignItems: 'center', flex: 1 },
  teleLabel: { color: '#8E868A', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  teleVal: { color: '#fff', fontSize: 13, fontWeight: '900', marginTop: 3 },
  perfCard: {
    backgroundColor: '#110D0F',
    borderWidth: 1,
    borderColor: '#3A151B',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  perfHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  perfTitle: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  perfBadge: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  splitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  splitBox: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#07080B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 12,
    padding: 12,
  },
  splitBoxHighlight: { borderColor: '#DC2626', backgroundColor: '#1A0B0E' },
  splitLabel: { color: '#9CA3AF', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  splitVal: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  actionRow: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    backgroundColor: '#DC2626',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  secondaryBtn: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#E4E4E7', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  disabledBtn: { backgroundColor: '#2A1B1E', opacity: 0.6 },
  historyCard: {
    backgroundColor: '#110D0F',
    borderWidth: 1,
    borderColor: '#2E161A',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  clearLink: { color: '#EF4444', fontSize: 10, fontWeight: '800' },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#221316',
  },
  historyDate: { color: '#71717A', fontSize: 10 },
  historyMetric: { color: '#D4D4D8', fontSize: 10 },
  card: {
    backgroundColor: '#110D0F',
    borderWidth: 1,
    borderColor: '#3A151B',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  cardSub: { color: '#A1A1AA', fontSize: 10, lineHeight: 16, marginBottom: 14 },
  airDiagram: {
    backgroundColor: '#07080B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    alignItems: 'center',
  },
  airRow: { flexDirection: 'row', gap: 10, width: '100%' },
  bagBox: {
    flex: 1,
    backgroundColor: '#141418',
    borderWidth: 1,
    borderColor: '#3F3F46',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  bagBoxOk: { borderColor: '#10B981', backgroundColor: '#06281E' },
  bagBoxWarn: { borderColor: '#EF4444', backgroundColor: '#2B0D11' },
  bagCorner: { color: '#9CA3AF', fontSize: 8, fontWeight: '800', letterSpacing: 0.6 },
  bagStatus: { color: '#fff', fontSize: 12, fontWeight: '900', marginTop: 4 },
  carCenterIcon: { fontSize: 42, marginVertical: 10 },
  reportBox: { marginTop: 14, borderRadius: 12, padding: 12, borderWidth: 1 },
  reportBoxOk: { backgroundColor: '#06281E', borderColor: '#10B981' },
  reportBoxErr: { backgroundColor: '#2B0D11', borderColor: '#EF4444' },
  reportTitle: { color: '#fff', fontSize: 11, fontWeight: '900', marginBottom: 4 },
  reportText: { color: '#E2E8F0', fontSize: 10, lineHeight: 15 },
  reportMeta: {
    color: '#93C5FD',
    fontSize: 9,
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  dtcLine: {
    color: '#FCA5A5',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  progressNote: { color: '#93C5FD', fontSize: 10, textAlign: 'center', marginTop: 10 },
  modRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    padding: 11,
    borderWidth: 1,
  },
  modRowOk: { backgroundColor: '#071E17', borderColor: '#065F46' },
  modRowFault: { backgroundColor: '#250B0E', borderColor: '#DC2626' },
  modRowOff: { backgroundColor: '#141418', borderColor: '#27272A' },
  modName: { color: '#fff', fontSize: 11, fontWeight: '800' },
  modMeta: {
    color: '#A1A1AA',
    fontSize: 9,
    marginTop: 3,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  clearModBtn: {
    backgroundColor: '#991B1B',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 8,
  },
  clearModText: { color: '#fff', fontSize: 9, fontWeight: '900' },
});
