import type { ActionClient, Goal, Ros, Topic, rosapi } from 'roslib';
import type { FieldType, INodePropertyOptions, ResourceMapperFields, INodeExecutionData } from 'n8n-workflow';
import get from 'lodash/get';

export type JsonRecord = Record<string, unknown>;

export interface RosBridgeCredentialsData {
    protocol: 'ws' | 'wss';
    host: string;
    port: number;
    path?: string;
    authToken?: string;
    authQueryParameter?: string;
    connectTimeoutMs?: number;
}

export interface ActionStatusSnapshot {
    goalId: string;
    statusCode: number;
    status: string;
    text?: string;
    raw: JsonRecord;
}

const ACTION_STATUS_LABELS: Record<number, string> = {
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

const PUBLISHER_TTL_MS = process.env.ROS_PUBLISHER_TTL_MS ? parseInt(process.env.ROS_PUBLISHER_TTL_MS, 10) : 300000;

// Publisher and Connection Cache to handle ROS 2 discovery delays and rosbridge QoS issues
const rosConnections = new Map<string, Ros>();
const publisherCache = new Map<string, { topic: Topic; timer?: ReturnType<typeof setTimeout> }>();

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePath(path?: string): string {
    if (!path) {
        return '';
    }

    if (path.startsWith('/')) {
        return path;
    }

    return `/${path}`;
}

export function buildRosbridgeUrl(credentials: RosBridgeCredentialsData): string {
    const protocol = credentials.protocol || 'ws';
    const path = normalizePath(credentials.path);
    const baseUrl = `${protocol}://${credentials.host}:${credentials.port}${path}`;

    if (!credentials.authToken) {
        return baseUrl;
    }

    const queryParam = credentials.authQueryParameter || 'token';
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}${encodeURIComponent(queryParam)}=${encodeURIComponent(credentials.authToken)}`;
}

async function loadRoslib() {
    // We use eval('import(...)') to prevent tsc from transpiling this to require(),
    // as roslib 2.x is an ESM-only package and doesn't support require().
    return (0, eval)('import("roslib")') as Promise<typeof import('roslib')>;
}

export async function connectRos(credentials: RosBridgeCredentialsData): Promise<Ros> {
    const url = buildRosbridgeUrl(credentials);

    // Check if we have an active connection in the pool
    if (rosConnections.has(url)) {
        const pooledRos = rosConnections.get(url)!;
        if (pooledRos.isConnected) {
            return pooledRos;
        }
        rosConnections.delete(url);
    }

    const { Ros } = await loadRoslib();
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
            reject(new Error(`Connection to rosbridge timed out after ${timeoutMs}ms (${url})`));
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
            reject(new Error(`Could not connect to rosbridge: ${safeJsonStringify(event)}`));
        };

        ros.once('connection', onConnection);
        ros.once('error', onError);
    });

    // Cache the connection and handle cleanup
    rosConnections.set(url, ros);
    ros.on('close', () => {
        rosConnections.delete(url);
        // Also clear topics associated with this connection
        for (const [key, cached] of publisherCache.entries()) {
            if (cached.topic.ros === ros) {
                if (cached.timer) {
                    clearTimeout(cached.timer);
                }
                publisherCache.delete(key);
            }
        }
    });

    return ros;
}

export function closeRos(ros: Ros): void {
    void ros;
    // With connection pooling, we don't want to actually close the connection
    // on every node execution, as ROS 2 discovery takes time.
    // The connection will stay open until the process ends or the server closes it.
}

export function parseJsonPayload(input: string, parameterName: string): JsonRecord {
    if (!input.trim()) {
        return {};
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(input);
    } catch (error) {
        throw new Error(`Invalid JSON in parameter "${parameterName}": ${(error as Error).message}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Parameter "${parameterName}" must be a JSON object`);
    }

    return parsed as JsonRecord;
}

export async function createTopic(
    ros: Ros,
    topicName: string,
    messageType: string,
): Promise<Topic> {
    const { Topic } = await loadRoslib();
    return new Topic({
        ros,
        name: topicName,
        messageType,
    });
}

export async function publishRosTopic(
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
    let cached = publisherCache.get(cacheKey);
    let isNew = false;
    let topic: Topic;

    // We reuse the topic if it exists and belongs to the same connection
    if (!cached || cached.topic.ros !== ros) {
        topic = await createTopic(ros, topicName, messageType);
        cached = { topic };
        publisherCache.set(cacheKey, cached);
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
        publisherCache.delete(cacheKey);
    }, PUBLISHER_TTL_MS);

    if (isNew) {
        // Alert the network that we have a new publisher
        topic.advertise();
        // DDS Discovery Delay: Wait for subscribers to negotiate connection
        // before firing the first message. 750ms is usually enough.
        await sleep(discoveryDelayMs ?? 750);
    }

    if (burst) {
        const count = burst.number > 0 ? burst.number : 1;
        for (let j = 0; j < count; j++) {
            topic.publish(message);
            if (j < count - 1 && burst.wait > 0) {
                await sleep(burst.wait);
            }
        }
    } else {
        topic.publish(message);
    }
}

export async function advertiseRosTopic(
    ros: Ros,
    topicName: string,
    messageType: string,
): Promise<void> {
    const url = ros.socketUrl || 'default';
    const cacheKey = `${url}:${topicName}:${messageType}`;
    let cached = publisherCache.get(cacheKey);

    if (!cached || cached.topic.ros !== ros) {
        const topic = await createTopic(ros, topicName, messageType);
        topic.advertise();
        cached = { topic };
        publisherCache.set(cacheKey, cached);
    } else {
        if (cached.timer) {
            clearTimeout(cached.timer);
            cached.timer = undefined;
        }
    }

    // Set expiration timer to unadvertise stale topics
    cached.timer = setTimeout(() => {
        try {
            cached.topic.unadvertise();
        } catch {
            // Ignore error
        }
        publisherCache.delete(cacheKey);
    }, PUBLISHER_TTL_MS);
}


export async function waitForNextTopicMessage(
    ros: Ros,
    topicName: string,
    messageType: string,
    timeoutMs: number,
    filterCallback?: (message: JsonRecord) => boolean,
): Promise<JsonRecord> {
    const topic = await createTopic(ros, topicName, messageType);

    return new Promise<JsonRecord>((resolve, reject) => {
        const timer = setTimeout(() => {
            topic.unsubscribe(onMessage);
            reject(new Error(`No message on topic "${topicName}" received within ${timeoutMs}ms`));
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

export async function callRosService(
    ros: Ros,
    serviceName: string,
    serviceType: string,
    request: JsonRecord,
    timeoutMs: number,
): Promise<JsonRecord> {
    const { Service } = await loadRoslib();
    const service = new Service<JsonRecord, JsonRecord>({
        ros,
        name: serviceName,
        serviceType,
    });

    return new Promise<JsonRecord>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Service call to "${serviceName}" timed out after ${timeoutMs}ms`));
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

export async function startRosAction(
    ros: Ros,
    serverName: string,
    actionName: string,
    goalPayload: JsonRecord,
    sendTimeoutMs: number,
): Promise<{ goalId: string; status?: JsonRecord }> {
    const { ActionClient, Goal } = await loadRoslib();

    const actionClient = new ActionClient({
        ros,
        serverName,
        actionName,
    }) as ActionClient<JsonRecord, unknown, unknown>;

    const goal = new Goal<JsonRecord>({
        actionClient,
        goalMessage: goalPayload,
    });
    return new Promise<{ goalId: string; status?: JsonRecord }>((resolve) => {
        let settled = false;

        const finalize = (status?: JsonRecord) => {
            if (settled) {
                return;
            }
            settled = true;
            const goalId = extractGoalId(goal);
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

export async function getActionStatusByTopic(
    ros: Ros,
    statusTopicName: string,
    statusMessageType: string,
    goalId: string,
    timeoutMs: number,
): Promise<ActionStatusSnapshot> {
    const statusMessage = await waitForNextTopicMessage(ros, statusTopicName, statusMessageType, timeoutMs);
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
        status: ACTION_STATUS_LABELS[statusCode] ?? 'UNKNOWN',
        text,
        raw: statusMessage,
    };
}

function extractGoalId(goal: Goal<JsonRecord>): string {
    const goalWithId = goal as unknown as { goalID?: { id?: string } };
    return goalWithId.goalID?.id || `goal-${Date.now()}`;
}

function safeJsonStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

// ROS API helper functions

export async function getRosTopics(ros: Ros): Promise<rosapi.TopicsResponse> {
    return new Promise<rosapi.TopicsResponse>((resolve, reject) => {
        ros.getTopics(
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosNodes(ros: Ros): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        ros.getNodes(
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosNodeDetails(ros: Ros, node: string): Promise<rosapi.NodeDetailsResponse> {
    return new Promise<rosapi.NodeDetailsResponse>((resolve, reject) => {
        ros.getNodeDetails(
            node,
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosServices(ros: Ros): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        ros.getServices(
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosActionServers(ros: Ros): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        ros.getActionServers(
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosTopicsForType(ros: Ros, topicType: string): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        ros.getTopicsForType(
            topicType,
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosServicesForType(ros: Ros, serviceType: string): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        ros.getServicesForType(
            serviceType,
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosTopicType(ros: Ros, topic: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        ros.getTopicType(
            topic,
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosServiceType(ros: Ros, service: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        ros.getServiceType(
            service,
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosMessageDetails(ros: Ros, message: string): Promise<rosapi.TypeDef[]> {
    return new Promise<rosapi.TypeDef[]>((resolve, reject) => {
        ros.getMessageDetails(
            message,
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosTopicsAndRawTypes(ros: Ros): Promise<rosapi.TopicsAndRawTypesResponse> {
    return new Promise<rosapi.TopicsAndRawTypesResponse>((resolve, reject) => {
        ros.getTopicsAndRawTypes(
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosParams(ros: Ros): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        ros.getParams(
            (result) => resolve(result),
            (error) => reject(new Error(error)),
        );
    });
}

export async function getRosParam(ros: Ros, name: string): Promise<unknown> {
    const { Param } = await loadRoslib();
    const param = new Param({ ros, name });
    return new Promise((resolve) => {
        param.get((value) => resolve(value));
    });
}

export async function setRosParam(ros: Ros, name: string, value: unknown): Promise<void> {
    const { Param } = await loadRoslib();
    const param = new Param({ ros, name });
    return new Promise((resolve) => {
        param.set(value, () => resolve());
    });
}

// UI Helper functions for n8n resource elements

/**
 * Maps ROS message field types to n8n ResourceMapper field types
 */
export function mapRosTypeToN8nFieldType(rosType: string): FieldType {
    const normalizedType = rosType.trim().toLowerCase();

    if (normalizedType.endsWith('[]')) {
        return 'array';
    }

    const typeMap: Record<string, FieldType> = {
        // Primitive types
        bool: 'boolean',
        boolean: 'boolean',
        int8: 'number',
        uint8: 'number',
        int16: 'number',
        uint16: 'number',
        int32: 'number',
        uint32: 'number',
        int64: 'number',
        uint64: 'number',
        float32: 'number',
        float64: 'number',
        float: 'number',
        double: 'number',
        byte: 'number',
        char: 'number',
        string: 'string',
        time: 'string',
        duration: 'string',
        // Common geometry types
        'geometry_msgs/point': 'object',
        'geometry_msgs/quaternion': 'object',
        'geometry_msgs/twist': 'object',
        'geometry_msgs/pose': 'object',
        'sensor_msgs/jointstate': 'object',
    };

    if (typeMap[normalizedType]) {
        return typeMap[normalizedType];
    }

    // Fallback for types containing numeric keywords
    if (
        normalizedType.includes('int') ||
        normalizedType.includes('float') ||
        normalizedType.includes('double') ||
        normalizedType === 'byte'
    ) {
        return 'number';
    }

    return 'object';
}

/**
 * Formats topic list from getRosTopics into n8n dropdown options
 */
export function formatTopicListForN8n(topics: string[], filter?: string): INodePropertyOptions[] {
    return topics
        .filter((topic) => topic && typeof topic === 'string')
        .filter((topic) => !filter || topic.toLowerCase().includes(filter.toLowerCase()))
        .map((topic) => ({
            name: topic,
            value: topic,
        }));
}

/**
 * Formats service list from getRosServices into n8n dropdown options
 */
export function formatServiceListForN8n(services: string[], filter?: string): INodePropertyOptions[] {
    return services
        .filter((service) => service && typeof service === 'string')
        .filter((service) => !filter || service.toLowerCase().includes(filter.toLowerCase()))
        .map((service) => ({
            name: service,
            value: service,
        }));
}

/**
 * Converts ROS message TypeDef array to n8n ResourceMapperFields
 * Performs shallow expansion (1 level deep) for nested types
 */
export function getRosMessageStructure(typeDefs: rosapi.TypeDef[] | undefined): ResourceMapperFields {
    if (!typeDefs || typeDefs.length === 0) {
        return { fields: [] };
    }

    const mainType = typeDefs[0];
    if (!mainType || !mainType.fieldnames || !mainType.fieldtypes) {
        return { fields: [] };
    }

    const fields = mainType.fieldnames.map((fieldname, index) => {
        let fieldtype = (mainType.fieldtypes[index] || 'unknown').trim();
        const arrayLen = mainType.fieldarraylen?.[index] ?? -1;

        if (arrayLen !== -1 && !fieldtype.endsWith('[]')) {
            fieldtype += '[]';
        }

        const n8nType = mapRosTypeToN8nFieldType(fieldtype);

        return {
            id: fieldname,
            displayName: fieldname,
            type: n8nType,
            required: false,
            description: `ROS message field of type ${fieldtype}`,
            canBeUsedToMatch: false,
            defaultMatch: false,
            display: true,
        };
    });

    return { fields };
}

type Condition = {
    leftValue: null | string;
    rightValue: null | string;
    operator: {
        operation: string;
        type: string;
    };
};

type FilterData = {
    options: {
        caseSensitive: boolean;
    },
    conditions: Condition[];
    combinator: string;
};

export function checkFilter(item: INodeExecutionData, filterData: FilterData): boolean {
    if (!filterData?.conditions?.length) {
        return true;
    }
    const { conditions: conds, combinator } = filterData;

    const pass = conds.map((c) => {
        if (c.leftValue === null && c.rightValue === null) {
            return true; // Both null means condition is empty
        }
        let leftValue = c.leftValue;
        if (typeof leftValue === 'string') {
            leftValue = get(item.json["message"], leftValue);
        }

        const rightValue = c.rightValue;
        const op = c.operator.operation;
        const type = c.operator.type;

        if (op === 'exists') return leftValue !== undefined && leftValue !== null;
        if (op === 'notExists') return leftValue === undefined || leftValue === null;

        if (type === 'string') {
            const left = String(leftValue || '');
            const right = String(rightValue || '');
            const ignoreCase = !filterData.options.caseSensitive;
            const l = ignoreCase ? left.toLowerCase() : left;
            const r = ignoreCase ? right.toLowerCase() : right;

            if (op === 'equals') return l === r;
            if (op === 'notEquals') return l !== r;
            if (op === 'contains') return l.includes(r);
            if (op === 'notContains') return !l.includes(r);
            if (op === 'startsWith') return l.startsWith(r);
            if (op === 'endsWith') return l.endsWith(r);

            // String length operations
            const rVal = Number(rightValue);
            if (op === 'lengthEquals') return left.length === rVal;
            if (op === 'lengthNotEquals') return left.length !== rVal;
            if (op === 'lengthGt') return left.length > rVal;
            if (op === 'lengthLt') return left.length < rVal;
            if (op === 'lengthGte') return left.length >= rVal;
            if (op === 'lengthLte') return left.length <= rVal;
        }

        if (type === 'number') {
            const left = Number(leftValue);
            const right = Number(rightValue);
            if (op === 'equals') return left === right;
            if (op === 'gt') return left > right;
            if (op === 'lt') return left < right;
            if (op === 'gte') return left >= right;
            if (op === 'lte') return left <= right;
        }

        if (type === 'array') {
            const left = Array.isArray(leftValue) ? leftValue : [];
            const rVal = Number(rightValue);
            if (op === 'lengthEquals') return left.length === rVal;
            if (op === 'lengthNotEquals') return left.length !== rVal;
            if (op === 'lengthGt') return left.length > rVal;
            if (op === 'lengthLt') return left.length < rVal;
            if (op === 'lengthGte') return left.length >= rVal;
            if (op === 'lengthLte') return left.length <= rVal;
        }

        if (type === 'boolean') {
            const left = Boolean(leftValue);
            if (op === 'true') return left === true;
            if (op === 'false') return left === false;
            if (op === 'equals') return left === Boolean(rightValue);
        }

        return false;
    });

    return combinator === 'or' ? pass.some(Boolean) : pass.every(Boolean);
}
