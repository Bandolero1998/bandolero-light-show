import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { LiveData } from '@/services/obd-ble';
import { VehicleCapabilities } from '@/services/vehicle-capabilities';

export type Vehicle = {
  id: string;
  make: string;
  model: string;
  year: string;
  engine: string;
  nickname?: string;
  canProtocol?: string;
  module09Address?: string;
};

type AppData = {
  vehicles: Vehicle[];
  activeVehicleId: string | null;
  adapterName: string;
  lastObdData: LiveData | null;
  capabilities: VehicleCapabilities | null;
  openAiApiKey: string;
  isSafetyUnlocked: boolean;
};

type Store = AppData & {
  ready: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  setConnectionStatus: (status: 'disconnected' | 'connecting' | 'connected') => void;
  setLastObdData: (data: LiveData | null) => void;
  setCapabilities: (caps: VehicleCapabilities | null) => void;
  setOpenAiApiKey: (key: string) => void;
  setSafetyUnlocked: (unlocked: boolean) => void;
  addVehicle: (v: Omit<Vehicle, 'id'>) => void;
  removeVehicle: (id: string) => void;
  setActiveVehicle: (id: string) => void;
  setAdapterName: (name: string) => void;
};

const initial: AppData = {
  vehicles: [
    {
      id: 'a8-d4-2010',
      make: 'Audi',
      model: 'A8 D4',
      year: '2010',
      engine: '4.2 TDI',
      nickname: 'Bandolero A8 4.2 TDI',
      canProtocol: 'ISO 15765-4 (CAN 11/500)',
      module09Address: '0x710',
    },
  ],
  activeVehicleId: 'a8-d4-2010',
  adapterName: 'VLinker BM+',
  lastObdData: null,
  capabilities: null,
  openAiApiKey: '',
  isSafetyUnlocked: false,
};

const StoreContext = createContext<Store | null>(null);
const FILE = `${FileSystem.documentDirectory ?? ''}bandolero-data.json`;

async function readData(): Promise<AppData> {
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem('bandolero-data');
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    }
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return initial;
    const raw = await FileSystem.readAsStringAsync(FILE);
    return { ...initial, ...JSON.parse(raw) };
  } catch {
    return initial;
  }
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>(initial);
  const [ready, setReady] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');

  useEffect(() => {
    let live = true;
    readData().then(value => {
      if (live) {
        setData(value);
        setReady(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const raw = JSON.stringify(data);
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.setItem('bandolero-data', raw);
      } catch {}
    } else {
      FileSystem.writeAsStringAsync(FILE, raw).catch(() => {});
    }
  }, [data, ready]);

  const value = useMemo<Store>(
    () => ({
      ...data,
      ready,
      connectionStatus,
      setConnectionStatus,
      setLastObdData: lastObdData => setData(d => ({ ...d, lastObdData })),
      setCapabilities: capabilities => setData(d => ({ ...d, capabilities })),
      setOpenAiApiKey: openAiApiKey => setData(d => ({ ...d, openAiApiKey })),
      setSafetyUnlocked: isSafetyUnlocked => setData(d => ({ ...d, isSafetyUnlocked })),
      addVehicle: v =>
        setData(d => {
          const id = `vehicle-${Date.now()}`;
          return {
            ...d,
            vehicles: [...d.vehicles, { ...v, id }],
            activeVehicleId: id,
          };
        }),
      removeVehicle: id =>
        setData(d => {
          const vehicles = d.vehicles.filter(v => v.id !== id);
          return {
            ...d,
            vehicles,
            activeVehicleId: d.activeVehicleId === id ? (vehicles[0]?.id ?? null) : d.activeVehicleId,
          };
        }),
      setActiveVehicle: id => setData(d => ({ ...d, activeVehicleId: id })),
      setAdapterName: adapterName => setData(d => ({ ...d, adapterName })),
    }),
    [data, ready, connectionStatus]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useAppStore must be used inside AppStoreProvider');
  return value;
}
