/**
 * Unit tests for RosBridgeService
 * Tests the service layer in isolation without n8n dependencies
 */

import { RosBridgeService } from '../services/RosBridgeService';
import type { Ros } from 'roslib';

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
});
