import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { useAppStore } from '@/store/app-store';
import { AdapterInfo, LiveData, ObdBleClient } from '@/services/obd-ble';
import { VehicleCapabilities } from '@/services/vehicle-capabilities';

export default function SettingsScreen() {
  const {
    adapterName,
    vehicles,
    setLastObdData,
    capabilities,
    setCapabilities,
    setConnectionStatus,
    setAdapterName,
  } = useAppStore();

  const client = useRef<ObdBleClient | null>(null);
  const [devices, setDevices] = useState<AdapterInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Nije povezano');
  const [protocol, setProtocol] = useState('');
  const [adapterModel, setAdapterModel] = useState('');
  const [live, setLive] = useState<LiveData | null>(null);
  const [reading, setReading] = useState(false);
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [scanningCaps, setScanningCaps] = useState(false);

  useEffect(() => {
    return () => {
      client.current?.destroy().catch(() => {});
    };
  }, []);

  const getClient = () => {
    if (!client.current) client.current = new ObdBleClient();
    return client.current;
  };

  const requestBluetoothPermissions = async () => {
    if (Platform.OS !== 'android') return true;
    try {
      if (Number(Platform.Version) >= 31) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
          result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const status = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return status === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch {
      return false;
    }
  };

  const scan = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Bluetooth', 'Za BLE vezu potrebna je instalirana iOS/Android aplikacija, ne web verzija.');
      return;
    }
    const permissionGranted = await requestBluetoothPermissions();
    if (!permissionGranted) {
      Alert.alert(
        'Bluetooth dozvola',
        'Dozvoli Bluetooth i Location pristup u podešavanjima telefona da bi aplikacija mogla da pronađe VLinker BM+ adapter.'
      );
      setStatus('Nedostaje Bluetooth dozvola');
      return;
    }

    setDevices([]);
    setScanning(true);
    setStatus('Tražim VLinker BM+ / ELM327 BLE adaptere...');
    try {
      await getClient().scan(d => {
        setDevices(old => (old.some(x => x.id === d.id) ? old : [...old, d]));
      }, 12);
      setStatus('Pretraga završena');
    } catch (e: any) {
      setStatus('Greška pri skeniranju');
      Alert.alert('Bluetooth greška', e?.message || 'Skeniranje nije uspelo.');
    } finally {
      setScanning(false);
    }
  };

  const connect = async (d: AdapterInfo) => {
    setConnecting(true);
    setConnectionStatus('connecting');
    setStatus(`Povezujem ${d.name}...`);
    try {
      const info = await getClient().connect(d.id, () => {
        setConnected(false);
        setConnectionStatus('disconnected');
        setLive(null);
        setIsLiveStreaming(false);
        setStatus('Adapter je prekinuo vezu');
      });

      setConnected(true);
      setConnectionStatus('connected');
      setProtocol(info.protocol);
      setAdapterModel(info.adapterModel);
      setAdapterName(d.name || info.name);
      setStatus(`Povezano: ${info.name}`);

      // Auto-scan vehicle capabilities upon connection
      scanVehicleCapabilities();
    } catch (e: any) {
      setConnected(false);
      setConnectionStatus('disconnected');
      setStatus('Veza nije uspostavljena');
      Alert.alert('OBD povezivanje nije uspelo', e?.message || 'Nepoznata greška');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    stopLiveStream();
    await client.current?.disconnect();
    setConnected(false);
    setConnectionStatus('disconnected');
    setLive(null);
    setStatus('Veza prekinuta');
  };

  const scanVehicleCapabilities = async () => {
    if (!client.current || !connected) return;
    setScanningCaps(true);
    try {
      const caps = await client.current.scanCapabilities();
      setCapabilities(caps);
    } catch (e: any) {
      console.warn('Scan capabilities notice:', e?.message);
    } finally {
      setScanningCaps(false);
    }
  };

  const refresh = async () => {
    if (!client.current || !connected) return;
    setReading(true);
    try {
      const snapshot = await client.current.readLiveData();
      setLive(snapshot);
      setLastObdData(snapshot);
    } catch (e: any) {
      Alert.alert('OBD očitavanje', e?.message || 'Očitavanje nije uspelo.');
    } finally {
      setReading(false);
    }
  };

  const toggleLiveStream = () => {
    if (isLiveStreaming) {
      stopLiveStream();
    } else {
      startLiveStream();
    }
  };

  const startLiveStream = () => {
    if (!client.current || !connected) return;
    setIsLiveStreaming(true);
    client.current.startPolling(data => {
      setLive(data);
      setLastObdData(data);
    }, 700);
  };

  const stopLiveStream = () => {
    setIsLiveStreaming(false);
    client.current?.stopPolling();
  };

  const confirmClearDtcs = () => {
    Alert.alert(
      'Brisanje grešaka motornog računara (DTC Clear)?',
      'Ova komanda šalje OBD-II Mode 04 komandu motornom ECU-u. Preporučuje se samo dok je kontakt uključen, a motor UGAŠEN.\n\nŽeliš li da nastaviš?',
      [
        { text: 'Otkaži', style: 'cancel' },
        {
          text: 'Obriši greške (Mode 04)',
          style: 'destructive',
          onPress: async () => {
            try {
              const ok = await getClient().clearDtcCodes();
              if (ok) {
                Alert.alert('Uspešno', 'Komanda za brisanje grešaka je poslata motornom računaru.');
                refresh();
              } else {
                Alert.alert('Upozorenje', 'ECU nije potvrdio brisanje grešaka.');
              }
            } catch (err: any) {
              Alert.alert('Greška', err?.message || 'Brisanje grešaka nije uspelo.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.brand}>BANDOLERO</Text>
        <Text style={s.title}>DIAGNOSTICS</Text>
        <Text style={s.sub}>LIVE OBD-II & ELM327/STN TRANSPORTER</Text>

        <Text style={s.section}>ADAPTER CONNECTION (VLINKER BM+)</Text>
        <View style={s.card}>
          <View style={{ flex: 1 }}>
            <Text style={s.item}>{adapterName}</Text>
            <Text style={s.hint}>{status}</Text>
          </View>
          <View style={[s.dot, { backgroundColor: connected ? '#34D399' : '#6B6474' }]} />
        </View>

        {!connected ? (
          <TouchableOpacity style={s.primary} onPress={scan} disabled={scanning || connecting}>
            {scanning ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>SCAN FOR VLINKER BM+ / OBD BLE</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.secondary} onPress={disconnect}>
            <Text style={s.secondaryText}>DISCONNECT ADAPTER</Text>
          </TouchableOpacity>
        )}

        {connecting && (
          <View style={s.inline}>
            <ActivityIndicator color="#B56AF0" />
            <Text style={s.hint}>Inicijalizacija ELM327/STN protokola i provera ECU odziva...</Text>
          </View>
        )}

        {!scanning && devices.length === 0 && status === 'Pretraga završena' && (
          <Text style={s.hint}>
            Nije pronađen Bluetooth adapter. Proveri da je VLinker BM+ utaknut u OBD priključak, da svetli LED dioda na adapteru i da je kontakt uključen.
          </Text>
        )}

        {devices.map(d => (
          <TouchableOpacity key={d.id} style={s.device} onPress={() => connect(d)} disabled={connecting}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={s.item}>{d.name}</Text>
                {d.isKnownObd && <View style={s.knownBadge}><Text style={s.knownBadgeText}>OBD</Text></View>}
              </View>
              <Text style={s.hint}>BLE · {d.id.slice(0, 18)}…</Text>
            </View>
            <Text style={s.value}>{d.rssi ?? '—'} dBm　›</Text>
          </TouchableOpacity>
        ))}

        {connected && (
          <>
            <View style={s.card}>
              <Text style={s.item}>OBD Protocol</Text>
              <Text style={s.value}>{protocol || 'ISO 15765-4 (CAN)'}</Text>
            </View>
            {adapterModel ? (
              <View style={s.card}>
                <Text style={s.item}>Adapter Hardware/Chip</Text>
                <Text style={s.value}>{adapterModel}</Text>
              </View>
            ) : null}

            {/* Supported Vehicle Capabilities Panel */}
            <Text style={s.section}>PODRŽANE FUNKCIJE VOZILA (CAPABILITIES)</Text>
            <View style={s.card}>
              <View style={{ flex: 1 }}>
                <Text style={s.item}>Detektovani senzori i servisi</Text>
                <Text style={s.hint}>
                  {capabilities
                    ? `${capabilities.supportedPids.length} podržanih OBD-II parametara`
                    : 'Klikni za skeniranje bitmaska'}
                </Text>
              </View>
              <TouchableOpacity
                style={s.miniButton}
                onPress={scanVehicleCapabilities}
                disabled={scanningCaps}
              >
                {scanningCaps ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.miniButtonText}>RE-SCAN</Text>
                )}
              </TouchableOpacity>
            </View>

            {capabilities?.vin && (
              <View style={s.card}>
                <Text style={s.item}>Očitani VIN broj</Text>
                <Text style={[s.value, { color: '#34D399', fontWeight: '900' }]}>{capabilities.vin}</Text>
              </View>
            )}

            {capabilities && (
              <View style={s.chipContainer}>
                {capabilities.features.slice(0, 10).map(f => (
                  <View key={f.pid} style={s.capChip}>
                    <Text style={s.capChipText}>✓ {f.name}</Text>
                  </View>
                ))}
                {capabilities.features.length > 10 && (
                  <View style={s.capChip}>
                    <Text style={s.capChipText}>+ još {capabilities.features.length - 10} parametara</Text>
                  </View>
                )}
              </View>
            )}

            {/* Live Diagnostics Dashboard */}
            <Text style={s.section}>LIVE VEHICLE DATA & SENSORS</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
              <TouchableOpacity
                style={[s.primary, { flex: 1 }]}
                onPress={refresh}
                disabled={reading || isLiveStreaming}
              >
                {reading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>OČITAJ SADA</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.secondary, { flex: 1, backgroundColor: isLiveStreaming ? '#059669' : '#292132' }]}
                onPress={toggleLiveStream}
              >
                <Text style={[s.secondaryText, isLiveStreaming && { color: '#fff' }]}>
                  {isLiveStreaming ? '⏹ ZAUSTAVI STREAM' : '▶ LIVE STREAM'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={s.metrics}>
              {metric('Engine RPM', live?.rpm, 'rpm')}
              {metric('Vehicle Speed', live?.speed, 'km/h')}
              {metric('Coolant Temp', live?.coolant, '°C')}
              {metric('Oil Temp (VAG)', live?.oilTemp, '°C')}
              {metric('Intake Temp', live?.intake, '°C')}
              {metric('Throttle', live?.throttle, '%')}
              {metric('Engine Load', live?.engineLoad, '%')}
              {metric('MAF Airflow', live?.maf, 'g/s')}
              {metric('Fuel Level', live?.fuelLevel, '%')}
              {metric('Fuel Rail Press.', live?.fuelRailPressure, 'kPa')}
              {metric('Battery / Pin 16', live?.voltage, 'V')}
            </View>

            {/* Diagnostic Trouble Codes (DTCs) */}
            <Text style={s.section}>DIAGNOSTIC TROUBLE CODES (DTC)</Text>
            <View style={s.card}>
              <View style={{ flex: 1 }}>
                <Text style={s.item}>Engine Warning Lamp (MIL)</Text>
                <Text style={s.hint}>Standard OBD-II Mode 01</Text>
              </View>
              <Text style={[s.value, { color: live?.mil ? '#EF4444' : '#34D399', fontWeight: '900' }]}>
                {live?.mil === undefined ? '—' : live.mil ? 'AKTIVNA (MIL ON)' : 'UGASENA (MIL OFF)'}
              </Text>
            </View>

            <View style={s.card}>
              <View style={{ flex: 1 }}>
                <Text style={s.item}>Stored Fault Codes (Mode 03)</Text>
                <Text style={s.hint}>Sačuvani kodovi grešaka u ECU</Text>
              </View>
              <Text style={s.value}>{live ? live.dtcs.length : '—'}</Text>
            </View>

            {live?.dtcs.map(code => (
              <View key={code} style={s.code}>
                <Text style={s.codeText}>🚨 {code}</Text>
              </View>
            ))}

            {live && live.dtcs.length === 0 && (
              <Text style={s.hint}>Nisu pronađeni sačuvani DTC kodovi grešaka u motornom ECU.</Text>
            )}

            {live && live.dtcs.length > 0 && (
              <TouchableOpacity style={s.dangerButton} onPress={confirmClearDtcs}>
                <Text style={s.dangerButtonText}>OBRIŠI GREŠKE (MODE 04 DTC CLEAR)</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        <Text style={s.section}>GARAGE</Text>
        <View style={s.card}>
          <Text style={s.item}>Saved vehicles</Text>
          <Text style={s.value}>{vehicles.length}</Text>
        </View>

        <Text style={s.section}>ABOUT & PHYSICAL TESTING NOTE</Text>
        <View style={s.card}>
          <Text style={s.item}>BANDOLERO LIGHT SHOW</Text>
          <Text style={s.value}>1.2.0</Text>
        </View>
        <Text style={s.note}>
          Ova aplikacija koristi direktan BLE transport via react-native-ble-plx. Za Audi A8 D4 4.2 TDI testirano je generisanje komandi za Module 09 (Central Electrics BCM) preko CAN busa.
        </Text>
      </ScrollView>
    </View>
  );
}

function metric(label: string, value: number | undefined, unit: string) {
  return (
    <View key={label} style={s.metric}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={s.metricValue}>
        {value === undefined ? '—' : Number(value.toFixed(1))}
        <Text style={s.unit}> {unit}</Text>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#080810' },
  content: { padding: 24, paddingTop: 62, paddingBottom: 40 },
  brand: { color: '#A855F7', fontSize: 12, fontWeight: '900', letterSpacing: 5 },
  title: { color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 34 },
  sub: { color: '#888397', fontSize: 10, letterSpacing: 3, marginTop: 5, marginBottom: 28 },
  section: { color: '#A855F7', fontSize: 10, fontWeight: '900', letterSpacing: 2, marginTop: 23, marginBottom: 10 },
  card: { backgroundColor: '#15121F', borderColor: '#30263B', borderWidth: 1, borderRadius: 13, padding: 16, marginBottom: 9, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  item: { color: '#fff', fontSize: 12, fontWeight: '700' },
  hint: { color: '#777184', fontSize: 9, marginTop: 5 },
  value: { color: '#BFA0D9', fontSize: 10 },
  dot: { width: 9, height: 9, borderRadius: 5, marginLeft: 12 },
  primary: { backgroundColor: '#8737C7', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 5 },
  primaryText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  secondary: { backgroundColor: '#292132', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 5 },
  secondaryText: { color: '#D7B8EF', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  device: { backgroundColor: '#1D1726', borderColor: '#6D3A91', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 9, flexDirection: 'row', alignItems: 'center' },
  knownBadge: { backgroundColor: '#8B35D1', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  knownBadgeText: { color: '#fff', fontSize: 8, fontWeight: '900' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginVertical: 10 },
  metric: { width: '48%', backgroundColor: '#15121F', borderWidth: 1, borderColor: '#30263B', borderRadius: 12, padding: 14 },
  metricLabel: { color: '#81778E', fontSize: 9 },
  metricValue: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 7 },
  unit: { color: '#A855F7', fontSize: 10 },
  miniButton: { backgroundColor: '#8B35D1', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  miniButtonText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 },
  capChip: { backgroundColor: '#1C1528', borderColor: '#4C2C6E', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  capChipText: { color: '#D8B4FE', fontSize: 9, fontWeight: '700' },
  code: { backgroundColor: '#261A30', borderRadius: 8, padding: 11, marginBottom: 7, borderColor: '#7E22CE', borderWidth: 1 },
  codeText: { color: '#E7C9FF', fontWeight: '800', fontSize: 12 },
  dangerButton: { backgroundColor: '#7F1D1D', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  dangerButtonText: { color: '#FCA5A5', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  note: { color: '#82798C', fontSize: 10, lineHeight: 17, marginTop: 4 },
});
