import { inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { CaptureService } from './core/capture/capture.service';
import { ShellComponent } from './core/layout/shell.component';

/**
 * `/upload` deep link: open the upload dialog over the library.
 *
 * @returns Redirect to the library.
 */
function openUploadRedirect(): ReturnType<Router['createUrlTree']> {
  inject(CaptureService).openUpload();
  return inject(Router).createUrlTree(['/library']);
}

/** Application routes. */
export const routes: Routes = [
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      {
        path: 'home',
        title: 'Home · AthenaCognis',
        loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage),
      },
      {
        path: 'library',
        title: 'Library · AthenaCognis',
        loadComponent: () => import('./features/library/library.page').then((m) => m.LibraryPage),
      },
      {
        path: 'f/:date/:folder/:name',
        title: 'Document · AthenaCognis',
        loadComponent: () => import('./features/viewer/viewer.page').then((m) => m.ViewerPage),
      },
      {
        path: 'notes',
        title: 'Notes · AthenaCognis',
        loadComponent: () => import('./features/notes/notes.page').then((m) => m.NotesPage),
      },
      { path: 'upload', canActivate: [openUploadRedirect], children: [] },
      {
        path: 'time',
        title: 'Time · AthenaCognis',
        loadComponent: () => import('./features/time/time.page').then((m) => m.TimePage),
      },
      {
        path: 'work',
        title: 'Work · AthenaCognis',
        loadComponent: () => import('./features/work/work.page').then((m) => m.WorkPage),
      },
      {
        path: 'projects',
        title: 'Projects · AthenaCognis',
        loadComponent: () =>
          import('./features/projects/projects.page').then((m) => m.ProjectsPage),
      },
      {
        path: 'projects/:name',
        title: 'Project · AthenaCognis',
        loadComponent: () => import('./features/projects/project.page').then((m) => m.ProjectPage),
      },
      {
        path: 'people',
        title: 'People · AthenaCognis',
        loadComponent: () => import('./features/people/people.page').then((m) => m.PeoplePage),
      },
      {
        path: 'people/:id',
        title: 'People · AthenaCognis',
        loadComponent: () => import('./features/people/people.page').then((m) => m.PeoplePage),
      },
      {
        path: 'research',
        title: 'Research · AthenaCognis',
        loadComponent: () =>
          import('./features/research/research.page').then((m) => m.ResearchPage),
      },
      {
        path: 'assistant',
        title: 'Assistant · AthenaCognis',
        loadComponent: () =>
          import('./features/assistant/assistant.page').then((m) => m.AssistantPage),
      },
      {
        path: 'settings',
        title: 'Settings · AthenaCognis',
        loadComponent: () =>
          import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
