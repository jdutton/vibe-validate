import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { stopProcessGroup } from '../src/process-utils.js';

describe('process-utils', () => {
  describe('stopProcessGroup', () => {
    let mockProcess: ChildProcess & EventEmitter;
    let processKillSpy: ReturnType<typeof vi.spyOn>;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    const isWindows = process.platform === 'win32';

    beforeEach(() => {
      // Create mock child process
      mockProcess = new EventEmitter() as ChildProcess & EventEmitter;
      mockProcess.killed = false;
      mockProcess.pid = 12345;

      // Spy on process.kill
      processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      // Spy on console.log
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.restoreAllMocks();
    });

    it.skipIf(isWindows)('should send SIGTERM to process group (Unix only)', async () => {
      const stopPromise = stopProcessGroup(mockProcess, 'TestProcess');

      // Immediately emit exit to resolve quickly
      setImmediate(() => mockProcess.emit('exit', 0, null));

      await stopPromise;

      // Should kill with negative PID (process group)
      expect(processKillSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
    });

    it('should log process name when stopped', async () => {
      const stopPromise = stopProcessGroup(mockProcess, 'MyTestProcess');

      setImmediate(() => mockProcess.emit('exit', 0, null));

      await stopPromise;

      expect(consoleLogSpy).toHaveBeenCalledWith('🛑 MyTestProcess stopped');
    });

    it('should use default process name if not provided', async () => {
      const stopPromise = stopProcessGroup(mockProcess);

      setImmediate(() => mockProcess.emit('exit', 0, null));

      await stopPromise;

      expect(consoleLogSpy).toHaveBeenCalledWith('🛑 Process stopped');
    });

    it.skipIf(isWindows)('should send SIGKILL after 1 second if process does not exit (Unix only)', async () => {
      vi.useFakeTimers();

      const stopPromise = stopProcessGroup(mockProcess, 'StubbornProcess');

      // Fast-forward 1 second
      vi.advanceTimersByTime(1000);

      // Should send SIGKILL to process group
      expect(processKillSpy).toHaveBeenCalledWith(-12345, 'SIGKILL');

      // Now emit exit
      mockProcess.emit('exit', 0, null);

      vi.useRealTimers();
      await stopPromise;
    });

    it('should resolve after 2 seconds regardless of exit event', async () => {
      vi.useFakeTimers();

      const stopPromise = stopProcessGroup(mockProcess, 'HungProcess');

      // Fast-forward 2 seconds without emitting exit
      vi.advanceTimersByTime(2000);

      vi.useRealTimers();

      // Should resolve due to ultimate timeout
      await expect(stopPromise).resolves.toBeUndefined();
    });

    it('should handle process already killed', async () => {
      mockProcess.killed = true;

      await expect(stopProcessGroup(mockProcess, 'AlreadyKilled')).resolves.toBeUndefined();

      // Should not attempt to kill
      expect(processKillSpy).not.toHaveBeenCalled();
    });

    it('should handle missing PID', async () => {
      mockProcess.pid = undefined;

      await expect(stopProcessGroup(mockProcess, 'NoPID')).resolves.toBeUndefined();

      // Should not attempt to kill
      expect(processKillSpy).not.toHaveBeenCalled();
    });

    it('should handle process.kill throwing error on SIGTERM', async () => {
      processKillSpy.mockImplementation(() => {
        throw new Error('No such process');
      });

      const stopPromise = stopProcessGroup(mockProcess, 'ErrorProcess');

      setImmediate(() => mockProcess.emit('exit', 0, null));

      // Should not throw - error is caught
      await expect(stopPromise).resolves.toBeUndefined();
    });

    it('should handle process.kill throwing error on SIGKILL', async () => {
      vi.useFakeTimers();

      let callCount = 0;
      processKillSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return true; // SIGTERM succeeds
        }
        throw new Error('Process already dead'); // SIGKILL fails
      });

      const stopPromise = stopProcessGroup(mockProcess, 'ErrorProcess');

      // Fast-forward to SIGKILL
      vi.advanceTimersByTime(1000);

      // Fast-forward to ultimate timeout
      vi.advanceTimersByTime(1000);

      vi.useRealTimers();

      // Should not throw - error is caught
      await expect(stopPromise).resolves.toBeUndefined();
    });

    it('should handle multiple simultaneous stop attempts', async () => {
      vi.useFakeTimers();

      const stopPromise1 = stopProcessGroup(mockProcess, 'Process1');
      const stopPromise2 = stopProcessGroup(mockProcess, 'Process2');

      // Emit exit after 500ms
      vi.advanceTimersByTime(500);
      mockProcess.emit('exit', 0, null);

      vi.useRealTimers();

      // Both should resolve
      await expect(Promise.all([stopPromise1, stopPromise2])).resolves.toBeDefined();
    });

    it.skipIf(isWindows)('should kill entire process group (negative PID) (Unix only)', async () => {
      const stopPromise = stopProcessGroup(mockProcess, 'GroupProcess');

      setImmediate(() => mockProcess.emit('exit', 0, null));

      await stopPromise;

      // Verify negative PID is used (kills entire process group)
      const calls = processKillSpy.mock.calls;
      expect(calls[0][0]).toBe(-12345); // Negative PID
      expect(calls[0][1]).toBe('SIGTERM');
    });

    it('should handle exit event with non-zero code', async () => {
      const stopPromise = stopProcessGroup(mockProcess, 'FailedProcess');

      setImmediate(() => mockProcess.emit('exit', 1, null));

      await stopPromise;

      expect(consoleLogSpy).toHaveBeenCalledWith('🛑 FailedProcess stopped');
    });

    it('should handle exit event with signal', async () => {
      const stopPromise = stopProcessGroup(mockProcess, 'SignalledProcess');

      setImmediate(() => mockProcess.emit('exit', null, 'SIGTERM'));

      await stopPromise;

      expect(consoleLogSpy).toHaveBeenCalledWith('🛑 SignalledProcess stopped');
    });
  });
});
