import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.tgent.app',
  appName: 'tgent',
  webDir: 'dist',
  plugins: {
    Keyboard: {
      resize: 'none',
    },
    StatusBar: {
      backgroundColor: '#030712',
      style: 'DARK',
    },
    SplashScreen: {
      backgroundColor: '#030712',
      launchAutoHide: true,
      androidScaleType: 'CENTER_CROP',
    },
  },
  android: {
    allowMixedContent: true,
  },
}

export default config
