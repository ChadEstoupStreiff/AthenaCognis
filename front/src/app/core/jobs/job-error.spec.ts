import { jobFailure, messageOf } from './job-error';

describe('job failure reason', () => {
  it('reduces raw provider JSON to its message', () => {
    const result =
      'Claude error 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low."},"request_id":"r"}';
    expect(jobFailure({ state: 'FAILED', result })).toBe(
      'Claude error 400: Your credit balance is too low.',
    );
  });

  it('keeps plain reasons and ignores tasks that did not fail', () => {
    expect(
      jobFailure({ state: 'FAILED', result: 'Nothing to summarize: OCR found no text.' }),
    ).toBe('Nothing to summarize: OCR found no text.');
    expect(jobFailure({ state: 'FAILED', result: null })).toBe('Failed without a reason.');
    expect(jobFailure({ state: 'COMPLETED', result: 'summary' })).toBeNull();
    expect(jobFailure({ state: 'FAILED', result: 'Bad {json' })).toBe('Bad {json');
  });

  it('finds messages in nested and list bodies', () => {
    expect(messageOf([{ error: { message: 'API key not valid' } }])).toBe('API key not valid');
    expect(messageOf({ detail: 'Unauthorized' })).toBe('Unauthorized');
    expect(messageOf({ code: 1 })).toBeNull();
  });
});
