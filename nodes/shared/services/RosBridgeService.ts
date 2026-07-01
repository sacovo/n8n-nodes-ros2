/**
 * RosBridgeService - Core business logic for ROS operations
 * This service is independent of n8n framework and can be easily tested
 */

import type { ActionClient, Goal, Ros, SimpleActionServer, Topic } from 'roslib';

export type JsonRecord = Record<string, unknown>;

export interface RosBridgeCredentials {
    protocol: 'ws' | 'wss';
    host: string;
    port: number;
    path?: string;
    authToken?: string;
    authQueryParameter?: string;
    connectTimeoutMs?: number;
}

export interface ActionStartResult {
    goalId: string;
    status?: JsonRecord;
}

export interface ActionStatusSnapshot {
    goalId: string;
    statusCode: number;
    status: string;
    text?: string;
    raw: JsonRecord;
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
    private static readonly ACTION_STATUS_LABELS: Record<number, string> = {
        0: 'PENDING',
        1: 'ACTIVE',
        2: 'PREEMPTED',
        3: 'SUCCEEDED',
        4: 'ABORTED',
        5: 'REJECTED',
        6: 'PREEMPTING',
        7: 'RECALLING',
        8: 'RECALLED',
        9: 'LOST',
    };

    private static goalRegistry = new Map<string, SimpleActionServer>();
    private static connectionPool = new Map<string, Ros>();
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

        const { Ros } = await this.loadRoslib();
        const ros = new Ros({ url });
        ros.socketUrl = url;
        const timeoutMs = credentials.connectTimeoutMs ?? 5000;

        await new Promise<void>((resolve, reject) => {
            let settled = false;

            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                reject(
                    new RosBridgeTimeoutError(
                        `Connection to rosbridge timed out after ${timeoutMs}ms (${url})`,
                    ),
                );
            }, timeoutMs);

            const onConnection = () => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve();
            };

            const onError = (event: unknown) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                reject(new RosBridgeConnectionError(`Could not connect to rosbridge: ${this.safeJsonStringify(event)}`));
            };

            ros.once('connection', onConnection);
            ros.once('error', onError);
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

    static async publishTopic(ros: Ros, topicName: string, messageType: string, message: JsonRecord): Promise<void> {
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
            topic.advertise();
            await this.sleep(750);
        }

        topic.publish(message);
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

    static async startAction(
        ros: Ros,
        serverName: string,
        actionName: string,
        goalPayload: JsonRecord,
        sendTimeoutMs: number,
    ): Promise<ActionStartResult> {
        const { ActionClient, Goal } = await this.loadRoslib();

        const actionClient = new ActionClient({
            ros,
            serverName,
            actionName,
        }) as ActionClient<JsonRecord, unknown, unknown>;

        const goal = new Goal<JsonRecord>({
            actionClient,
            goalMessage: goalPayload,
        });

        return new Promise<ActionStartResult>((resolve) => {
            let settled = false;

            const finalize = (status?: JsonRecord) => {
                if (settled) {
                    return;
                }
                settled = true;
                const goalId = this.extractGoalId(goal);
                actionClient.dispose();
                resolve({ goalId, status });
            };

            const timer = setTimeout(() => {
                finalize();
            }, sendTimeoutMs);

            goal.on('status', (event: unknown) => {
                clearTimeout(timer);
                finalize((event || {}) as JsonRecord);
            });

            goal.send(sendTimeoutMs);
        });
    }

    static async getActionStatusByTopic(
        ros: Ros,
        statusTopicName: string,
        statusMessageType: string,
        goalId: string,
        timeoutMs: number,
    ): Promise<ActionStatusSnapshot> {
        const statusMessage = await this.waitForTopicMessage(
            ros,
            statusTopicName,
            statusMessageType,
            timeoutMs,
        );
        const statusList = Array.isArray(statusMessage.status_list)
            ? (statusMessage.status_list as Array<Record<string, unknown>>)
            : [];

        const match = statusList.find((entry) => {
            const nestedGoal = entry.goal_id as Record<string, unknown> | undefined;
            return nestedGoal?.id === goalId;
        });

        if (!match) {
            return {
                goalId,
                statusCode: -1,
                status: 'UNKNOWN',
                text: 'Goal not present in latest status message',
                raw: statusMessage,
            };
        }

        const statusCode = Number(match.status ?? -1);
        const text = typeof match.text === 'string' ? match.text : undefined;

        return {
            goalId,
            statusCode,
            status: this.ACTION_STATUS_LABELS[statusCode] ?? 'UNKNOWN',
            text,
            raw: statusMessage,
        };
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

    static async getActionResult(
        ros: Ros,
        serverName: string,
        actionName: string,
        goalId: string,
        timeoutMs: number,
    ): Promise<JsonRecord> {
        const { ActionClient, Goal } = await this.loadRoslib();

        const actionClient = new ActionClient({
            ros,
            serverName,
            actionName,
        }) as ActionClient<JsonRecord, unknown, unknown>;

        return new Promise<JsonRecord>((resolve, reject) => {
            const timer = setTimeout(() => {
                actionClient.dispose();
                reject(new RosBridgeTimeoutError(`Timeout waiting for result of goal "${goalId}" on "${serverName}"`));
            }, timeoutMs);

            // We create a dummy goal object just to use its result listener,
            // then re-key it onto the existing goalId (see attachExistingGoalId).
            const goal = new Goal({
                actionClient,
                goalMessage: {},
            });
            this.attachExistingGoalId(actionClient, goal, goalId);

            goal.on('result', (result) => {
                clearTimeout(timer);
                actionClient.dispose();
                resolve(result as JsonRecord);
            });

            goal.on('timeout', () => {
                clearTimeout(timer);
                actionClient.dispose();
                reject(new RosBridgeTimeoutError(`roslib timeout waiting for result of goal "${goalId}"`));
            });
        });
    }

    static async cancelAction(
        ros: Ros,
        serverName: string,
        actionName: string,
        goalId: string,
    ): Promise<JsonRecord> {
        const { ActionClient, Goal } = await this.loadRoslib();

        const actionClient = new ActionClient({
            ros,
            serverName,
            actionName,
        }) as ActionClient<JsonRecord, unknown, unknown>;

        const goal = new Goal({
            actionClient,
            goalMessage: {},
        });
        this.attachExistingGoalId(actionClient, goal, goalId);

        return new Promise<JsonRecord>((resolve, reject) => {
            try {
                // roslib's cancel() doesn't return a promise or have a specific 'canceled' event on the goal.
                // It sends the cancel request via service.
                goal.cancel();
                actionClient.dispose();
                resolve({ status: 'cancel_request_sent', goalId });
            } catch (error) {
                actionClient.dispose();
                reject(error);
            }
        });
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

    static async registerActionServer(
        ros: Ros,
        serverName: string,
        actionName: string,
        callback: (goalMessage: JsonRecord, goalId: string) => void,
    ): Promise<() => void> {
        const { SimpleActionServer } = await this.loadRoslib();
        const server = new SimpleActionServer({
            ros,
            serverName,
            actionName,
        });

        const onGoal = (goalMessage: unknown) => {
            const goalId = server.currentGoal?.goal_id?.id || `goal-${Date.now()}`;
            this.goalRegistry.set(goalId, server);
            callback(goalMessage as JsonRecord, goalId);
        };

        server.on('goal', onGoal);

        return () => {
            server.removeAllListeners('goal');
        };
    }

    static sendActionFeedback(goalId: string, feedback: JsonRecord): void {
        const server = this.goalRegistry.get(goalId);
        if (!server) {
            throw new Error(`No active action goal found for ID "${goalId}"`);
        }
        server.sendFeedback(feedback);
    }

    static setActionSucceeded(goalId: string, result: JsonRecord): void {
        const server = this.goalRegistry.get(goalId);
        if (!server) {
            throw new Error(`No active action goal found for ID "${goalId}"`);
        }
        server.setSucceeded(result);
        this.goalRegistry.delete(goalId);
    }

    static setActionAborted(goalId: string, result: JsonRecord): void {
        const server = this.goalRegistry.get(goalId);
        if (!server) {
            throw new Error(`No active action goal found for ID "${goalId}"`);
        }
        server.setAborted(result);
        this.goalRegistry.delete(goalId);
    }

    static async waitForActionFeedback(
        ros: Ros,
        serverName: string,
        actionName: string,
        goalId: string,
        timeoutMs: number,
    ): Promise<JsonRecord> {
        const { ActionClient, Goal } = await this.loadRoslib();

        const actionClient = new ActionClient({
            ros,
            serverName,
            actionName,
        }) as ActionClient<JsonRecord, unknown, unknown>;

        const goal = new Goal({
            actionClient,
            goalMessage: {},
        });
        this.attachExistingGoalId(actionClient, goal, goalId);

        return new Promise<JsonRecord>((resolve, reject) => {
            const timer = setTimeout(() => {
                actionClient.dispose();
                reject(new RosBridgeTimeoutError(`Timeout waiting for feedback of goal "${goalId}" on "${serverName}"`));
            }, timeoutMs);

            goal.on('feedback', (feedback) => {
                clearTimeout(timer);
                actionClient.dispose();
                resolve(feedback as JsonRecord);
            });
        });
    }

    private static extractGoalId(goal: Goal<JsonRecord>): string {
        return goal.goalID || `goal-${Date.now()}`;
    }

    /**
     * Re-keys a freshly constructed dummy Goal so it represents an existing
     * goal (identified by goalId) instead of the goal roslib auto-generated
     * at construction time. Needed because Goal's constructor bakes its
     * random goalID into goalMessage.goal_id.id and actionClient.goals[]
     * before we get a chance to override it.
     */
    private static attachExistingGoalId(
        actionClient: ActionClient<JsonRecord, unknown, unknown>,
        goal: Goal<JsonRecord>,
        goalId: string,
    ): void {
        delete actionClient.goals[goal.goalID];
        goal.goalID = goalId;
        goal.goalMessage.goal_id.id = goalId;
        actionClient.goals[goalId] = goal;
    }
}

export { RosBridgeConnectionError, RosBridgeTimeoutError };
