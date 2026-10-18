import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

/** Brand palette built around the AthenaCognis purple `#7700a7` (shade 500). */
const BRAND_PALETTE = {
  50: '#f9effd',
  100: '#f0d6fb',
  200: '#e2adf6',
  300: '#cd78ee',
  400: '#b04fe0',
  500: '#7700a7',
  600: '#66008f',
  700: '#550077',
  800: '#440060',
  900: '#36004c',
  950: '#220030',
} as const;

/** Aura preset with the brand purple as primary color (lighter shade in dark mode for contrast). */
export const ATHENA_PRESET = definePreset(Aura, {
  semantic: {
    primary: BRAND_PALETTE,
    colorScheme: {
      light: {
        primary: {
          color: '{primary.500}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.600}',
          activeColor: '{primary.700}',
        },
      },
      dark: {
        primary: {
          color: '{primary.300}',
          contrastColor: '{primary.950}',
          hoverColor: '{primary.200}',
          activeColor: '{primary.100}',
        },
      },
    },
  },
});

/** CSS class toggled on `<html>` to switch PrimeNG and the app to dark mode. */
export const DARK_MODE_CLASS = 'app-dark';
