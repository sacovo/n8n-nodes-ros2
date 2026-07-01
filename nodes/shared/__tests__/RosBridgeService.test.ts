/**
 * Unit tests for RosBridgeService
 * Tests the service layer in isolation without n8n dependencies
 */

import { RosBridgeService, type JsonRecord } from '../services/RosBridgeService';
import type { ActionClient, Goal, Ros } from 'roslib';

describe('RosBridgeService', () => {
    describe('buildRosbridgeUrl', () => {
        it('builds URL with protocol, host, and port', () => {
            const credentials = {
                protocol: 'ws' as const,
                host: 'localhost',
                port: 9090,
            };

            const url = RosBridgeService.buildRosbridgeUrl(credentials);

            expect(url).toBe('ws://localhost:9090');
        });

        it('builds URL with path', () => {
            const credentials = {
                protocol: 'wss' as const,
                host: 'ros.example.com',
                port: 443,
                path: '/ros',
            };

            const url = RosBridgeService.buildRosbridgeUrl(credentials);

            expect(url).toBe('wss://ros.example.com:443/ros');
        });

        it('normalizes path without leading slash', () => {
            const credentials = {
                protocol: 'ws' as const,
                host: 'localhost',
                port: 9090,
                path: 'ros',
            };

            const url = RosBridgeService.buildRosbridgeUrl(credentials);

            expect(url).toBe('ws://localhost:9090/ros');
        });

        it('adds auth token to URL', () => {
            const credentials = {
                protocol: 'ws' as const,
                host: 'localhost',
                port: 9090,
                authToken: 'mytoken123',
                authQueryParameter: 'auth',
            };

            const url = RosBridgeService.buildRosbridgeUrl(credentials);

            expect(url).toContain('auth=mytoken123');
            expect(url).toBe('ws://localhost:9090?auth=mytoken123');
        });

        it('uses default token parameter name', () => {
            const credentials = {
                protocol: 'ws' as const,
                host: 'localhost',
                port: 9090,
                authToken: 'mytoken123',
            };

            const url = RosBridgeService.buildRosbridgeUrl(credentials);

            expect(url).toContain('token=mytoken123');
        });

        it('encodes auth token', () => {
            const credentials = {
                protocol: 'ws' as const,
                host: 'localhost',
                port: 9090,
                authToken: 'token with spaces',
                authQueryParameter: 'auth',
            };

            const url = RosBridgeService.buildRosbridgeUrl(credentials);

            expect(url).toContain('token%20with%20spaces');
        });

        it('handles URL with existing query parameters', () => {
            const credentials = {
                protocol: 'ws' as const,
                host: 'localhost',
                port: 9090,
                path: '/ros?param=value',
                authToken: 'mytoken123',
                authQueryParameter: 'auth',
            };

            const url = RosBridgeService.buildRosbridgeUrl(credentials);

            expect(url).toContain('&auth=mytoken123');
        });
    });

    describe('close', () => {
        it('does NOT close a Ros connection (due to pooling)', () => {
            const mockRos = { close: jest.fn() } as unknown as Ros;

            RosBridgeService.close(mockRos);

            expect(mockRos.close).not.toHaveBeenCalled();
        });

        it('handles null Ros connection', () => {
            expect(() => RosBridgeService.close(null)).not.toThrow();
        });

        it('handles undefined Ros connection', () => {
            expect(() => RosBridgeService.close(undefined)).not.toThrow();
        });
    });

    describe('connect (pool reuse)', () => {
        const getConnectionPool = () =>
            (RosBridgeService as unknown as { connectionPool: Map<string, Ros> }).connectionPool;

        afterEach(() => {
            getConnectionPool().clear();
        });

        it('reuses a pooled connection when isConnected is true (regression for da230fc)', async () => {
            const credentials = {
                protocol: 'ws' as const,
                host: 'localhost',
                port: 9090,
            };
            const url = RosBridgeService.buildRosbridgeUrl(credentials);
            const mockRos = { isConnected: true } as unknown as Ros;
            getConnectionPool().set(url, mockRos);

            const result = await RosBridgeService.connect(credentials);

            // Before da230fc, this checked `(pooledRos as any).socket.readyState`,
            // which is always undefined for roslib 2.x, so pooling never kicked in
            // and this would NOT have returned the pooled instance.
            expect(result).toBe(mockRos);
        });
    });

    describe('extractGoalId', () => {
        const extractGoalId = (goal: Goal<JsonRecord>): string =>
            (RosBridgeService as unknown as { extractGoalId: (goal: Goal<JsonRecord>) => string }).extractGoalId(goal);

        it('returns roslib\'s real goalID string (regression: goalID is a string, not { id: string })', () => {
            const mockGoal = { goalID: 'goal_12345' } as unknown as Goal<JsonRecord>;

            expect(extractGoalId(mockGoal)).toBe('goal_12345');
        });

        it('falls back to a generated id when goalID is falsy', () => {
            const mockGoal = { goalID: '' } as unknown as Goal<JsonRecord>;

            expect(extractGoalId(mockGoal)).toMatch(/^goal-\d+$/);
        });
    });

    describe('attachExistingGoalId', () => {
        const attachExistingGoalId = (
            actionClient: ActionClient<JsonRecord, unknown, unknown>,
            goal: Goal<JsonRecord>,
            goalId: string,
        ): void =>
            (
                RosBridgeService as unknown as {
                    attachExistingGoalId: (
                        actionClient: ActionClient<JsonRecord, unknown, unknown>,
                        goal: Goal<JsonRecord>,
                        goalId: string,
                    ) => void;
                }
            ).attachExistingGoalId(actionClient, goal, goalId);

        it('re-keys the dummy goal onto the real goalId (regression: previous override never took effect)', () => {
            const mockGoal = {
                goalID: 'goal_auto_generated',
                goalMessage: { goal_id: { id: 'goal_auto_generated', stamp: { secs: 0, nsecs: 0 } }, goal: {} },
            } as unknown as Goal<JsonRecord>;
            const mockActionClient = {
                goals: { goal_auto_generated: mockGoal },
            } as unknown as ActionClient<JsonRecord, unknown, unknown>;

            attachExistingGoalId(mockActionClient, mockGoal, 'goal_real_existing');

            // Before this fix, `(goal as any).goalID = { id: goalId }` neither updated
            // goalMessage.goal_id.id nor re-keyed actionClient.goals, so cancel()/result
            // dispatch could never match the real goal.
            expect(mockGoal.goalID).toBe('goal_real_existing');
            expect(mockGoal.goalMessage.goal_id.id).toBe('goal_real_existing');
            expect(mockActionClient.goals.goal_auto_generated).toBeUndefined();
            expect(mockActionClient.goals.goal_real_existing).toBe(mockGoal);
        });
    });
});
