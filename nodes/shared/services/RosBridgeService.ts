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

    private static goalRegistry = new Map<string, any>();

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

        // We create a dummy goal object just to use its result listener, 
        // but we need to associate it with the existing goalId.
        // roslib's Goal doesn't easily allow attaching to an existing ID for result listening 
        // without sending it, so we might need to use the service directly or 
        // hack the Goal object.
        
        // Alternative: Use the service directly /_action/get_result
        // The result service type is usually {action_type}_GetResult
        // But rosbridge often handles the mapping.
        
        return new Promise<JsonRecord>((resolve, reject) => {
            const timer = setTimeout(() => {
                actionClient.dispose();
                reject(new RosBridgeTimeoutError(`Timeout waiting for result of goal "${goalId}" on "${serverName}"`));
            }, timeoutMs);

            // Standard roslib ActionClient approach:
            const goal = new Goal({
                actionClient,
                goalMessage: {},
            });
            // Override the generated ID
            (goal as any).goalID = { id: goalId };

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
        (goal as any).goalID = { id: goalId };

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

        const onGoal = (goalMessage: any) => {
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
        (goal as any).goalID = { id: goalId };

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
        const goalWithId = goal as unknown as { goalID?: { id?: string } };
        return goalWithId.goalID?.id || `goal-${Date.now()}`;
    }
}

export { RosBridgeConnectionError, RosBridgeTimeoutError };
