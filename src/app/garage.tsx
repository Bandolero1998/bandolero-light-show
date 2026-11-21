import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView, Alert } from 'react-native';
import { useAppStore } from '@/store/app-store';

const PRESETS = [
  { make: 'Audi', model: 'A8 D4', year: '2010', engine: '4.2 TDI', nickname: 'Testno vozilo: Audi A8 D4' },
  { make: 'BMW', model: '5 Series F10', year: '2012', engine: '3.0d', nickname: 'BMW F10' },
  { make: 'Mercedes-Benz', model: 'E-Class W212', year: '2013', engine: '350 CDI', nickname: 'Mercedes W212' },
  { make: 'Volkswagen', model: 'Passat B7', year: '2011', engine: '2.0 TDI', nickname: 'VW Passat B7' },
];

export default function GarageScreen() {
  const { vehicles, activeVehicleId, addVehicle, removeVehicle, setActiveVehicle } = useAppStore();
  const [open, setOpen] = useState(false);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [engine, setEngine] = useState('');
  const [nickname, setNickname] = useState('');

  const save = () => {
    if (!make.trim() || !model.trim()) {
      Alert.alert('Nedostaju podaci', 'Unesi barem marku i model vozila.');
      return;
    }
    addVehicle({
      make: make.trim(),
      model: model.trim(),
      year: year.trim(),
      engine: engine.trim(),
      nickname: nickname.trim() || undefined,
    });
    setMake('');
    setModel('');
    setYear('');
    setEngine('');
    setNickname('');
    setOpen(false);
  };

  const applyPreset = (p: typeof PRESETS[0]) => {
    setMake(p.make);
    setModel(p.model);
    setYear(p.year);
    setEngine(p.engine);
    setNickname(p.nickname);
  };

  const confirmRemove = (id: string) => {
    Alert.alert('Ukloniti vozilo?', 'Vozilo će biti uklonjeno iz garaže.', [
      { text: 'Otkaži', style: 'cancel' },
      { text: 'Ukloni', style: 'destructive', onPress: () => removeVehicle(id) },
    ]);
  };

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.brand}>BANDOLERO</Text>
        <Text style={s.title}>MOJA GARAŽA</Text>
        <Text style={s.sub}>SAČUVANA VOZILA · {vehicles.length}</Text>

        {vehicles.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>Garaža je prazna</Text>
            <Text style={s.meta}>Dodaj automobil da bi mogao da izabereš aktivno vozilo.</Text>
          </View>
        )}

        {vehicles.map(v => (
          <View key={v.id} style={[s.card, activeVehicleId === v.id && s.activeCard]}>
            <Text style={s.car}>🚘</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{v.nickname || `${v.make} ${v.model}`}</Text>
              <Text style={s.meta}>{[v.year, v.engine].filter(Boolean).join('  •  ') || 'Detalji nisu uneti'}</Text>
              <Text style={s.state}>{activeVehicleId === v.id ? '● AKTIVNO TESTNO VOZILO' : 'SAČUVANO VOZILO'}</Text>
              <TouchableOpacity onPress={() => setActiveVehicle(v.id)} style={s.select}>
                <Text style={s.selectText}>{activeVehicleId === v.id ? 'IZABRANO' : 'POSTAVI KAO AKTIVNO'}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => confirmRemove(v.id)} style={s.remove}>
              <Text style={s.removeText}>×</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity style={s.add} onPress={() => setOpen(true)}>
          <Text style={s.addText}>＋  DODAJ NOVO VOZILO</Text>
        </TouchableOpacity>

        <Text style={s.note}>
          Podaci o vozilima čuvaju se lokalno na uređaju. Prvo aktivno vozilo je konfigurirano za testiranje na Audi A8 D4 4.2 TDI sa VLinker BM+ adapterom.
        </Text>
      </ScrollView>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>NOVO VOZILO</Text>
            <Text style={s.presetLabel}>BRZI ŠABLONI ZA TESTIRANJE:</Text>
            <View style={s.presetRow}>
              {PRESETS.map((p, i) => (
                <TouchableOpacity key={i} style={s.presetChip} onPress={() => applyPreset(p)}>
                  <Text style={s.presetText}>{p.make} {p.model.split(' ')[0]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {[
              [make, setMake, 'Marka (npr. Audi)'],
              [model, setModel, 'Model (npr. A8 D4)'],
              [year, setYear, 'Godište (npr. 2010)'],
              [engine, setEngine, 'Motor (npr. 4.2 TDI)'],
              [nickname, setNickname, 'Naziv / Nadimak (opciono)'],
            ].map(([val, set, ph]: any, i) => (
              <TextInput
                key={i}
                value={val}
                onChangeText={set}
                placeholder={ph}
                placeholderTextColor="#716A7C"
                style={s.input}
              />
            ))}

            <TouchableOpacity style={s.add} onPress={save}>
              <Text style={s.addText}>SAČUVAJ VOZILO</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setOpen(false)} style={{ padding: 14, alignItems: 'center' }}>
              <Text style={{ color: '#A99DB5' }}>OTKAŽI</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#080810' },
  content: { padding: 24, paddingTop: 62, paddingBottom: 36 },
  brand: { color: '#A855F7', fontSize: 12, fontWeight: '900', letterSpacing: 5 },
  title: { color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 34 },
  sub: { color: '#888397', fontSize: 10, letterSpacing: 2, marginTop: 5, marginBottom: 28 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#171323', borderColor: '#30263B', borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 13 },
  activeCard: { borderColor: '#A855F7', backgroundColor: '#1F172E' },
  car: { fontSize: 38 },
  name: { color: '#fff', fontSize: 17, fontWeight: '800' },
  meta: { color: '#9991A4', fontSize: 11, marginTop: 4 },
  state: { color: '#C084FC', fontSize: 9, letterSpacing: 1.2, marginTop: 10, fontWeight: '800' },
  select: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#30203E' },
  selectText: { color: '#E9D5FF', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  remove: { padding: 8 },
  removeText: { color: '#8D8298', fontSize: 24 },
  add: { backgroundColor: '#8B35D1', padding: 17, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  addText: { color: '#fff', fontWeight: '900', letterSpacing: 1.5, fontSize: 11 },
  note: { color: '#746D7D', fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 22 },
  overlay: { flex: 1, backgroundColor: '#000B', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#171323', padding: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 2, marginBottom: 12 },
  presetLabel: { color: '#A855F7', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  presetChip: { backgroundColor: '#261B34', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#482D67' },
  presetText: { color: '#D8B4FE', fontSize: 10, fontWeight: '700' },
  input: { backgroundColor: '#0E0C14', borderColor: '#382B45', borderWidth: 1, borderRadius: 11, color: '#fff', padding: 14, marginBottom: 10 },
  empty: { padding: 22, backgroundColor: '#15121F', borderRadius: 16, marginBottom: 16 },
  emptyTitle: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
