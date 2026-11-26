import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { ModelCatalogStore } from './model-catalog.store';

const LISTED = { text: ['m'], vision: [], transcription: [], error: null };

function storeWith(get: () => Promise<unknown>): ModelCatalogStore {
  TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { get } }] });
  return TestBed.inject(ModelCatalogStore);
}

describe('Model catalog', () => {
  it('loads once for a provider without a list', async () => {
    const get = vi.fn().mockResolvedValue({ 'custom:a': LISTED });
    const store = storeWith(get);
    await store.ensureListed([]);
    expect(get).not.toHaveBeenCalled();
    await store.ensureListed(['custom:a']);
    await store.ensureListed(['custom:a']);
    expect(get).toHaveBeenCalledTimes(1);
    expect(store.catalog()['custom:a']?.text).toEqual(['m']);
  });

  it('does not retry a failed load by itself', async () => {
    const get = vi.fn().mockRejectedValue(new Error('offline'));
    const store = storeWith(get);
    await store.ensureListed(['custom:a']);
    await store.ensureListed(['custom:a']);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
