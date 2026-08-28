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

    describe('connect (websocket leak regression for da230fc)', () => {
        // Fake roslib Ros: every construction represents one real websocket
        // that would be opened against the rosbridge server.
        class FakeRos {
            static instances: FakeRos[] = [];
            static autoConnect = true;

            isConnected = false;
            socketUrl?: string;
            closeCalls = 0;
            private handlers = new Map<string, Array<(event?: unknown) => void>>();

            constructor(options: { url: string }) {
                this.socketUrl = options.url;
                FakeRos.instances.push(this);
                queueMicrotask(() => {
                    if (FakeRos.autoConnect && this.closeCalls === 0) {
                        this.isConnected = true;
                        this.emit('connection');
                    }
                });
            }

            on(event: string, handler: (event?: unknown) => void): void {
                const list = this.handlers.get(event) ?? [];
                list.push(handler);
                this.handlers.set(event, list);
            }

            once(event: string, handler: (event?: unknown) => void): void {
                this.on(event, handler);
            }

            emit(event: string, payload?: unknown): void {
                for (const handler of [...(this.handlers.get(event) ?? [])]) {
                    handler(payload);
                }
            }

            close(): void {
                this.closeCalls++;
                this.isConnected = false;
                this.emit('close');
            }
        }

        const credentials = {
            protocol: 'ws' as const,
            host: 'localhost',
            port: 9090,
        };

        const getConnectionPool = () =>
            (RosBridgeService as unknown as { connectionPool: Map<string, Ros> }).connectionPool;

        beforeEach(() => {
            FakeRos.instances = [];
            FakeRos.autoConnect = true;
            jest.spyOn(
                RosBridgeService as unknown as { loadRoslib: () => Promise<unknown> },
                'loadRoslib',
            ).mockResolvedValue({ Ros: FakeRos });
        });

        afterEach(() => {
            jest.restoreAllMocks();
            getConnectionPool().clear();
        });

        it('opens a single websocket for sequential connects to the same rosbridge', async () => {
            const first = await RosBridgeService.connect(credentials);
            const second = await RosBridgeService.connect(credentials);

            expect(second).toBe(first);
            expect(FakeRos.instances).toHaveLength(1);
        });

        it('opens a single websocket for concurrent connects to the same rosbridge', async () => {
            const [first, second, third] = await Promise.all([
                RosBridgeService.connect(credentials),
                RosBridgeService.connect(credentials),
                RosBridgeService.connect(credentials),
            ]);

            expect(second).toBe(first);
            expect(third).toBe(first);
            expect(FakeRos.instances).toHaveLength(1);
        });

        it('opens separate websockets for different rosbridge servers', async () => {
            await RosBridgeService.connect(credentials);
            await RosBridgeService.connect({ ...credentials, port: 9091 });

            expect(FakeRos.instances).toHaveLength(2);
        });

        it('replaces a pooled connection that silently died', async () => {
            const first = (await RosBridgeService.connect(credentials)) as unknown as FakeRos;
            first.isConnected = false;

            const second = await RosBridgeService.connect(credentials);

            expect(second).not.toBe(first as unknown as Ros);
            expect(FakeRos.instances).toHaveLength(2);
        });

        it('evicts the pooled connection when the websocket closes', async () => {
            const first = (await RosBridgeService.connect(credentials)) as unknown as FakeRos;

            first.close();

            expect(getConnectionPool().size).toBe(0);
            const second = await RosBridgeService.connect(credentials);
            expect(second).not.toBe(first as unknown as Ros);
        });

        it('closes the socket when the connection attempt times out', async () => {
            jest.useFakeTimers();
            try {
                FakeRos.autoConnect = false;

                const promise = RosBridgeService.connect({ ...credentials, connectTimeoutMs: 1000 });
                const assertion = expect(promise).rejects.toThrow('timed out');
                await jest.advanceTimersByTimeAsync(1001);
                await assertion;

                expect(FakeRos.instances).toHaveLength(1);
                expect(FakeRos.instances[0].closeCalls).toBe(1);
            } finally {
                jest.useRealTimers();
            }
        });

        it('closes the socket when the connection attempt errors', async () => {
            FakeRos.autoConnect = false;

            const promise = RosBridgeService.connect(credentials);
            const assertion = expect(promise).rejects.toThrow('Could not connect');
            // Wait for connect() to have registered its error handler
            await new Promise((resolve) => setImmediate(resolve));
            FakeRos.instances[0].emit('error', { message: 'boom' });
            await assertion;

            expect(FakeRos.instances[0].closeCalls).toBe(1);
        });
    });

});
