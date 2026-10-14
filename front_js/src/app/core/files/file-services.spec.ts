import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { guardSettingValue, problemFromBackend } from '@domain/contracts';
import { FileActions } from './file-actions';
import { RelationIndex } from './relation-index';
import { UploadConflictError, Uploads } from './uploads';

const FILE = '/shared/2025-01-01/uploads/a.pdf';
const ENCODED = encodeURIComponent(FILE);

/**
 * Wait for pending promise callbacks (each awaited request is issued after the previous resolves).
 *
 * @returns Resolves on the next macrotask.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

describe('file services', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('deletes a file and cleans its references in order', async () => {
    const done = TestBed.inject(FileActions).delete([FILE]);
    const calls: string[] = [];
    const answer = async (
      match: string,
      body: object | string | null,
      status = 200,
    ): Promise<void> => {
      await settle();
      const request = http.expectOne((candidate) => candidate.urlWithParams.includes(match));
      calls.push(`${request.request.method} ${match}`);
      request.flush(body, { status, statusText: status === 200 ? 'OK' : 'Error' });
    };
    await answer(`/api/contacts_of/${ENCODED}`, [{ id: 'c1', name: 'C' }]);
    await answer(`/api/files/delete/${ENCODED}`, {});
    await answer('/api/stockpile/recentadded', null);
    await answer('/api/stockpile/recentopened', null, 500);
    await answer('/api/pinned', null);
    await answer('/api/contact/c1/file', {});
    await answer('/api/stockpile/delete/sota_refs_2025-01-01_a.pdf', 'Internal Server Error', 500);
    expect(await done).toEqual([{ path: FILE, ok: true }]);
    expect(calls).toHaveLength(7);
  });

  it('refuses an upload that would overwrite a file with relations', async () => {
    const upload = firstValueFrom(
      TestBed.inject(Uploads).upload(
        new Blob(['x']),
        { folder: 'uploads', date: '2025-01-01', name: 'a.pdf' },
        { projects: [], tags: ['x'], contacts: [] },
      ),
    );
    await settle();
    http.expectOne(`/api/files/metadata/${ENCODED}`).flush({ size: 1 });
    await expect(upload).rejects.toBeInstanceOf(UploadConflictError);
  });

  it('builds relations from project and tag lists', async () => {
    const result = TestBed.inject(RelationIndex).relationsOf([FILE]);
    await settle();
    http.expectOne('/api/projects').flush([{ name: 'P 1' }]);
    http.expectOne('/api/tags').flush([{ name: 'Empty' }]);
    http.expectOne('/api/pinned').flush([FILE]);
    await settle();
    http.expectOne('/api/project/P%201/files').flush([FILE]);
    await settle();
    http
      .expectOne('/api/tag/Empty/files')
      .flush({ detail: 'none' }, { status: 404, statusText: 'Not Found' });
    expect(await result).toEqual({ [FILE]: { projects: ['P 1'], tags: [], pinned: true } });
  });
});

describe('backend conventions', () => {
  it('normalizes FastAPI errors', () => {
    expect(problemFromBackend(400, { detail: 'Bad' })).toEqual({ status: 400, message: 'Bad' });
    expect(problemFromBackend(500, 'Internal Server Error')).toEqual({
      status: 500,
      message: 'Internal Server Error',
    });
    expect(problemFromBackend(500, { detail: 'Error: 404: Project not found' }).status).toBe(404);
    expect(problemFromBackend(422, { detail: [{ loc: ['q'] }] }).detail).toEqual([{ loc: ['q'] }]);
  });

  it('protects JSON-looking setting strings', () => {
    expect(guardSettingValue('[Draft] me')).toBe(' [Draft] me');
    expect(guardSettingValue('plain')).toBe('plain');
    expect(guardSettingValue(3)).toBe(3);
  });
});
