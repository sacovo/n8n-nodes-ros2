/**
 * RosBridgeService - Core business logic for ROS operations
 * This service is independent of n8n framework and can be easily tested
 */

import type { ActionClient, Goal, Ros } from 'roslib';

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
        const { Ros } = await this.loadRoslib();
        const url = this.buildRosbridgeUrl(credentials);
        const ros = new Ros({ url });
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

        return ros;
    }

    static close(ros: Ros | null | undefined): void {
        if (!ros) {
            return;
        }
        try {
            ros.close();
        } catch {
            // Ignore close errors to keep node cleanup safe.
        }
    }

    static async publishTopic(ros: Ros, topicName: string, messageType: string, message: JsonRecord): Promise<void> {
        const { Topic } = await this.loadRoslib();
        const topic = new Topic({
            ros,
            name: topicName,
            messageType,
        });
        topic.publish(message);
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

    private static extractGoalId(goal: Goal<JsonRecord>): string {
        const goalWithId = goal as unknown as { goalID?: { id?: string } };
        return goalWithId.goalID?.id || `goal-${Date.now()}`;
    }
}

export { RosBridgeConnectionError, RosBridgeTimeoutError };
