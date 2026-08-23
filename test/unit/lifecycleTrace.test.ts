import {
  attemptDiagnosticOperation,
  captureLifecycleEnvelope,
  renderLifecycleFailure,
  type LifecycleTraceReaders,
} from '../specs/helpers/lifecycleTrace';

describe('lifecycleTrace', () => {
  it('returns a diagnostic failure without changing the observed operation outcome', async () => {
    const failure = new Error('checkpoint unavailable');

    const diagnosticFailure = await attemptDiagnosticOperation(async () => {
      throw failure;
    });

    expect(diagnosticFailure).toBe(failure);
  });

  it('bounds a diagnostic operation that never settles', async () => {
    const diagnosticFailure = await attemptDiagnosticOperation(
      () => new Promise(() => undefined),
      1,
    );

    expect(renderLifecycleFailure(diagnosticFailure)).toContain('exceeded 1ms');
  });

  it('characterizes a successful ordinary lifecycle retrieval', async () => {
    const trace = { records: [{ event: 'ready' }] };

    const envelope = await captureLifecycleEnvelope({
      origin: 'suite-after',
      primaryError: null,
      originalFailureSeen: false,
      readers: {
        ordinary: async () => trace,
        afterFailure: async () => null,
      },
    });

    expect(envelope).toEqual({
      primaryError: null,
      report: {
        origin: 'suite-after',
        originalOutcome: 'passed',
        originalError: null,
        diagnosticOutcome: 'captured',
        diagnosticError: null,
        trace,
      },
    });
  });

  it('keeps a synthetic primary hook failure primary when ordinary retrieval fails and fallback succeeds', async () => {
    const primaryError = new Error('synthetic beforeEach failure');
    const calls: string[] = [];
    const readers: LifecycleTraceReaders<{ records: Array<{ event: string }> }> = {
      ordinary: async () => {
        calls.push('ordinary');
        throw new Error('webdriver session is unavailable');
      },
      afterFailure: async () => {
        calls.push('fallback');
        return { records: [{ event: 'terminal-failure' }] };
      },
    };

    const envelope = await captureLifecycleEnvelope({
      origin: 'beforeEach:synthetic',
      primaryError,
      originalFailureSeen: true,
      readers,
      failureRetrieval: 'ordinary-then-fallback',
    });

    expect(calls).toEqual(['ordinary', 'fallback']);
    expect(envelope.primaryError).toBe(primaryError);
    expect(envelope.report).toEqual({
      origin: 'beforeEach:synthetic',
      originalOutcome: 'failed',
      originalError: expect.stringContaining('synthetic beforeEach failure'),
      diagnosticOutcome: 'captured',
      diagnosticError: null,
      trace: { records: [{ event: 'terminal-failure' }] },
    });
  });

  it('preserves the Legend failure-path characterization by going directly to bounded fallback', async () => {
    const primaryError = new Error('legend click failure');
    const calls: string[] = [];

    const envelope = await captureLifecycleEnvelope({
      origin: 'test:legend',
      primaryError,
      originalFailureSeen: true,
      readers: {
        ordinary: () => {
          calls.push('ordinary');
          return new Promise(() => undefined);
        },
        afterFailure: async () => {
          calls.push('fallback');
          return { records: [{ event: 'click-invoked' }] };
        },
      },
    });

    expect(calls).toEqual(['fallback']);
    expect(envelope.primaryError).toBe(primaryError);
    expect(envelope.report.diagnosticOutcome).toBe('captured');
  });

  it('keeps the primary error when ordinary retrieval succeeds without entering fallback', async () => {
    const primaryError = new Error('synthetic test failure');
    const calls: string[] = [];

    const envelope = await captureLifecycleEnvelope({
      origin: 'test:ordinary-success',
      primaryError,
      originalFailureSeen: true,
      readers: {
        ordinary: async () => {
          calls.push('ordinary');
          return { records: [{ event: 'already-captured' }] };
        },
        afterFailure: async () => {
          calls.push('fallback');
          return { records: [] };
        },
      },
      failureRetrieval: 'ordinary-then-fallback',
    });

    expect(calls).toEqual(['ordinary']);
    expect(envelope.primaryError).toBe(primaryError);
    expect(envelope.report.diagnosticOutcome).toBe('captured');
  });

  it('reports fallback retrieval failure separately from the primary error', async () => {
    const primaryError = new Error('product failure');

    const envelope = await captureLifecycleEnvelope({
      origin: 'test:failure',
      primaryError,
      originalFailureSeen: true,
      readers: {
        ordinary: async () => null,
        afterFailure: async () => {
          throw new Error('cdp failed');
        },
      },
    });

    expect(envelope.primaryError).toBe(primaryError);
    expect(envelope.report).toEqual(expect.objectContaining({
      originalOutcome: 'failed',
      originalError: expect.stringContaining('product failure'),
      diagnosticOutcome: 'failed',
      diagnosticError: 'Error: cdp failed',
      trace: null,
    }));
  });

  it('renders hostile failures without throwing', () => {
    const hostile = Object.create(null) as { toString?: () => string };
    hostile.toString = () => {
      throw new Error('conversion failed');
    };

    expect(renderLifecycleFailure(hostile)).toBe('Unrenderable failure');
  });
});
