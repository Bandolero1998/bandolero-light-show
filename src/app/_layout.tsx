import { DarkTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { AppStoreProvider } from '@/store/app-store';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <AppStoreProvider>
        <AnimatedSplashOverlay />
        <AppTabs />
      </AppStoreProvider>
    </ThemeProvider>
  );
}
