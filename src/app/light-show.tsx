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
} from 'react-native';
import { useAppStore } from '@/store/app-store';
import {
  AVAILABLE_EFFECTS,
  CommandLogEntry,
  LightEffectId,
  LightShowController,
} from '@/services/light-show-controller';
import { SafetyInterlock } from '@/services/safety-interlock';
import { ObdBleClient } from '@/services/obd-ble';

export default function LightShowScreen() {
  const {
    vehicles,
    activeVehicleId,
    lastObdData,
    connectionStatus,
    isSafetyUnlocked,
    setSafetyUnlocked,
  } = useAppStore();

  const [mode, setMode] = useState<'simulation' | 'vehicle'>('simulation');
  const [selectedEffect, setSelectedEffect] = useState<LightEffectId>('welcome');
  const [isPlayingSimulation, setIsPlayingSimulation] = useState(false);
  const [animStep, setAnimStep] = useState(0);

  const [isExecutingVehicle, setIsExecutingVehicle] = useState(false);
  const [vehicleProgress, setVehicleProgress] = useState<{ step: string; percent: number } | null>(null);
  const [commandLogs, setCommandLogs] = useState<CommandLogEntry[]>([]);

  const clientRef = useRef<ObdBleClient | null>(null);
  const controllerRef = useRef<LightShowController | null>(null);

  const active = vehicles.find(v => v.id === activeVehicleId);
  const isConnected = connectionStatus === 'connected';

  // Evaluate safety status
  const safety = SafetyInterlock.evaluate(
    lastObdData,
    isConnected,
    mode === 'simulation'
  );

  useEffect(() => {
    if (!controllerRef.current) {
      controllerRef.current = new LightShowController(null, entry => {
        setCommandLogs(prev => [entry, ...prev.slice(0, 49)]);
      });
    }
  }, []);

  // Update client reference when connection status changes
  useEffect(() => {
    if (isConnected) {
      if (!clientRef.current) {
        clientRef.current = new ObdBleClient();
      }
      controllerRef.current?.setClient(clientRef.current);
    }
  }, [isConnected]);

  // Simulation Animation Loop
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isPlayingSimulation) {
      timer = setInterval(() => {
        setAnimStep(prev => (prev + 1) % 6);
      }, 450);
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

    if (!isConnected) {
      Alert.alert(
        'Adapter nije povezan',
        'Za slanje komandi vozilu potrebno je prvo povezati VLinker BM+ adapter u podešavanjima (Settings).'
      );
      return;
    }

    if (!safety.isSafe) {
      Alert.alert(
        'Bezbednosna blokada',
        safety.criticalLockReason || 'Vozilo mora biti u potpunom mirovanju sa brzinom 0 km/h.'
      );
      return;
    }

    if (!isSafetyUnlocked) {
      Alert.alert(
        'Potvrda bezbednosti',
        'Molimo uključi prekidač "Potvrđujem da vozilo bezbedno miruje" pre pokretanja komandi.'
      );
      return;
    }

    Alert.alert(
      'Pokretanje testa na vozilu (Audi A8 D4 Module 09)',
      `Ova funkcija šalje stvarne UDS komande aktuatorima svetala (Central Electrics 0x710).\n\nEfekat: ${selectedEffect.toUpperCase()}\n\nDa li je kontakt uključen i vozilo u stanju mirovanja?`,
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
                controllerRef.current = new LightShowController(clientRef.current, entry => {
                  setCommandLogs(prev => [entry, ...prev.slice(0, 49)]);
                });
              }
              const res = await controllerRef.current.runVehicleSequence(selectedEffect, (step, percent) => {
                setVehicleProgress({ step, percent });
              });
              Alert.alert('Završeno', res.message);
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
      await controllerRef.current?.emergencyStop();
      setIsExecutingVehicle(false);
      setVehicleProgress(null);
      Alert.alert('Zaustavljeno', 'Prinuđeno zaustavljanje izvršeno. Kontrola je vraćena računaru vozila.');
    } catch (err: any) {
      Alert.alert('Greška', err?.message || 'Greška pri prinudnom zaustavljanju.');
    }
  };

  const currentEffect = AVAILABLE_EFFECTS.find(e => e.id === selectedEffect);

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.brand}>BANDOLERO</Text>
        <Text style={s.title}>LIGHT SHOW</Text>
        <Text style={s.sub}>SIGNATURE ILLUMINATION CONTROL</Text>

        {/* Mode Selector Tabs */}
        <View style={s.modeSelector}>
          <TouchableOpacity
            style={[s.modeTab, mode === 'simulation' && s.activeModeTab]}
            onPress={() => setMode('simulation')}
          >
            <Text style={[s.modeTabText, mode === 'simulation' && s.activeModeTabText]}>
              📱 SIMULACIJA (Pretpregled)
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

        {/* Mode Specific Warnings */}
        {mode === 'simulation' ? (
          <View style={s.simNotice}>
            <Text style={s.simNoticeTitle}>ℹ️ REŽIM EKRANSKE SIMULACIJE</Text>
            <Text style={s.simNoticeText}>
              Pretpregled vizuelnih svetlosnih sekvenci direktno na ekranu telefona. U ovom režimu komande se NE šalju vozilu.
            </Text>
          </View>
        ) : (
          <View style={[s.warning, !safety.isSafe && { borderColor: '#DC2626' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Text style={{ fontSize: 14 }}>⚠️</Text>
              <Text style={s.warningTitle}>ZAHTEVA FIZIČKO TESTIRANJE NA VOZILU</Text>
            </View>
            <Text style={s.warningText}>
              Svetlosni šou šalje stvarne komande preko VLinker BM+ adaptera na Module 09 (Central Electrics BCM) vozila Audi A8 D4 4.2 TDI.
            </Text>
            <View style={s.rule} />
            <Text style={s.safetyHeadline}>BEZBEDNOSNI STATUS:</Text>
            {safety.reasons.map((r, i) => (
              <Text key={i} style={s.safetyItem}>• {r}</Text>
            ))}
            {safety.criticalLockReason && (
              <View style={s.lockBanner}>
                <Text style={s.lockBannerText}>🔒 {safety.criticalLockReason}</Text>
              </View>
            )}
          </View>
        )}

        {/* Effect Library */}
        <Text style={s.section}>EFFECT LIBRARY</Text>
        {AVAILABLE_EFFECTS.map(e => (
          <TouchableOpacity
            key={e.id}
            style={[s.effect, selectedEffect === e.id && s.selected]}
            onPress={() => setSelectedEffect(e.id)}
          >
            <Text style={s.number}>{e.index}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.effectName}>{e.name}</Text>
              <Text style={s.effectSub}>{e.description}</Text>
            </View>
            <View style={s.badgeBox}>
              <Text style={s.preview}>{selectedEffect === e.id ? 'IZABRANO' : 'IZABERI'}</Text>
            </View>
          </TouchableOpacity>
        ))}

        {/* Visual Light Box Simulation */}
        <View style={s.previewBox}>
          <Text style={s.previewTitle}>
            {isPlayingSimulation ? '▶ PREVIEW SIMULATION AKTIVNA' : 'VISUAL PREVIEW'}
          </Text>

          {/* Interactive Light Representation */}
          <View style={s.carGraphicBox}>
            <View style={s.headlightRow}>
              {/* Left Fog / Blinker */}
              <View
                style={[
                  s.carLamp,
                  (animStep === 1 || animStep === 3 || animStep === 5) && {
                    backgroundColor: '#F59E0B',
                    shadowColor: '#F59E0B',
                  },
                ]}
              />
              {/* Left Main Headlight */}
              <View
                style={[
                  s.carLampLarge,
                  (animStep % 2 === 1 || animStep === 4) && {
                    backgroundColor: '#C084FC',
                    shadowColor: '#C084FC',
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
                  (animStep % 2 === 0 || animStep === 4) && {
                    backgroundColor: '#C084FC',
                    shadowColor: '#C084FC',
                  },
                ]}
              />
              {/* Right Fog / Blinker */}
              <View
                style={[
                  s.carLamp,
                  (animStep === 2 || animStep === 3 || animStep === 5) && {
                    backgroundColor: '#F59E0B',
                    shadowColor: '#F59E0B',
                  },
                ]}
              />
            </View>
          </View>

          <View style={s.lights}>
            {currentEffect?.colors.map((c, i) => (
              <View
                key={i}
                style={[
                  s.light,
                  { backgroundColor: c },
                  isPlayingSimulation && { opacity: (animStep + i) % 2 === 0 ? 1 : 0.3 },
                ]}
              />
            ))}
          </View>

          {mode === 'simulation' ? (
            <TouchableOpacity style={s.previewButton} onPress={toggleSimulation}>
              <Text style={s.previewButtonText}>
                {isPlayingSimulation ? '⏹ ZAUSTAVI PREGLED' : '▶ POKRENI EKRANSKI PREGLED'}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={s.previewNote}>Audi A8 D4 4.2 TDI · UDS Module 09 Actuator Test</Text>
          )}
        </View>

        {/* Vehicle Test Arming & Execution Controls */}
        {mode === 'vehicle' && (
          <View style={s.vehicleControlPanel}>
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.switchLabel}>Potvrđujem da vozilo bezbedno miruje</Text>
                <Text style={s.switchHint}>Brzina mora biti 0 km/h, menjač u P/N sa uključenim kontaktom.</Text>
              </View>
              <Switch
                value={isSafetyUnlocked}
                onValueChange={setSafetyUnlocked}
                trackColor={{ false: '#3A284C', true: '#8B35D1' }}
                thumbColor={isSafetyUnlocked ? '#E9D5FF' : '#777184'}
              />
            </View>

            {vehicleProgress && (
              <View style={s.progressBox}>
                <ActivityIndicator color="#C084FC" />
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
                  (!safety.canArmLightShow || !isSafetyUnlocked || isExecutingVehicle) && s.disabledButton,
                ]}
                onPress={runVehicleTest}
                disabled={!safety.canArmLightShow || !isSafetyUnlocked || isExecutingVehicle}
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
            <View style={s.consoleBox}>
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
            </View>
          </View>
        )}

        <Text style={s.disclaimer}>
          VAŽNO: Ne koristi svetlosne efekte na javnim putevima tokom kretanja vozila. Komande aktuatora su testirane za Audi A8 D4 Module 09 (Central Electrics BCM).
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#080810' },
  content: { padding: 24, paddingTop: 62, paddingBottom: 35 },
  brand: { color: '#A855F7', fontSize: 12, fontWeight: '900', letterSpacing: 5 },
  title: { color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 34 },
  sub: { color: '#888397', fontSize: 10, letterSpacing: 3, marginTop: 5, marginBottom: 20 },
  modeSelector: { flexDirection: 'row', backgroundColor: '#130F1C', borderRadius: 12, padding: 4, marginBottom: 18, borderWidth: 1, borderColor: '#2E223D' },
  modeTab: { flex: 1, paddingVertical: 11, alignItems: 'center', borderRadius: 9 },
  activeModeTab: { backgroundColor: '#8B35D1' },
  modeTabText: { color: '#8E849C', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  activeModeTabText: { color: '#fff' },
  vehicle: { backgroundColor: '#15121F', borderColor: '#39234D', borderWidth: 1, borderRadius: 14, padding: 15, marginBottom: 16 },
  miniLabel: { color: '#A855F7', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  vehicleName: { color: '#fff', fontSize: 17, fontWeight: '800', marginTop: 7 },
  vehicleMeta: { color: '#8F879A', fontSize: 10, marginTop: 3 },
  simNotice: { backgroundColor: '#141A28', borderColor: '#1E3A8A', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16 },
  simNoticeTitle: { color: '#60A5FA', fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  simNoticeText: { color: '#BFDBFE', fontSize: 10, lineHeight: 16 },
  warning: { backgroundColor: '#241B12', borderColor: '#74501F', borderWidth: 1, borderRadius: 16, padding: 17, marginBottom: 18 },
  warningTitle: { color: '#F3B64D', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  warningText: { color: '#C7B9A3', fontSize: 11, lineHeight: 18, marginTop: 4 },
  rule: { height: 1, backgroundColor: '#44321A', marginVertical: 12 },
  safetyHeadline: { color: '#F59E0B', fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 6 },
  safetyItem: { color: '#E5D5BA', fontSize: 10, marginBottom: 3 },
  lockBanner: { backgroundColor: '#7F1D1D', padding: 10, borderRadius: 8, marginTop: 10 },
  lockBannerText: { color: '#FCA5A5', fontSize: 10, fontWeight: '900' },
  section: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 2, marginBottom: 13 },
  effect: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#15121F', borderColor: '#30263B', borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 10 },
  selected: { borderColor: '#A855F7', backgroundColor: '#1D1628' },
  number: { color: '#A855F7', fontSize: 15, fontWeight: '900' },
  effectName: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  effectSub: { color: '#777184', fontSize: 10, marginTop: 5 },
  badgeBox: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#2A1C3B' },
  preview: { color: '#BFA0D9', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  previewBox: { backgroundColor: '#110E18', borderRadius: 16, borderWidth: 1, borderColor: '#30263B', padding: 17, marginTop: 14 },
  previewTitle: { color: '#A855F7', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, textAlign: 'center' },
  carGraphicBox: { marginVertical: 14, padding: 16, backgroundColor: '#0A0812', borderRadius: 12, borderWidth: 1, borderColor: '#231A2F' },
  headlightRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  carLamp: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#2B2338', shadowOpacity: 0.8, shadowRadius: 10 },
  carLampLarge: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#2B2338', shadowOpacity: 0.9, shadowRadius: 14 },
  carGrille: { paddingHorizontal: 12 },
  lights: { flexDirection: 'row', justifyContent: 'center', gap: 18, paddingVertical: 14 },
  light: { width: 28, height: 28, borderRadius: 14, shadowColor: '#A855F7', shadowOpacity: 0.7, shadowRadius: 12 },
  previewButton: { backgroundColor: '#8B35D1', padding: 13, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  previewButtonText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  previewNote: { color: '#777184', fontSize: 9, textAlign: 'center', marginTop: 8 },
  vehicleControlPanel: { marginTop: 18, backgroundColor: '#151121', borderColor: '#42245C', borderWidth: 1, borderRadius: 16, padding: 18 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  switchLabel: { color: '#fff', fontSize: 11, fontWeight: '800' },
  switchHint: { color: '#888094', fontSize: 9, marginTop: 3 },
  progressBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1E162B', padding: 12, borderRadius: 10, marginVertical: 10 },
  progressText: { color: '#E9D5FF', fontSize: 10, fontWeight: '700' },
  progressPercent: { color: '#C084FC', fontSize: 9, marginTop: 2 },
  primaryButton: { backgroundColor: '#8B35D1', padding: 16, borderRadius: 12, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  disabledButton: { backgroundColor: '#2C2237', opacity: 0.6 },
  panicButton: { backgroundColor: '#DC2626', paddingHorizontal: 14, paddingVertical: 16, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  panicButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  consoleTitle: { color: '#A855F7', fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  consoleBox: { backgroundColor: '#090710', borderRadius: 10, borderWidth: 1, borderColor: '#2E223D', padding: 10, maxHeight: 160 },
  consoleEmpty: { color: '#564E61', fontSize: 9, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  logRow: { flexDirection: 'row', gap: 6, marginBottom: 3 },
  logDirection: { fontSize: 9, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  logText: { color: '#E2E8F0', fontSize: 9, flex: 1, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  disclaimer: { color: '#756D7E', fontSize: 10, lineHeight: 17, textAlign: 'center', marginTop: 20 },
});
