import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore } from '@/store/app-store';

const RED = '#EF4444';

export default function HomeScreen() {
  const router = useRouter();
  const { vehicles, activeVehicleId, connectionStatus, adapterName, lastObdData } = useAppStore();
  const active = vehicles.find(v => v.id === activeVehicleId);

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';

  const dotColor = isConnected ? '#34D399' : isConnecting ? '#EF4444' : '#F59E0B';
  const pillStatusText = isConnected
    ? `ONLINE (${adapterName || 'VLINKER'})`
    : isConnecting
    ? 'CONNECTING...'
    : 'ADAPTER OFFLINE';

  const statusRowText = isConnected
    ? `POVEZANO: ${adapterName} · ${lastObdData?.speed !== undefined ? `${lastObdData.speed} km/h` : 'SPREMNO'}`
    : isConnecting
    ? 'USPOSTAVLJANJE BLUETOOTH VEZE...'
    : 'BLUETOOTH ADAPTER NIJE POVEZAN';

  return (
    <View style={s.page}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View>
            <Text style={s.brand}>BANDOLERO</Text>
            <Text style={s.subbrand}>LIGHT SHOW</Text>
          </View>
          <View style={s.pill}>
            <View style={[s.dot, { backgroundColor: dotColor }]} />
            <Text style={s.pillText}>{pillStatusText}</Text>
          </View>
        </View>

        <Text style={s.eyebrow}>WELCOME TO YOUR CONTROL CENTER</Text>
        <Text style={s.hero}>YOUR VEHICLE.</Text>
        <Text style={[s.hero, { color: RED }]}>YOUR LIGHT SHOW.</Text>

        <View style={s.vehicle}>
          <View style={s.vehicleTop}>
            <Text style={s.label}>ACTIVE VEHICLE</Text>
            <Text style={s.tag}>MY GARAGE</Text>
          </View>
          {active ? (
            <>
              <Text style={s.carName}>{active.nickname || `${active.make} ${active.model}`}</Text>
              <Text style={s.carMeta}>{[active.year, active.engine].filter(Boolean).join('  •  ')}</Text>
            </>
          ) : (
            <>
              <Text style={s.carName}>No vehicle selected</Text>
              <Text style={s.carMeta}>Add a vehicle in My Garage</Text>
            </>
          )}
          <View style={s.carArt}>
            <Text style={{ fontSize: 72 }}>🚘</Text>
          </View>
          <View style={s.rule} />
          <View style={s.statusRow}>
            <View style={[s.dot, { backgroundColor: dotColor }]} />
            <Text style={s.statusText}>{statusRowText}</Text>
          </View>
          <TouchableOpacity style={s.primary} onPress={() => router.push('/garage')}>
            <Text style={s.primaryText}>OPEN GARAGE  →</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.section}>QUICK ACCESS</Text>
        <View style={s.grid}>
          <TouchableOpacity style={s.tile} onPress={() => router.push('/light-show' as any)}>
            <Text style={s.tileIcon}>⚡</Text>
            <Text style={s.tileTitle}>Light Show</Text>
            <Text style={s.tileDesc}>Police Strobe & UDS Modovi</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.tile} onPress={() => router.push('/garage')}>
            <Text style={s.tileIcon}>🚘</Text>
            <Text style={s.tileTitle}>My Garage</Text>
            <Text style={s.tileDesc}>Sačuvana vozila ({vehicles.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tile, { width: '100%' }]} onPress={() => router.push('/settings' as any)}>
            <Text style={s.tileIcon}>⚙</Text>
            <Text style={s.tileTitle}>OBD Diagnostics & VLinker BM+</Text>
            <Text style={s.tileDesc}>Bluetooth povezivanje, senzori uživo i DTC greške</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.footer}>BANDOLERO LIGHT SHOW  •  VERSION 1.2.0</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#050507' },
  content: { padding: 22, paddingTop: 74, paddingBottom: 145 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
  brand: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 4 },
  subbrand: { color: RED, fontSize: 10, letterSpacing: 6, marginTop: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#161012', borderWidth: 1, borderColor: '#3A151B', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20 },
  dot: { width: 7, height: 7, borderRadius: 5, backgroundColor: '#F59E0B' },
  pillText: { color: '#FCA5A5', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  eyebrow: { color: '#8E868A', fontSize: 9, letterSpacing: 2, marginBottom: 9 },
  hero: { color: '#fff', fontSize: 27, fontWeight: '900', letterSpacing: 0.5, lineHeight: 32 },
  vehicle: { marginTop: 22, backgroundColor: '#110D0F', borderWidth: 1, borderColor: '#3A151B', borderRadius: 22, padding: 19, marginBottom: 28 },
  vehicleTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: RED, fontSize: 9, fontWeight: '800', letterSpacing: 2 },
  tag: { color: '#9E8589', fontSize: 9, letterSpacing: 1 },
  carName: { color: '#fff', fontSize: 25, fontWeight: '800', marginTop: 12 },
  carMeta: { color: '#9A9094', fontSize: 11, marginTop: 3 },
  carArt: { alignItems: 'center', paddingVertical: 10 },
  rule: { height: 1, backgroundColor: '#2B1519', marginBottom: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  statusText: { color: '#D4C8CA', fontSize: 9, letterSpacing: 1, fontWeight: '700' },
  primary: { backgroundColor: '#DC2626', borderRadius: 12, padding: 15, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 1.4 },
  section: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 2, marginBottom: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  tile: { width: '48%', flexGrow: 1, minHeight: 110, backgroundColor: '#110D0F', borderWidth: 1, borderColor: '#2E161A', borderRadius: 16, padding: 15 },
  tileIcon: { color: RED, fontSize: 24, marginBottom: 9 },
  tileTitle: { color: '#fff', fontWeight: '800', fontSize: 13 },
  tileDesc: { color: '#91868A', fontSize: 10, marginTop: 5 },
  footer: { color: '#5A4F52', textAlign: 'center', fontSize: 8, letterSpacing: 1.5, marginTop: 28 },
});
