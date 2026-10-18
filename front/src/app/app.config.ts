import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { routes } from './app.routes';
import { AppConfig } from './core/config/app-config';
import { problemInterceptor } from './core/http/interceptors';
import { ATHENA_PRESET } from './core/theme/athena-preset';

/** Root providers of the SPA. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideAppInitializer(() => inject(AppConfig).load()),
    provideHttpClient(withFetch(), withInterceptors([problemInterceptor])),
    provideRouter(routes, withComponentInputBinding()),
    providePrimeNG({
      ripple: false,
      theme: {
        preset: ATHENA_PRESET,
        options: {
          darkModeSelector: '.app-dark',
          cssLayer: { name: 'primeng', order: 'theme, base, primeng, app' },
        },
      },
    }),
    MessageService,
    ConfirmationService,
  ],
};
