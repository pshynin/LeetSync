gi/**
 * Tests for GithubHandler.submit() - the core submission workflow
 * Tests that submissions succeed/fail based on file uploads and credentials
 */

jest.mock('../constants', () => ({
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  GITHUB_REDIRECT_URI: 'http://localhost:3000',
}));

import GithubHandler from '../handlers/GithubHandler';
import { Submission } from '../types/Submission';

describe('GithubHandler.submit() - Submission Workflow', () => {
  let handler: GithubHandler;
  const mockChromeSyncGet = jest.fn();
  const mockChromeSyncSet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).chrome = {
      storage: {
        sync: {
          get: mockChromeSyncGet,
          set: mockChromeSyncSet,
          clear: jest.fn(),
        },
      },
    };

    (global.fetch as jest.Mock) = jest.fn();

    // Default mock: credentials are in storage
    mockChromeSyncGet.mockImplementation((keys: any, _callback?: any) => {
      return Promise.resolve({
        github_leetsync_token: 'test-token',
        github_username: 'test-user',
        github_leetsync_repo: 'test-repo',
        github_leetsync_subdirectory: '',
        problemsSolved: {},
      });
    });

    handler = new GithubHandler();
  });

  const createMockSubmission = (
    overrides?: Partial<Submission>,
  ): Submission => ({
    code: 'def twoSum(nums, target):\n  return []',
    memory: 24.2,
    memoryDisplay: '24.2 MB',
    memoryPercentile: 75.5,
    runtime: 45,
    runtimePercentile: 85.3,
    runtimeDisplay: '45 ms',
    runtimeDistribution: { percentile: '85', value: 45 } as any,
    lang: { name: 'Python', verboseName: 'Python3' } as any,
    statusCode: 10, // Success
    question: {
      questionId: '1',
      questionFrontendId: '1',
      acRate: 45.5,
      difficulty: 'Easy',
      freqBar: 5,
      isFavor: false,
      isPaidOnly: false,
      content: '<p>Given an array of integers...</p>',
      status: 'ac',
      title: 'Two Sum',
      titleSlug: 'two-sum',
      topicTags: [],
      hasSolution: true,
      hasVideoSolution: true,
    } as any,
    timestamp: Math.floor(Date.now() / 1000),
    notes: '',
    user: {} as any,
    lastTestcase: '',
    topicTags: [],
    runtimeError: null,
    compileError: null,
  });

  describe('Failed submissions', () => {
    it('should return false when statusCode is not 10 (failed attempt)', async () => {
      const submission = createMockSubmission({ statusCode: 11 }); // Wrong answer

      const result = await handler.submit(submission);

      expect(result).toBe(false);
    });

    it('should return false when language is not supported', async () => {
      const submission = createMockSubmission({
        lang: { name: 'Unknown', verboseName: 'Unknown' } as any,
      });

      const result = await handler.submit(submission);

      expect(result).toBe(false);
    });

    it('should return false when credentials are missing (no token)', async () => {
      mockChromeSyncGet.mockResolvedValueOnce({
        github_leetsync_token: undefined,
        github_username: 'test-user',
        github_leetsync_repo: 'test-repo',
      });

      const submission = createMockSubmission();
      const result = await handler.submit(submission);

      expect(result).toBe(false);
    });

    it('should return false when credentials are missing (no username)', async () => {
      mockChromeSyncGet.mockResolvedValueOnce({
        github_leetsync_token: 'test-token',
        github_username: undefined,
        github_leetsync_repo: 'test-repo',
      });

      const submission = createMockSubmission();
      const result = await handler.submit(submission);

      expect(result).toBe(false);
    });

    it('should return false when credentials are missing (no repo)', async () => {
      mockChromeSyncGet.mockResolvedValueOnce({
        github_leetsync_token: 'test-token',
        github_username: 'test-user',
        github_leetsync_repo: undefined,
      });

      const submission = createMockSubmission();
      const result = await handler.submit(submission);

      expect(result).toBe(false);
    });

    it('should return false when README upload fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Bad credentials' }),
      });

      jest.spyOn(handler, 'fileExists').mockResolvedValueOnce(null);

      const submission = createMockSubmission();
      const result = await handler.submit(submission);

      expect(result).toBe(false);
    });

    it('should return false when solution file upload fails', async () => {
      // Mock successful README upload
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ commit: { sha: 'abc123' } }),
        })
        // Mock failed solution file upload
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          json: async () => ({ message: 'Invalid request' }),
        });

      jest.spyOn(handler, 'fileExists').mockResolvedValue(null);

      const submission = createMockSubmission();
      const result = await handler.submit(submission);

      expect(result).toBe(false);
    });
  });

  describe('Successful submissions', () => {
    it('should return true when all files upload successfully', async () => {
      // Mock successful file uploads (README, solution, no notes)
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ commit: { sha: 'abc123' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ commit: { sha: 'def456' } }),
        });

      jest.spyOn(handler, 'fileExists').mockResolvedValue(null);

      const submission = createMockSubmission();
      const result = await handler.submit(submission);

      expect(result).toBe(true);
    });

    it('should upload all files (README, solution, notes) when notes exist', async () => {
      const submission = createMockSubmission({
        notes: 'Time limit: O(n), Space: O(1)',
      });

      // Mock successful file uploads
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, status: 201 })
        .mockResolvedValueOnce({ ok: true, status: 201 })
        .mockResolvedValueOnce({ ok: true, status: 201 });

      jest.spyOn(handler, 'fileExists').mockResolvedValue(null);

      const result = await handler.submit(submission);

      expect(result).toBe(true);
      // Verify fileExists was called for each file type
      expect(handler.fileExists).toHaveBeenCalledTimes(3); // README, Notes, Solution
    });

    it('should skip notes upload when notes are empty', async () => {
      const submission = createMockSubmission({ notes: '' });

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, status: 201 })
        .mockResolvedValueOnce({ ok: true, status: 201 });

      jest.spyOn(handler, 'fileExists').mockResolvedValue(null);

      const result = await handler.submit(submission);

      expect(result).toBe(true);
      // Only README and Solution should be uploaded
      expect(handler.fileExists).toHaveBeenCalledTimes(2);
    });

    it('should update existing files when they already exist', async () => {
      const sha = 'existing-file-sha';

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, status: 200 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      jest.spyOn(handler, 'fileExists').mockResolvedValue(sha);

      const submission = createMockSubmission();
      const result = await handler.submit(submission);

      expect(result).toBe(true);
      // Verify fileExists was called and returned sha (for update)
      expect(handler.fileExists).toHaveBeenCalled();
    });
  });

  describe('Storage updates on success', () => {
    it('should update problemsSolved on successful submission', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, status: 201 })
        .mockResolvedValueOnce({ ok: true, status: 201 });

      jest.spyOn(handler, 'fileExists').mockResolvedValue(null);

      const submission = createMockSubmission();
      await handler.submit(submission);

      // Check that problemsSolved was updated
      const setCalls = mockChromeSyncSet.mock.calls;
      const problemsSolvedUpdate = setCalls.find(
        (call) => call[0].problemsSolved,
      );

      expect(problemsSolvedUpdate).toBeDefined();
      expect(problemsSolvedUpdate[0].problemsSolved).toHaveProperty(
        'two-sum',
      );
    });

    it('should update lastSolved on successful submission', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, status: 201 })
        .mockResolvedValueOnce({ ok: true, status: 201 });

      jest.spyOn(handler, 'fileExists').mockResolvedValue(null);

      const submission = createMockSubmission();
      await handler.submit(submission);

      // Check that lastSolved was updated
      const setCalls = mockChromeSyncSet.mock.calls;
      const lastSolvedUpdate = setCalls.find((call) => call[0].lastSolved);

      expect(lastSolvedUpdate).toBeDefined();
      expect(lastSolvedUpdate[0].lastSolved).toHaveProperty('slug', 'two-sum');
      expect(lastSolvedUpdate[0].lastSolved).toHaveProperty('timestamp');
    });
  });

  describe('File path construction', () => {
    it('should construct correct path with questionFrontendId', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, status: 201 })
        .mockResolvedValueOnce({ ok: true, status: 201 });

      const fileExistsSpy = jest
        .spyOn(handler, 'fileExists')
        .mockResolvedValue(null);

      const submission = createMockSubmission({
        question: {
          ...createMockSubmission().question,
          questionFrontendId: '1',
          titleSlug: 'two-sum',
        } as any,
      });

      await handler.submit(submission);

      // Verify the path includes questionFrontendId and titleSlug
      const pathCalls = fileExistsSpy.mock.calls;
      const firstCall = pathCalls[0];
      expect(firstCall[0]).toContain('1-two-sum');
    });

    it('should use questionId fallback when questionFrontendId is missing', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, status: 201 })
        .mockResolvedValueOnce({ ok: true, status: 201 });

      const fileExistsSpy = jest
        .spyOn(handler, 'fileExists')
        .mockResolvedValue(null);

      const submission = createMockSubmission({
        question: {
          ...createMockSubmission().question,
          questionFrontendId: undefined,
          questionId: '1',
          titleSlug: 'two-sum',
        } as any,
      });

      await handler.submit(submission);

      const pathCalls = fileExistsSpy.mock.calls;
      const firstCall = pathCalls[0];
      expect(firstCall[0]).toContain('1-two-sum');
    });

    it('should use "unknown" when both questionFrontendId and questionId are missing', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, status: 201 })
        .mockResolvedValueOnce({ ok: true, status: 201 });

      const fileExistsSpy = jest
        .spyOn(handler, 'fileExists')
        .mockResolvedValue(null);

      const submission = createMockSubmission({
        question: {
          ...createMockSubmission().question,
          questionFrontendId: undefined,
          questionId: undefined,
          titleSlug: 'two-sum',
        } as any,
      });

      await handler.submit(submission);

      const pathCalls = fileExistsSpy.mock.calls;
      const firstCall = pathCalls[0];
      expect(firstCall[0]).toContain('unknown-two-sum');
    });

    it('should prepend subdirectory when configured', async () => {
      // Create a new handler with subdirectory
      mockChromeSyncGet.mockResolvedValueOnce({
        github_leetsync_token: 'test-token',
        github_username: 'test-user',
        github_leetsync_repo: 'test-repo',
        github_leetsync_subdirectory: 'leetcode-solutions',
      });

      const handlerWithSubdir = new GithubHandler();

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, status: 201 })
        .mockResolvedValueOnce({ ok: true, status: 201 });

      const fileExistsSpy = jest
        .spyOn(handlerWithSubdir, 'fileExists')
        .mockResolvedValue(null);

      const submission = createMockSubmission();
      await handlerWithSubdir.submit(submission);

      const pathCalls = fileExistsSpy.mock.calls;
      const firstCall = pathCalls[0];
      expect(firstCall[0]).toContain('leetcode-solutions/1-two-sum');
    });
  });
});

