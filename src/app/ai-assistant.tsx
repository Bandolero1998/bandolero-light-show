import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useAppStore } from '@/store/app-store';

type Message = { role: 'user' | 'assistant'; text: string };

export default function AIAssistantScreen() {
  const { vehicles, activeVehicleId, lastObdData, capabilities, openAiApiKey, setOpenAiApiKey } =
    useAppStore();

  const vehicle = vehicles.find(v => v.id === activeVehicleId);
  const [apiKeyInput, setApiKeyInput] = useState(openAiApiKey || '');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'gpt-4o-mini' | 'gpt-4o'>('gpt-4o-mini');

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Zdravo! Ja sam BANDOLERO AI dijagnostički asistent za vozila. Mogu da protumačim žive OBD-II parametre, kodove grešaka (DTC) i podržane funkcije tvog automobila (npr. Audi A8 D4 4.2 TDI).\n\nUnesi OpenAI API ključ (počinje sa sk-...) da započnemo analizu.',
    },
  ]);

  const dataSummary = useMemo(() => {
    if (!lastObdData) return 'Nema očitavanja uživo. Poveži adapter u Settings i očitaj podatke.';
    return JSON.stringify(
      {
        obrtaji_rpm: lastObdData.rpm,
        brzina_kmh: lastObdData.speed,
        temperatura_vode_C: lastObdData.coolant,
        temperatura_ulja_C: lastObdData.oilTemp,
        temperatura_usisa_C: lastObdData.intake,
        gas_procenat: lastObdData.throttle,
        opterecenje_motora: lastObdData.engineLoad,
        protok_vazduha_maf: lastObdData.maf,
        nivo_goriva: lastObdData.fuelLevel,
        pritisak_goriva_common_rail: lastObdData.fuelRailPressure,
        napon_akumulatora_V: lastObdData.voltage,
        mil_lampa: lastObdData.mil ? 'UPALJENA' : 'UGASENA',
        sacuvane_greske_dtc: lastObdData.dtcs,
        nepotvrdjene_greske_dtc: lastObdData.pendingDtcs,
        vin_broj: capabilities?.vin || lastObdData.vin || 'Nije očitan',
        protokol: capabilities?.protocol || lastObdData.protocol || 'ISO 15765-4 CAN',
      },
      null,
      2
    );
  }, [lastObdData, capabilities]);

  const handleApiKeyChange = (text: string) => {
    setApiKeyInput(text);
    setOpenAiApiKey(text.trim());
  };

  const send = async () => {
    const key = (apiKeyInput || openAiApiKey).trim();
    if (!key || !question.trim() || busy) return;

    const q = question.trim();
    setQuestion('');
    setMessages(m => [...m, { role: 'user', text: q }]);
    setBusy(true);

    try {
      const history = messages.slice(-6).map(m => ({
        role: m.role,
        content: m.text,
      }));

      const systemPrompt = `Ti si BANDOLERO AI, vrhunski automobilski inženjer i stručnjak za dijagnostiku vozila (naročito VAG grupu, Audi, BMW, Mercedes).
Odgovaraj na srpskom jeziku, latinicom.
Tumači isključivo dostavljene OBD-II parametre i DTC kodove grešaka kao činjenice.
Ukoliko vozilo ima DTC kodove, objasni šta znače (npr. senzor, ventil, instalacija) i koje su uobičajene provere.
Jasno naglasi da generički OBD-II pokriva motorni ECU, a ne sve module vozila (5F, 34, 09, itd.).
Nikada ne savetuj opasne prepravke dok je vozilo u pokretu. Budi precizan, tehnički tačan i koristan vozaču ili mehaničaru.`;

      const userContent = `Aktivno vozilo: ${
        vehicle ? `${vehicle.make} ${vehicle.model} (${vehicle.year}), motor: ${vehicle.engine}` : 'Nije izabrano'
      }
Aktuelni OBD podaci i greške:
${dataSummary}

Pitanje korisnika:
${q}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: userContent },
          ],
          temperature: 0.3,
          max_tokens: 800,
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message || `OpenAI API greška status ${response.status}`);
      }

      const answer =
        body.choices?.[0]?.message?.content || 'Model nije vratio odgovor. Pokušaj ponovo.';
      setMessages(m => [...m, { role: 'assistant', text: answer }]);
    } catch (e: any) {
      setMessages(m => [
        ...m,
        {
          role: 'assistant',
          text: `Greška: ${e?.message || 'Nije moguće povezati se sa OpenAI servisom. Proveri API ključ i internet vezu.'}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.brand}>BANDOLERO</Text>
        <Text style={s.title}>AI ASSISTANT</Text>
        <Text style={s.sub}>CHATGPT AUTOMOTIVE DIAGNOSTICS</Text>

        {/* Vehicle Context Card */}
        <View style={s.info}>
          <Text style={s.infoTitle}>VOZILO I KONTEKST ZA ANALIZU</Text>
          <Text style={s.infoMain}>
            {vehicle
              ? `${vehicle.make} ${vehicle.model} · ${vehicle.year} · ${vehicle.engine}`
              : 'Nema izabranog vozila'}
          </Text>
          <Text style={s.infoSub}>
            {lastObdData
              ? `Podaci iz vozila su spremni: RPM: ${Math.round(lastObdData.rpm || 0)} · Brzina: ${lastObdData.speed || 0} km/h · Greške: ${lastObdData.dtcs.length}`
              : 'OBD podaci još nisu očitani sa adaptera.'}
          </Text>
        </View>

        {/* API Key and Model Select */}
        <Text style={s.label}>OPENAI API KLJUČ</Text>
        <TextInput
          value={apiKeyInput}
          onChangeText={handleApiKeyChange}
          placeholder="sk-proj-..."
          placeholderTextColor="#71677E"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={s.key}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 16 }}>
          <Text style={s.small}>Ključ se bezbedno pamti u lokalnoj memoriji aplikacije.</Text>
          <View style={s.modelChips}>
            <TouchableOpacity
              style={[s.modelChip, selectedModel === 'gpt-4o-mini' && s.activeModelChip]}
              onPress={() => setSelectedModel('gpt-4o-mini')}
            >
              <Text style={[s.modelChipText, selectedModel === 'gpt-4o-mini' && s.activeModelChipText]}>
                4o-mini
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modelChip, selectedModel === 'gpt-4o' && s.activeModelChip]}
              onPress={() => setSelectedModel('gpt-4o')}
            >
              <Text style={[s.modelChipText, selectedModel === 'gpt-4o' && s.activeModelChipText]}>
                4o
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Chat Messages */}
        {messages.map((m, i) => (
          <View key={i} style={[s.bubble, m.role === 'user' ? s.user : s.assistant]}>
            <Text style={s.role}>{m.role === 'user' ? 'TI' : 'BANDOLERO AI'}</Text>
            <Text style={s.message}>{m.text}</Text>
          </View>
        ))}

        {busy && (
          <View style={s.loading}>
            <ActivityIndicator color="#C084FC" />
            <Text style={s.small}>Analiziram parametre i kodove grešaka vozila…</Text>
          </View>
        )}

        {/* Data attached preview */}
        <View style={s.context}>
          <Text style={s.contextTitle}>OBD PODACI DOSTAVLJENI MODELU</Text>
          <Text style={s.contextText}>{dataSummary}</Text>
        </View>
      </ScrollView>

      {/* Composer Input Bar */}
      <View style={s.composer}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder="Pitaj o kvaru, senzorima ili parametrima…"
          placeholderTextColor="#82788E"
          style={s.input}
          multiline
        />
        <TouchableOpacity
          onPress={send}
          disabled={busy || !question.trim() || !(apiKeyInput || openAiApiKey).trim()}
          style={[
            s.send,
            (busy || !question.trim() || !(apiKeyInput || openAiApiKey).trim()) && { opacity: 0.4 },
          ]}
        >
          <Text style={s.sendText}>SEND</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#080810' },
  content: { padding: 22, paddingTop: 62, paddingBottom: 22 },
  brand: { color: '#A855F7', fontSize: 12, fontWeight: '900', letterSpacing: 5 },
  title: { color: '#fff', fontSize: 29, fontWeight: '900', marginTop: 32 },
  sub: { color: '#888397', fontSize: 9, letterSpacing: 2, marginTop: 5, marginBottom: 20 },
  info: { backgroundColor: '#171222', borderWidth: 1, borderColor: '#54306B', borderRadius: 13, padding: 14, marginBottom: 16 },
  infoTitle: { color: '#B56AF0', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  infoMain: { color: '#fff', fontSize: 13, fontWeight: '800', marginTop: 8 },
  infoSub: { color: '#90869C', fontSize: 9, marginTop: 5 },
  label: { color: '#C084FC', fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 },
  key: { backgroundColor: '#171323', borderColor: '#3D2D4B', borderWidth: 1, borderRadius: 10, padding: 13, color: '#fff', fontSize: 12 },
  small: { color: '#7E748A', fontSize: 9, lineHeight: 15 },
  modelChips: { flexDirection: 'row', gap: 6 },
  modelChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: '#1F1829', borderWidth: 1, borderColor: '#3B2950' },
  activeModelChip: { backgroundColor: '#8B35D1', borderColor: '#C084FC' },
  modelChipText: { color: '#A498B5', fontSize: 9, fontWeight: '800' },
  activeModelChipText: { color: '#fff' },
  bubble: { borderRadius: 13, padding: 14, marginBottom: 10 },
  assistant: { backgroundColor: '#171323', borderColor: '#352744', borderWidth: 1, marginRight: 20 },
  user: { backgroundColor: '#38204B', marginLeft: 35 },
  role: { color: '#C084FC', fontSize: 8, fontWeight: '900', letterSpacing: 1.4, marginBottom: 7 },
  message: { color: '#F3EDF8', fontSize: 12, lineHeight: 19 },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center', marginVertical: 8 },
  context: { backgroundColor: '#100D16', borderRadius: 10, padding: 12, marginTop: 14 },
  contextTitle: { color: '#8B7B9A', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  contextText: { color: '#82788E', fontSize: 9, lineHeight: 14, marginTop: 6, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderTopColor: '#30263B', borderTopWidth: 1, backgroundColor: '#100D16' },
  input: { flex: 1, minHeight: 44, maxHeight: 100, backgroundColor: '#1B1624', borderRadius: 12, padding: 12, color: '#fff', fontSize: 12 },
  send: { backgroundColor: '#8737C7', paddingHorizontal: 15, paddingVertical: 15, borderRadius: 10 },
  sendText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
});
