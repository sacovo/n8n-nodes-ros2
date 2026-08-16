/**
 * RosBridgeService - Core business logic for ROS operations
 * This service is independent of n8n framework and can be easily tested
 */

import type { Ros, Topic } from 'roslib';

export type JsonRecord = Record<string, unknown>;

export interface RosBridgeCredentials {
    protocol: 'ws' | 'wss';
    host: string;
    port: number;
    path?: string;
    authToken?: string;
    authQueryParameter?: string;
    connectTimeoutMs?: number;
    /** When true the credential may only observe; see ReadOnlyGuard. */
    readOnly?: boolean;
}

class RosBridgeConnectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RosBridgeConnectionError';
    }
}

class RosBridgeTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RosBridgeTimeoutError';
    }
}

export class RosBridgeService {
    private static connectionPool = new Map<string, Ros>();
    private static pendingConnections = new Map<string, Promise<Ros>>();
    private static readonly PUBLISHER_TTL_MS = process.env.ROS_PUBLISHER_TTL_MS ? parseInt(process.env.ROS_PUBLISHER_TTL_MS, 10) : 300000;
    private static publisherCache = new Map<string, { topic: Topic; timer?: ReturnType<typeof setTimeout> }>();

    private static async sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private static loadRoslib() {
        // We use eval('import(...)') to prevent tsc from transpiling this to require(),
        // as roslib 2.x is an ESM-only package and doesn't support require().
        return (0, eval)('import("roslib")') as Promise<typeof import('roslib')>;
    }

    private static normalizePath(path?: string): string {
        if (!path) {
            return '';
        }
        if (path.startsWith('/')) {
            return path;
        }
        return `/${path}`;
    }

    private static safeJsonStringify(value: unknown): string {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    static buildRosbridgeUrl(credentials: RosBridgeCredentials): string {
        const protocol = credentials.protocol || 'ws';
        const path = this.normalizePath(credentials.path);
        const baseUrl = `${protocol}://${credentials.host}:${credentials.port}${path}`;

        if (!credentials.authToken) {
            return baseUrl;
        }

        const queryParam = credentials.authQueryParameter || 'token';
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}${encodeURIComponent(queryParam)}=${encodeURIComponent(
            credentials.authToken,
        )}`;
    }

    static async connect(credentials: RosBridgeCredentials): Promise<Ros> {
        const url = this.buildRosbridgeUrl(credentials);

        // Check if we have an active connection in the pool
        if (this.connectionPool.has(url)) {
            const pooledRos = this.connectionPool.get(url)!;
            // roslib's Ros exposes the public `isConnected` getter. Do NOT use
            // `(ros as any).socket.readyState` — the websocket lives on `ros.transport`,
            // so `ros.socket` is always undefined, which silently disabled pooling and
            // leaked a new connection on every node execution.
            if (pooledRos.isConnected) {
                return pooledRos;
            }
            this.connectionPool.delete(url);
        }

        // Deduplicate concurrent connects to the same URL. Without this,
        // parallel node executions each open their own websocket, only the
        // last one stays referenced in the pool and the rest leak — the same
        // failure mode as the `ros.socket.readyState` bug fixed earlier.
        const pending = this.pendingConnections.get(url);
        if (pending) {
            return pending;
        }

        const connectPromise = this.establishConnection(url, credentials.connectTimeoutMs ?? 5000)
            .finally(() => {
                this.pendingConnections.delete(url);
            });
        this.pendingConnections.set(url, connectPromise);
        return connectPromise;
    }

    private static async establishConnection(url: string, timeoutMs: number): Promise<Ros> {
        const { Ros } = await this.loadRoslib();
        const ros = new Ros({ url });
        ros.socketUrl = url;

        await new Promise<void>((resolve, reject) => {
            let settled = false;

            const abort = (error: Error) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                // Close the half-open socket so it cannot finish the handshake
                // later and linger as an unpooled, never-closed connection.
                try {
                    ros.close();
                } catch {
                    // Ignore errors from closing a socket that never opened
                }
                reject(error);
            };

            const timer = setTimeout(() => {
                abort(new RosBridgeTimeoutError(`Connection to rosbridge timed out after ${timeoutMs}ms (${url})`));
            }, timeoutMs);

            const onConnection = () => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve();
            };

            ros.once('connection', onConnection);
            ros.once('error', (event: unknown) => {
                abort(new RosBridgeConnectionError(`Could not connect to rosbridge: ${this.safeJsonStringify(event)}`));
            });
        });

        // Cache the connection and handle cleanup
        this.connectionPool.set(url, ros);
        ros.on('close', () => {
            this.connectionPool.delete(url);
            // Also clear topics associated with this connection
            for (const [key, cached] of this.publisherCache.entries()) {
                if (cached.topic.ros === ros) {
                    if (cached.timer) {
                        clearTimeout(cached.timer);
                    }
                    this.publisherCache.delete(key);
                }
            }
        });

        return ros;
    }

    static close(ros: Ros | null | undefined): void {
        void ros;
        // With connection pooling, we don't want to actually close the connection
        // on every node execution, as ROS 2 discovery takes time.
    }

    /**
     * Tears down every pooled connection. Node executions must not call this -
     * the pool deliberately outlives them - but a process that wants to exit
     * (the system tests, or a future n8n shutdown hook) needs a way to release
     * the sockets that otherwise keep the event loop alive.
     */
    static closeAll(): void {
        for (const [url, ros] of this.connectionPool.entries()) {
            try {
                ros.close();
            } catch {
                // Ignore errors from a socket that is already gone
            }
            this.connectionPool.delete(url);
        }
    }

    static async publishTopic(
        ros: Ros,
        topicName: string,
        messageType: string,
        message: JsonRecord,
        discoveryDelayMs?: number,
        burst?: {
            number: number;
            wait: number;
        },
    ): Promise<void> {
        const url = ros.socketUrl || 'default';
        const cacheKey = `${url}:${topicName}:${messageType}`;
        let cached = this.publisherCache.get(cacheKey);
        let isNew = false;
        let topic: Topic;

        const { Topic } = await this.loadRoslib();

        if (!cached || cached.topic.ros !== ros) {
            topic = new Topic({
                ros,
                name: topicName,
                messageType,
            });
            cached = { topic };
            this.publisherCache.set(cacheKey, cached);
            isNew = true;
        } else {
            topic = cached.topic;
            if (cached.timer) {
                clearTimeout(cached.timer);
                cached.timer = undefined;
            }
        }

        // Set expiration timer to unadvertise stale topics
        cached.timer = setTimeout(() => {
            try {
                topic.unadvertise();
            } catch {
                // Ignore error if connection is closed
            }
            this.publisherCache.delete(cacheKey);
        }, this.PUBLISHER_TTL_MS);

        if (isNew) {
            // Alert the network that we have a new publisher
            topic.advertise();
            // DDS Discovery Delay: Wait for subscribers to negotiate connection
            // before firing the first message. 750ms is usually enough.
            await this.sleep(discoveryDelayMs ?? 750);
        }

        if (burst) {
            const count = burst.number > 0 ? burst.number : 1;
            for (let j = 0; j < count; j++) {
                topic.publish(message);
                if (j < count - 1 && burst.wait > 0) {
                    await this.sleep(burst.wait);
                }
            }
        } else {
            topic.publish(message);
        }
    }

    static async advertiseTopic(ros: Ros, topicName: string, messageType: string): Promise<void> {
        const url = ros.socketUrl || 'default';
        const cacheKey = `${url}:${topicName}:${messageType}`;
        let cached = this.publisherCache.get(cacheKey);
        let topic: Topic;

        const { Topic } = await this.loadRoslib();

        if (!cached || cached.topic.ros !== ros) {
            topic = new Topic({
                ros,
                name: topicName,
                messageType,
            });
            topic.advertise();
            cached = { topic };
            this.publisherCache.set(cacheKey, cached);
        } else {
            topic = cached.topic;
            if (cached.timer) {
                clearTimeout(cached.timer);
                cached.timer = undefined;
            }
        }

        // Set expiration timer to unadvertise stale topics
        cached.timer = setTimeout(() => {
            try {
                topic.unadvertise();
            } catch {
                // Ignore error if connection is closed
            }
            this.publisherCache.delete(cacheKey);
        }, this.PUBLISHER_TTL_MS);
    }


    static async waitForTopicMessage(
        ros: Ros,
        topicName: string,
        messageType: string,
        timeoutMs: number,
        filterCallback?: (message: JsonRecord) => boolean,
    ): Promise<JsonRecord> {
        const { Topic } = await this.loadRoslib();
        const topic = new Topic({
            ros,
            name: topicName,
            messageType,
        });

        return new Promise<JsonRecord>((resolve, reject) => {
            const timer = setTimeout(() => {
                topic.unsubscribe(onMessage);
                reject(new RosBridgeTimeoutError(`No message on topic "${topicName}" received within ${timeoutMs}ms`));
            }, timeoutMs);

            const onMessage = (message: unknown) => {
                const msg = (message || {}) as JsonRecord;
                if (filterCallback && !filterCallback(msg)) {
                    return;
                }
                clearTimeout(timer);
                topic.unsubscribe(onMessage);
                resolve(msg);
            };

            topic.subscribe(onMessage);
        });
    }

    static async callService(
        ros: Ros,
        serviceName: string,
        serviceType: string,
        request: JsonRecord,
        timeoutMs: number,
    ): Promise<JsonRecord> {
        const { Service } = await this.loadRoslib();
        const service = new Service<JsonRecord, JsonRecord>({
            ros,
            name: serviceName,
            serviceType,
        });

        return new Promise<JsonRecord>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new RosBridgeTimeoutError(`Service call to "${serviceName}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            service.callService(
                request,
                (response) => {
                    clearTimeout(timer);
                    resolve((response || {}) as JsonRecord);
                },
                (error) => {
                    clearTimeout(timer);
                    reject(new Error(error));
                },
            );
        });
    }

    static async subscribeToTopic(
        ros: Ros,
        topicName: string,
        messageType: string,
        callback: (message: JsonRecord) => void,
    ): Promise<() => void> {
        const { Topic } = await this.loadRoslib();
        const topic = new Topic({
            ros,
            name: topicName,
            messageType,
        });

        const wrappedCallback = (message: unknown) => {
            callback(message as JsonRecord);
        };

        topic.subscribe(wrappedCallback);

        // Return unsubscribe function
        return () => {
            topic.unsubscribe(wrappedCallback);
        };
    }

    static async advertiseService(
        ros: Ros,
        serviceName: string,
        serviceType: string,
        callback: (request: JsonRecord, response: JsonRecord) => boolean,
    ): Promise<() => void> {
        const { Service } = await this.loadRoslib();
        const service = new Service({
            ros,
            name: serviceName,
            serviceType,
        });

        service.advertise((request: unknown, response: unknown) => {
            return callback(request as JsonRecord, response as JsonRecord);
        });

        return () => {
            service.unadvertise();
        };
    }

}

export { RosBridgeConnectionError, RosBridgeTimeoutError };
