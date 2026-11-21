import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore } from '@/store/app-store';

const purple = '#A855F7';

export default function HomeScreen() {
  const router = useRouter();
  const { vehicles, activeVehicleId, connectionStatus, adapterName, lastObdData } = useAppStore();
  const active = vehicles.find(v => v.id === activeVehicleId);

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';

  const dotColor = isConnected ? '#34D399' : isConnecting ? '#A855F7' : '#F59E0B';
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
        <Text style={[s.hero, { color: purple }]}>YOUR LIGHT SHOW.</Text>

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
            <Text style={{ fontSize: 76 }}>🚘</Text>
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
            <Text style={s.tileIcon}>✦</Text>
            <Text style={s.tileTitle}>Light Show</Text>
            <Text style={s.tileDesc}>Audi A8 D4 UDS & Preview</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.tile} onPress={() => router.push('/garage')}>
            <Text style={s.tileIcon}>⌁</Text>
            <Text style={s.tileTitle}>My Garage</Text>
            <Text style={s.tileDesc}>Saved vehicles ({vehicles.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.tile} onPress={() => router.push('/settings' as any)}>
            <Text style={s.tileIcon}>⚙</Text>
            <Text style={s.tileTitle}>Diagnostics</Text>
            <Text style={s.tileDesc}>Live sensors & DTC codes</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.tile} onPress={() => router.push('/ai-assistant' as any)}>
            <Text style={s.tileIcon}>✨</Text>
            <Text style={s.tileTitle}>AI Diagnostic</Text>
            <Text style={s.tileDesc}>Live OBD analysis</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.footer}>BANDOLERO LIGHT SHOW  •  VERSION 1.2.0</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#080810' },
  content: { padding: 22, paddingTop: 58, paddingBottom: 36 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 34 },
  brand: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 4 },
  subbrand: { color: purple, fontSize: 10, letterSpacing: 6, marginTop: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#191522', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20 },
  dot: { width: 7, height: 7, borderRadius: 5, backgroundColor: '#F59E0B' },
  pillText: { color: '#D7C8E8', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  eyebrow: { color: '#777184', fontSize: 9, letterSpacing: 2, marginBottom: 9 },
  hero: { color: '#fff', fontSize: 27, fontWeight: '900', letterSpacing: 0.5, lineHeight: 32 },
  vehicle: { marginTop: 24, backgroundColor: '#15121F', borderWidth: 1, borderColor: '#39234D', borderRadius: 22, padding: 19, marginBottom: 30 },
  vehicleTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: purple, fontSize: 9, fontWeight: '800', letterSpacing: 2 },
  tag: { color: '#8C7B9C', fontSize: 9, letterSpacing: 1 },
  carName: { color: '#fff', fontSize: 27, fontWeight: '800', marginTop: 13 },
  carMeta: { color: '#888397', fontSize: 11, marginTop: 3 },
  carArt: { alignItems: 'center', paddingVertical: 12 },
  rule: { height: 1, backgroundColor: '#30263B', marginBottom: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  statusText: { color: '#B6AFC0', fontSize: 9, letterSpacing: 1, fontWeight: '700' },
  primary: { backgroundColor: '#8B35D1', borderRadius: 12, padding: 15, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 1.4 },
  section: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 2, marginBottom: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  tile: { width: '48%', flexGrow: 1, minHeight: 116, backgroundColor: '#13111B', borderWidth: 1, borderColor: '#292132', borderRadius: 16, padding: 15 },
  tileIcon: { color: purple, fontSize: 25, marginBottom: 10 },
  tileTitle: { color: '#fff', fontWeight: '800', fontSize: 13 },
  tileDesc: { color: '#827B8D', fontSize: 10, marginTop: 5 },
  footer: { color: '#514B5A', textAlign: 'center', fontSize: 8, letterSpacing: 1.5, marginTop: 30 },
});
