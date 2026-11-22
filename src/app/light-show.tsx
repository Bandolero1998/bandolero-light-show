import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
  Platform,
  TextInput,
} from 'react-native';
import { useAppStore } from '@/store/app-store';
import {
  AVAILABLE_EFFECTS,
  CommandLogEntry,
  LightEffectId,
  LightShowController,
} from '@/services/light-show-controller';
import { SafetyInterlock } from '@/services/safety-interlock';
import { getSharedObdClient } from '@/services/obd-ble';

/**
 * Computes which front lamps are lit on a given animation tick (110ms per tick)
 * so police-style headlight patterns flash realistically in crisp headlight white.
 */
function getHeadlightFrame(effectId: LightEffectId, tick: number, playing: boolean) {
  if (!playing) {
    return { leftFog: false, leftMain: false, rightMain: false, rightFog: false, isAmber: false };
  }

  switch (effectId) {
    case 'police_wigwag': {
      // 2x Left (ticks 0, 2), pause (4), 2x Right (5, 7), pause (9)
      const t = tick % 10;
      const leftMain = t === 0 || t === 2;
      const rightMain = t === 5 || t === 7;
      return { leftFog: leftMain, leftMain, rightMain, rightFog: rightMain, isAmber: false };
    }
    case 'police_triple': {
      // 3x rapid Left (0, 2, 4), pause (6), 3x rapid Right (7, 9, 11), pause (13)
      const t = tick % 14;
      const leftMain = t === 0 || t === 2 || t === 4;
      const rightMain = t === 7 || t === 9 || t === 11;
      return { leftFog: leftMain, leftMain, rightMain, rightFog: rightMain, isAmber: false };
    }
    case 'police_sync': {
      // Both headlights double-flash together (0, 2) then longer dark pause (3..7)
      const t = tick % 8;
      const both = t === 0 || t === 2;
      return { leftFog: both, leftMain: both, rightMain: both, rightFog: both, isAmber: false };
    }
    case 'police_pursuit': {
      // Cross-flash: Left Main + Right Fog (0, 2) -> Right Main + Left Fog (4, 6)
      const t = tick % 8;
      const phaseA = t === 0 || t === 2;
      const phaseB = t === 4 || t === 6;
      return { leftFog: phaseB, leftMain: phaseA, rightMain: phaseB, rightFog: phaseA, isAmber: false };
    }
    case 'police_interceptor': {
      // Ultra-fast alternating L -> R -> L -> R
      const t = tick % 4;
      const left = t === 0;
      const right = t === 2;
      return { leftFog: left, leftMain: left, rightMain: right, rightFog: right, isAmber: false };
    }
    case 'sweep': {
      const t = tick % 8;
      return { leftFog: t < 3, leftMain: t === 1, rightMain: t === 5, rightFog: t >= 4 && t < 7, isAmber: true };
    }
    case 'hazard': {
      const on = Math.floor(tick / 3) % 2 === 0;
      return { leftFog: on, leftMain: false, rightMain: false, rightFog: on, isAmber: true };
    }
    case 'highbeam': {
      const on = tick % 6 < 3;
      return { leftFog: on, leftMain: on, rightMain: on, rightFog: on, isAmber: false };
    }
    case 'pulse': {
      const on = tick % 4 === 0 || tick % 4 === 1;
      return { leftFog: on, leftMain: on, rightMain: on, rightFog: on, isAmber: false };
    }
    case 'welcome':
    default: {
      const t = tick % 10;
      return {
        leftFog: t >= 1 && t <= 7,
        leftMain: t >= 2 && t <= 8,
        rightMain: t >= 3 && t <= 8,
        rightFog: t >= 4 && t <= 7,
        isAmber: false,
      };
    }
  }
}

export default function LightShowScreen() {
  const {
    vehicles,
    activeVehicleId,
    lastObdData,
    connectionStatus,
    isSafetyUnlocked,
    setSafetyUnlocked,
  } = useAppStore();

  const sharedClient = getSharedObdClient();

  const [mode, setMode] = useState<'simulation' | 'vehicle'>('simulation');
  const [selectedEffect, setSelectedEffect] = useState<LightEffectId>('police_wigwag');
  const [isPlayingSimulation, setIsPlayingSimulation] = useState(false);
  const [animStep, setAnimStep] = useState(0);

  const [isExecutingVehicle, setIsExecutingVehicle] = useState(false);
  const [vehicleProgress, setVehicleProgress] = useState<{ step: string; percent: number } | null>(null);
  const [commandLogs, setCommandLogs] = useState<CommandLogEntry[]>([]);
  const [manualDid, setManualDid] = useState('F123');
  const [manualState, setManualState] = useState('01');
  const [isTestingDid, setIsTestingDid] = useState(false);

  const controllerRef = useRef<LightShowController | null>(null);

  const active = vehicles.find(v => v.id === activeVehicleId);
  const isConnected = sharedClient.isConnected || connectionStatus === 'connected';

  // Evaluate safety status from latest cached OBD data (live 010D check also runs inside runVehicleSequence)
  const safety = SafetyInterlock.evaluate(
    lastObdData,
    isConnected,
    mode === 'simulation'
  );

  // Allow arming if connected and speed is not actively > 0 (since runVehicleSequence will do live ATSH 7DF -> ATCRA -> 010D check)
  const hasMovingLock = lastObdData?.speed !== undefined && lastObdData.speed > 0;
  const canStartVehicleTest = isConnected && !hasMovingLock && isSafetyUnlocked && !isExecutingVehicle;

  useEffect(() => {
    if (!controllerRef.current) {
      controllerRef.current = new LightShowController(sharedClient, entry => {
        setCommandLogs(prev => [entry, ...prev.slice(0, 59)]);
      });
    } else {
      controllerRef.current.setClient(sharedClient);
    }
  }, [isConnected, sharedClient]);

  // Fast 110ms Simulation Animation Loop for realistic police strobe timing
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isPlayingSimulation) {
      timer = setInterval(() => {
        setAnimStep(prev => (prev + 1) % 120);
      }, 110);
    } else {
      setAnimStep(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlayingSimulation]);

  const toggleSimulation = () => {
    setIsPlayingSimulation(!isPlayingSimulation);
  };

  const runVehicleTest = async () => {
    if (mode !== 'vehicle') return;

    // 1. Separate, clear connection check BEFORE any PID/safety message
    if (!sharedClient.isConnected) {
      Alert.alert(
        'OBD adapter nije povezan',
        'Aktivna Bluetooth sesija sa VLinker BM+ adapterom nije pronađena. Idi u Settings tab i poveži adapter.'
      );
      return;
    }

    if (hasMovingLock) {
      Alert.alert(
        'Bezbednosna blokada',
        `Vozilo se kreće (${lastObdData?.speed} km/h). Svetlosni šou je dozvoljen isključivo pri brzini 0 km/h.`
      );
      return;
    }

    if (!isSafetyUnlocked) {
      Alert.alert(
        'Potvrda bezbednosti',
        'Uključi prekidač "Potvrđujem da vozilo bezbedno miruje" pre pokretanja komandi.'
      );
      return;
    }

    Alert.alert(
      'Pokretanje testa na vozilu (Audi A8 D4 Module 09)',
      `Redosled izvršavanja:\n1. ATSH 7DF + ATCRA + provera 010D (0 km/h)\n2. Prebacivanje na Modul 09 (ATSH 70E/778 ili 710/77A)\n3. UDS Extended Session (10 03) + TesterPresent (3E 80)\n4. Efekat: ${selectedEffect.toUpperCase()}\n\nDa li je kontakt uključen i vozilo u mirovanju?`,
      [
        { text: 'Otkaži', style: 'cancel' },
        {
          text: 'Pokreni test',
          style: 'default',
          onPress: async () => {
            setIsExecutingVehicle(true);
            setCommandLogs([]);
            try {
              if (!controllerRef.current) {
                controllerRef.current = new LightShowController(sharedClient, entry => {
                  setCommandLogs(prev => [entry, ...prev.slice(0, 59)]);
                });
              } else {
                controllerRef.current.setClient(sharedClient);
              }
              const res = await controllerRef.current.runVehicleSequence(selectedEffect, (step, percent) => {
                setVehicleProgress({ step, percent });
              });
              Alert.alert(res.success ? 'Završeno' : 'Upozorenje (UDS 7F)', res.message);
            } catch (err: any) {
              Alert.alert('Prekid sekvence', err?.message || 'Greška tokom slanja komandi vozilu.');
            } finally {
              setIsExecutingVehicle(false);
              setVehicleProgress(null);
            }
          },
        },
      ]
    );
  };

  const handlePanicStop = async () => {
    try {
      controllerRef.current?.setClient(sharedClient);
      await controllerRef.current?.emergencyStop();
      setIsExecutingVehicle(false);
      setIsTestingDid(false);
      setVehicleProgress(null);
      Alert.alert('Zaustavljeno', 'TesterPresent je ugašen, sesija vraćena (10 01) i header resetovan na ATSH 7DF.');
    } catch (err: any) {
      Alert.alert('Greška', err?.message || 'Greška pri prinudnom zaustavljanju.');
    }
  };

  const handleTestManualDid = async () => {
    if (!sharedClient.isConnected) {
      Alert.alert(
        'OBD adapter nije povezan',
        'Aktivna Bluetooth sesija sa VLinker BM+ adapterom nije pronađena. Idi u Settings tab i poveži adapter.'
      );
      return;
    }
    if (hasMovingLock) {
      Alert.alert(
        'Bezbednosna blokada',
        `Vozilo se kreće (${lastObdData?.speed} km/h). Test DID-a je dozvoljen isključivo pri brzini 0 km/h.`
      );
      return;
    }
    if (!isSafetyUnlocked) {
      Alert.alert(
        'Potvrda bezbednosti',
        'Uključi prekidač "Potvrđujem da vozilo bezbedno miruje" pre testiranja DID adrese.'
      );
      return;
    }

    setIsTestingDid(true);
    try {
      if (!controllerRef.current) {
        controllerRef.current = new LightShowController(sharedClient, entry => {
          setCommandLogs(prev => [entry, ...prev.slice(0, 59)]);
        });
      } else {
        controllerRef.current.setClient(sharedClient);
      }
      const res = await controllerRef.current.testManualDid(manualDid, manualState);
      Alert.alert(res.accepted ? 'DID RADI (6F)' : 'DID NE RADI (7F)', res.message);
    } catch (err: any) {
      Alert.alert('Greška pri testiranju DID-a', err?.message || 'Test nije uspeo.');
    } finally {
      setIsTestingDid(false);
    }
  };

  const currentEffect = AVAILABLE_EFFECTS.find(e => e.id === selectedEffect);
  const frame = getHeadlightFrame(selectedEffect, animStep, isPlayingSimulation);
  const lampColor = frame.isAmber ? '#F59E0B' : '#FFFFFF';
  const lampGlow = frame.isAmber ? '#F59E0B' : '#E0F2FE';

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.brand}>BANDOLERO</Text>
        <Text style={s.title}>LIGHT SHOW</Text>
        <Text style={s.sub}>POLICE STROBE & AUDI A8 D4 UDS CONTROL</Text>

        {/* Mode Selector Tabs */}
        <View style={s.modeSelector}>
          <TouchableOpacity
            style={[s.modeTab, mode === 'simulation' && s.activeModeTab]}
            onPress={() => setMode('simulation')}
          >
            <Text style={[s.modeTabText, mode === 'simulation' && s.activeModeTabText]}>
              📱 SIMULACIJA
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.modeTab, mode === 'vehicle' && s.activeModeTab]}
            onPress={() => setMode('vehicle')}
          >
            <Text style={[s.modeTabText, mode === 'vehicle' && s.activeModeTabText]}>
              🚗 TEST NA VOZILU
            </Text>
          </TouchableOpacity>
        </View>

        {/* Selected Vehicle Card */}
        <View style={s.vehicle}>
          <Text style={s.miniLabel}>AKTIVNO VOZILO</Text>
          <Text style={s.vehicleName}>{active ? `${active.make} ${active.model}` : 'Nije izabrano vozilo'}</Text>
          <Text style={s.vehicleMeta}>
            {active ? `${active.year} · ${active.engine} · UDS CAN 0x710` : 'Dodaj vozilo u garaži'}
          </Text>
        </View>

        {/* Mode Specific Notices */}
        {mode === 'simulation' ? (
          <View style={s.simNotice}>
            <Text style={s.simNoticeTitle}>ℹ️ REŽIM EKRANSKE SIMULACIJE</Text>
            <Text style={s.simNoticeText}>
              Pretpregled policijskog blicanja u beloj boji farova i standardnih efekata direktno na ekranu. U ovom režimu komande se NE šalju vozilu.
            </Text>
          </View>
        ) : (
          <View style={[s.warning, !isConnected && { borderColor: '#DC2626' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Text style={{ fontSize: 14 }}>⚠️</Text>
              <Text style={s.warningTitle}>ZAHTEVA FIZIČKO TESTIRANJE NA VOZILU</Text>
            </View>
            <Text style={s.warningText}>
              Koristi deljenu VLinker BM+ sesiju: prvo resetuje header (ATSH 7DF / ATCRA) i proverava brzinu (010D), pa otvara Modul 09 (0x710, 10 03 + TesterPresent 3E 80).
            </Text>
            <View style={s.rule} />
            <Text style={s.safetyHeadline}>STATUS KONEKCIJE I BEZBEDNOSTI:</Text>
            <Text style={[s.safetyItem, { color: isConnected ? '#34D399' : '#FCA5A5', fontWeight: '800' }]}>
              • {isConnected ? 'OBD adapter je povezan (deljena BLE sesija aktivna)' : 'OBD adapter NIJE povezan — poveži ga u Settings tabu'}
            </Text>
            {isConnected && safety.reasons.map((r, i) => (
              <Text key={i} style={s.safetyItem}>• {r}</Text>
            ))}
            {hasMovingLock && (
              <View style={s.lockBanner}>
                <Text style={s.lockBannerText}>🔒 BLOKIRANO: Vozilo se kreće ({lastObdData?.speed} km/h)</Text>
              </View>
            )}
          </View>
        )}

        {/* Visual Light Box Simulation (placed above library for easy viewing!) */}
        <View style={s.previewBox}>
          <Text style={s.previewTitle}>
            {isPlayingSimulation ? `▶ ${currentEffect?.name}` : 'PRETPREGLED FAROVA (BOJA FARA)'}
          </Text>

          <View style={s.carGraphicBox}>
            <View style={s.headlightRow}>
              {/* Left Fog / DRL */}
              <View
                style={[
                  s.carLamp,
                  frame.leftFog && {
                    backgroundColor: lampColor,
                    shadowColor: lampGlow,
                    shadowOpacity: 1,
                    shadowRadius: 14,
                    elevation: 10,
                  },
                ]}
              />
              {/* Left Main Headlight */}
              <View
                style={[
                  s.carLampLarge,
                  frame.leftMain && {
                    backgroundColor: lampColor,
                    shadowColor: lampGlow,
                    shadowOpacity: 1,
                    shadowRadius: 18,
                    elevation: 14,
                  },
                ]}
              />
              {/* Center Grille / Badge */}
              <View style={s.carGrille}>
                <Text style={{ fontSize: 18 }}>🚘</Text>
              </View>
              {/* Right Main Headlight */}
              <View
                style={[
                  s.carLampLarge,
                  frame.rightMain && {
                    backgroundColor: lampColor,
                    shadowColor: lampGlow,
                    shadowOpacity: 1,
                    shadowRadius: 18,
                    elevation: 14,
                  },
                ]}
              />
              {/* Right Fog / DRL */}
              <View
                style={[
                  s.carLamp,
                  frame.rightFog && {
                    backgroundColor: lampColor,
                    shadowColor: lampGlow,
                    shadowOpacity: 1,
                    shadowRadius: 14,
                    elevation: 10,
                  },
                ]}
              />
            </View>
          </View>

          {mode === 'simulation' ? (
            <TouchableOpacity style={s.previewButton} onPress={toggleSimulation}>
              <Text style={s.previewButtonText}>
                {isPlayingSimulation ? '⏹ ZAUSTAVI PREGLED' : '▶ POKRENI EKRANSKI PREGLED'}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={s.previewNote}>Audi A8 D4 4.2 TDI · UDS Module 09 (0x710) + TesterPresent 3E 80</Text>
          )}
        </View>

        {/* Vehicle Test Arming & Execution Controls */}
        {mode === 'vehicle' && (
          <View style={s.vehicleControlPanel}>
            <View style={s.switchRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={s.switchLabel}>Potvrđujem da vozilo bezbedno miruje</Text>
                <Text style={s.switchHint}>Brzina mora biti 0 km/h, menjač u P/N sa uključenim kontaktom.</Text>
              </View>
              <Switch
                value={isSafetyUnlocked}
                onValueChange={setSafetyUnlocked}
                trackColor={{ false: '#3A1A20', true: '#DC2626' }}
                thumbColor={isSafetyUnlocked ? '#FEE2E2' : '#8E868A'}
              />
            </View>

            {vehicleProgress && (
              <View style={s.progressBox}>
                <ActivityIndicator color="#EF4444" />
                <View style={{ flex: 1 }}>
                  <Text style={s.progressText}>{vehicleProgress.step}</Text>
                  <Text style={s.progressPercent}>{vehicleProgress.percent}%</Text>
                </View>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity
                style={[
                  s.primaryButton,
                  { flex: 1 },
                  !canStartVehicleTest && s.disabledButton,
                ]}
                onPress={runVehicleTest}
                disabled={!canStartVehicleTest}
              >
                {isExecutingVehicle ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={s.primaryButtonText}>POKRENI TEST NA VOZILU</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={s.panicButton} onPress={handlePanicStop}>
                <Text style={s.panicButtonText}>🚨 PANIC STOP</Text>
              </TouchableOpacity>
            </View>

            {/* Live Command Console Output */}
            <Text style={s.consoleTitle}>KOMANDNI ODZIV VOZILA (TX / RX LOG):</Text>
            <ScrollView
              style={s.consoleBox}
              contentContainerStyle={s.consoleContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {commandLogs.length === 0 ? (
                <Text style={s.consoleEmpty}>Nema zabeleženih komandi. Pokreni test da vidiš UDS razmenu sa vozilom.</Text>
              ) : (
                commandLogs.map((log, idx) => (
                  <View key={idx} style={s.logRow}>
                    <Text
                      style={[
                        s.logDirection,
                        log.direction === 'TX'
                          ? { color: '#60A5FA' }
                          : log.direction === 'RX'
                          ? { color: '#34D399' }
                          : log.direction === 'ERROR'
                          ? { color: '#F87171' }
                          : { color: '#FBBF24' },
                      ]}
                    >
                      [{log.direction}]
                    </Text>
                    <Text style={s.logText}>{log.text}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        )}

        {/* Effect Library */}
        <Text style={s.section}>POLICE STROBE & LIGHT MODOVI ({AVAILABLE_EFFECTS.length})</Text>
        {AVAILABLE_EFFECTS.map(e => (
          <TouchableOpacity
            key={e.id}
            style={[s.effect, selectedEffect === e.id && s.selected]}
            onPress={() => setSelectedEffect(e.id)}
          >
            <Text style={s.number}>{e.index}</Text>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={s.effectName}>{e.name}</Text>
                {e.category === 'POLICE HEADLIGHT' && (
                  <View style={s.policeTag}>
                    <Text style={s.policeTagText}>STROBE</Text>
                  </View>
                )}
              </View>
              <Text style={s.effectSub}>{e.description}</Text>
            </View>
            <View style={[s.badgeBox, selectedEffect === e.id && { backgroundColor: '#DC2626' }]}>
              <Text style={[s.preview, selectedEffect === e.id && { color: '#fff' }]}>
                {selectedEffect === e.id ? 'IZABRANO' : 'IZABERI'}
              </Text>
            </View>
          </TouchableOpacity>
        ))}

        {/* Manual 2F DID Tester (Debug on vehicle) */}
        {mode === 'vehicle' && (
          <View style={s.didTesterCard}>
            <Text style={s.didTesterTitle}>🔧 MANUAL 2F DID TESTER (AUDI A8 D4 DEBUG)</Text>
            <Text style={s.didTesterSub}>
              Šalje: 10 03 → 2F &lt;DID&gt; 03 &lt;STATE&gt; → pauza 1.5s → 2F &lt;DID&gt; 00 → 10 01. Odmah proverava 6F (radi) vs 7F (NRC kod).
            </Text>
            <View style={s.didInputRow}>
              <View style={{ flex: 2 }}>
                <Text style={s.didFieldLabel}>4-CIFRENI HEX DID</Text>
                <TextInput
                  style={s.didInput}
                  value={manualDid}
                  onChangeText={t => setManualDid(t.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 4))}
                  placeholder="F123"
                  placeholderTextColor="#6E6266"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={4}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.didFieldLabel}>STATE (HEX)</Text>
                <TextInput
                  style={s.didInput}
                  value={manualState}
                  onChangeText={t => setManualState(t.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 4))}
                  placeholder="01"
                  placeholderTextColor="#6E6266"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={4}
                />
              </View>
            </View>
            <TouchableOpacity
              style={[
                s.didTestButton,
                (!isConnected || hasMovingLock || !isSafetyUnlocked || isTestingDid || isExecutingVehicle) && s.disabledButton,
              ]}
              onPress={handleTestManualDid}
              disabled={!isConnected || hasMovingLock || !isSafetyUnlocked || isTestingDid || isExecutingVehicle}
            >
              {isTestingDid ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.didTestButtonText}>
                  TESTIRAJ DID (2F {manualDid || '____'} 03 {manualState || ''})
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <Text style={s.disclaimer}>
          VAŽNO: Ne koristi svetlosne efekte na javnim putevima tokom kretanja vozila. Komande aktuatora su pripremljene za Audi A8 D4 Module 09 (Central Electrics BCM 0x710).
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#050507' },
  content: { padding: 24, paddingTop: 74, paddingBottom: 150 },
  brand: { color: '#EF4444', fontSize: 12, fontWeight: '900', letterSpacing: 5 },
  title: { color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 12 },
  sub: { color: '#8E868A', fontSize: 10, letterSpacing: 2.5, marginTop: 5, marginBottom: 20 },
  modeSelector: { flexDirection: 'row', backgroundColor: '#110D0F', borderRadius: 12, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: '#2E161A' },
  modeTab: { flex: 1, paddingVertical: 11, alignItems: 'center', borderRadius: 9 },
  activeModeTab: { backgroundColor: '#DC2626' },
  modeTabText: { color: '#94868A', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  activeModeTabText: { color: '#fff' },
  vehicle: { backgroundColor: '#110D0F', borderColor: '#3A151B', borderWidth: 1, borderRadius: 14, padding: 15, marginBottom: 14 },
  miniLabel: { color: '#EF4444', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  vehicleName: { color: '#fff', fontSize: 17, fontWeight: '800', marginTop: 6 },
  vehicleMeta: { color: '#94868A', fontSize: 10, marginTop: 3 },
  simNotice: { backgroundColor: '#140F11', borderColor: '#4A1820', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14 },
  simNoticeTitle: { color: '#F87171', fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  simNoticeText: { color: '#D4C8CA', fontSize: 10, lineHeight: 16 },
  warning: { backgroundColor: '#1C130D', borderColor: '#74481F', borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 },
  warningTitle: { color: '#F59E0B', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  warningText: { color: '#C7B9A3', fontSize: 10, lineHeight: 16, marginTop: 4 },
  rule: { height: 1, backgroundColor: '#442C1A', marginVertical: 11 },
  safetyHeadline: { color: '#F59E0B', fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  safetyItem: { color: '#E5D5BA', fontSize: 10, marginBottom: 3 },
  lockBanner: { backgroundColor: '#7F1D1D', padding: 10, borderRadius: 8, marginTop: 10 },
  lockBannerText: { color: '#FCA5A5', fontSize: 10, fontWeight: '900' },
  section: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 1.8, marginTop: 22, marginBottom: 12 },
  effect: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#110D0F', borderColor: '#2E161A', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  selected: { borderColor: '#DC2626', backgroundColor: '#1B0E11' },
  number: { color: '#EF4444', fontSize: 14, fontWeight: '900', width: 22 },
  effectName: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  effectSub: { color: '#8A7E82', fontSize: 10, marginTop: 4, lineHeight: 14 },
  policeTag: { backgroundColor: '#7F1D1D', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  policeTagText: { color: '#FECACA', fontSize: 7, fontWeight: '900', letterSpacing: 0.6 },
  badgeBox: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#261114' },
  preview: { color: '#FCA5A5', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  previewBox: { backgroundColor: '#0E0B0C', borderRadius: 16, borderWidth: 1, borderColor: '#3A151B', padding: 16, marginBottom: 14 },
  previewTitle: { color: '#EF4444', fontSize: 10, fontWeight: '900', letterSpacing: 1.4, textAlign: 'center' },
  carGraphicBox: { marginVertical: 14, padding: 18, backgroundColor: '#050507', borderRadius: 12, borderWidth: 1, borderColor: '#261316' },
  headlightRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  carLamp: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#221C1E' },
  carLampLarge: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#221C1E' },
  carGrille: { paddingHorizontal: 12 },
  previewButton: { backgroundColor: '#DC2626', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  previewButtonText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  previewNote: { color: '#8A7E82', fontSize: 9, textAlign: 'center', marginTop: 6 },
  vehicleControlPanel: { marginTop: 4, backgroundColor: '#110D0F', borderColor: '#4A1820', borderWidth: 1, borderRadius: 16, padding: 16 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  switchLabel: { color: '#fff', fontSize: 11, fontWeight: '800' },
  switchHint: { color: '#94868A', fontSize: 9, marginTop: 3 },
  progressBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1C0F12', padding: 12, borderRadius: 10, marginVertical: 10 },
  progressText: { color: '#FECACA', fontSize: 10, fontWeight: '700' },
  progressPercent: { color: '#EF4444', fontSize: 9, marginTop: 2 },
  primaryButton: { backgroundColor: '#DC2626', padding: 16, borderRadius: 12, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  disabledButton: { backgroundColor: '#2A1B1E', opacity: 0.6 },
  panicButton: { backgroundColor: '#991B1B', borderWidth: 1, borderColor: '#EF4444', paddingHorizontal: 14, paddingVertical: 16, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  panicButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  consoleTitle: { color: '#EF4444', fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  consoleBox: { backgroundColor: '#050507', borderRadius: 10, borderWidth: 1, borderColor: '#2E161A', maxHeight: 180, overflow: 'hidden' },
  consoleContent: { padding: 10 },
  consoleEmpty: { color: '#6E6266', fontSize: 9, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  logRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  logDirection: { fontSize: 9, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  logText: { color: '#E2E8F0', fontSize: 9, flex: 1, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  didTesterCard: { marginTop: 18, backgroundColor: '#110D0F', borderColor: '#74481F', borderWidth: 1, borderRadius: 16, padding: 16 },
  didTesterTitle: { color: '#F59E0B', fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  didTesterSub: { color: '#C7B9A3', fontSize: 10, lineHeight: 15, marginBottom: 12 },
  didInputRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  didFieldLabel: { color: '#94868A', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginBottom: 5 },
  didInput: {
    backgroundColor: '#050507',
    borderWidth: 1,
    borderColor: '#4A1820',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  didTestButton: { backgroundColor: '#B45309', padding: 14, borderRadius: 10, alignItems: 'center' },
  didTestButtonText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  disclaimer: { color: '#786D70', fontSize: 10, lineHeight: 17, textAlign: 'center', marginTop: 20 },
});
