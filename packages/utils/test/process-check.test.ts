import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { isProcessRunning } from '../src/process-check.js';
import * as safeExec from '../src/safe-exec.js';

describe('isProcessRunning', () => {
  const originalPlatform = process.platform;
  let mockKill: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockKill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    mockKill.mockRestore();
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  describe('Unix/Mac platform', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      });
    });

    it('should return true when process exists (kill -0 succeeds)', () => {
      mockKill.mockImplementation(() => true);
      expect(isProcessRunning(12345)).toBe(true);
      expect(mockKill).toHaveBeenCalledWith(12345, 0);
    });

    it('should return false when process does not exist (ESRCH error)', () => {
      const error = new Error('No such process');
      (error as NodeJS.ErrnoException).code = 'ESRCH';
      mockKill.mockImplementation(() => {
        throw error;
      });

      expect(isProcessRunning(99999)).toBe(false);
      expect(mockKill).toHaveBeenCalledWith(99999, 0);
    });

    it('should return true when process exists but no permission (EPERM error)', () => {
      const error = new Error('Operation not permitted');
      (error as NodeJS.ErrnoException).code = 'EPERM';
      mockKill.mockImplementation(() => {
        throw error;
      });

      expect(isProcessRunning(1)).toBe(true);
      expect(mockKill).toHaveBeenCalledWith(1, 0);
    });

    it('should return true when process exists but no permission (EACCES error)', () => {
      const error = new Error('Permission denied');
      (error as NodeJS.ErrnoException).code = 'EACCES';
      mockKill.mockImplementation(() => {
        throw error;
      });

      expect(isProcessRunning(1)).toBe(true);
      expect(mockKill).toHaveBeenCalledWith(1, 0);
    });

    it('should return false for other errors', () => {
      const error = new Error('Unexpected error');
      (error as NodeJS.ErrnoException).code = 'EINVAL';
      mockKill.mockImplementation(() => {
        throw error;
      });

      expect(isProcessRunning(12345)).toBe(false);
    });

    it('should work on Linux platform', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });

      mockKill.mockImplementation(() => true);
      expect(isProcessRunning(12345)).toBe(true);
      expect(mockKill).toHaveBeenCalledWith(12345, 0);
    });
  });

  describe('Windows platform', () => {
    let mockSafeExecSync: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      });
      mockSafeExecSync = vi.spyOn(safeExec, 'safeExecSync');
    });

    afterEach(() => {
      mockSafeExecSync.mockRestore();
    });

    it('should return true when tasklist finds the process', () => {
      // Mock safeExecSync to return output with PID
      mockSafeExecSync.mockReturnValue(
        'Image Name                     PID Session Name        Session#    Mem Usage\n' +
        '========================= ======== ================ =========== ============\n' +
        'node.exe                    12345 Console                    1     45,678 K'
      );

      expect(isProcessRunning(12345)).toBe(true);
      expect(mockSafeExecSync).toHaveBeenCalledWith(
        'tasklist',
        ['/FI', 'PID eq 12345', '/NH'],
        { encoding: 'utf8' }
      );
    });

    it('should return false when tasklist does not find the process', () => {
      // Mock safeExecSync to return empty result (no matching process)
      mockSafeExecSync.mockReturnValue(
        'INFO: No tasks are running which match the specified criteria.'
      );

      expect(isProcessRunning(99999)).toBe(false);
      expect(mockSafeExecSync).toHaveBeenCalledWith(
        'tasklist',
        ['/FI', 'PID eq 99999', '/NH'],
        { encoding: 'utf8' }
      );
    });

    it('should return false when tasklist command fails', () => {
      // Mock safeExecSync to throw error (tasklist unavailable or permission denied)
      mockSafeExecSync.mockImplementation(() => {
        throw new Error('tasklist command failed');
      });

      expect(isProcessRunning(12345)).toBe(false);
      expect(mockSafeExecSync).toHaveBeenCalledWith(
        'tasklist',
        ['/FI', 'PID eq 12345', '/NH'],
        { encoding: 'utf8' }
      );
    });

    it('should not match partial PIDs (false positive bug)', () => {
      // Mock tasklist output showing PID 12345
      mockSafeExecSync.mockReturnValue(
        'node.exe                    12345 Console                    1     45,678 K'
      );

      // Should not match PID 123 (substring of 12345)
      expect(isProcessRunning(123)).toBe(false);
      expect(mockSafeExecSync).toHaveBeenCalledWith(
        'tasklist',
        ['/FI', 'PID eq 123', '/NH'],
        { encoding: 'utf8' }
      );
    });

    it('should not match PIDs in other columns (e.g., session number)', () => {
      // Mock tasklist output where PID 1234 appears in Session# column but actual PID is 5678
      mockSafeExecSync.mockReturnValue(
        'node.exe                     5678 Console                 1234     45,678 K'
      );

      // Should not match PID 1234 (appears in Session# column)
      expect(isProcessRunning(1234)).toBe(false);
      expect(mockSafeExecSync).toHaveBeenCalledWith(
        'tasklist',
        ['/FI', 'PID eq 1234', '/NH'],
        { encoding: 'utf8' }
      );
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      });
    });

    it('should handle PID 0', () => {
      mockKill.mockImplementation(() => true);
      expect(isProcessRunning(0)).toBe(true);
    });

    it('should handle negative PID (invalid)', () => {
      const error = new Error('Invalid argument');
      (error as NodeJS.ErrnoException).code = 'EINVAL';
      mockKill.mockImplementation(() => {
        throw error;
      });

      expect(isProcessRunning(-1)).toBe(false);
    });

    it('should handle current process PID', () => {
      mockKill.mockImplementation(() => true);
      expect(isProcessRunning(process.pid)).toBe(true);
      expect(mockKill).toHaveBeenCalledWith(process.pid, 0);
    });
  });
});
