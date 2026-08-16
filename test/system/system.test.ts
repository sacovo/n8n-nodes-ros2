/**
 * System tests: every ROS-facing node driven through its real `execute()` /
 * `trigger()` against a live rosbridge and a real ROS 2 fixture node running in
 * docker (see docker-compose.yml / fixture/).
 *
 * These exist because the unit tests mock the service layer, which is exactly
 * how the action nodes shipped speaking ROS 1 actionlib to a ROS 2 graph
 * without a single test failing. Anything asserted here has actually crossed
 * the wire.
 *
 * Run with `npm run test:system` (starts and stops the container for you).
 */

import type { INodeExecutionData, INodeType } from 'n8n-workflow';

import { RosApi } from '../../nodes/RosApi/RosApi.node';
import { RosAction } from '../../nodes/RosAction/RosAction.node';
import { RosActionRespond } from '../../nodes/RosActionRespond/RosActionRespond.node';
import { RosActionTrigger } from '../../nodes/RosActionTrigger/RosActionTrigger.node';
import { RosServiceCall } from '../../nodes/RosServiceCall/RosServiceCall.node';
import { RosServiceTrigger } from '../../nodes/RosServiceTrigger/RosServiceTrigger.node';
import { RosTopicCaptureImage } from '../../nodes/RosTopicCaptureImage/RosTopicCaptureImage.node';
import { RosTopicNextMessage } from '../../nodes/RosTopicNextMessage/RosTopicNextMessage.node';
import { RosTopicPublish } from '../../nodes/RosTopicPublish/RosTopicPublish.node';
import { RosTopicTrigger } from '../../nodes/RosTopicTrigger/RosTopicTrigger.node';
import { RosBridgeService } from '../../nodes/shared/services/RosBridgeService';
import {
    ROSBRIDGE_CREDENTIALS,
    createExecuteFunctions,
    createTriggerFunctions,
    id,
    type NodeParameters,
} from './harness';

jest.setTimeout(120000);

const FIXTURE_NODE = '/n8n_test_fixture';
const CHATTER = '/chatter';
const STRING_TYPE = 'std_msgs/msg/String';
const FIBONACCI = '/fibonacci';
const FIBONACCI_TYPE = 'example_interfaces/action/Fibonacci';
const ADD_TWO_INTS = '/add_two_ints';
const ADD_TWO_INTS_TYPE = 'example_interfaces/srv/AddTwoInts';

/** Runs a node's execute() with the given parameters and returns the JSON items. */
async function run(
    node: Pick<INodeType, 'execute' | 'description'>,
    params: NodeParameters,
): Promise<Array<Record<string, unknown>>> {
    const context = createExecuteFunctions(node, params);
    // execute()'s return type covers the newer engine-request shapes too; every
    // node here returns the classic INodeExecutionData[][].
    const result = (await node.execute!.call(context)) as INodeExecutionData[][];
    return (result?.[0] ?? []).map((item) => item.json as Record<string, unknown>);
}

/** Publishes a std_msgs/String, used to drive the fixture's client-side helpers. */
async function publishString(topic: string, data: string): Promise<void> {
    await run(new RosTopicPublish(), {
        operation: 'publish',
        topicName: id(topic),
        messageType: id(STRING_TYPE),
        messageInputMode: 'raw',
        messageJson: JSON.stringify({ data }),
        options: {},
    });
}

beforeAll(async () => {
    // Fail fast and clearly if the fixture container is not up.
    await RosBridgeService.connect(ROSBRIDGE_CREDENTIALS);
});

afterAll(() => {
    RosBridgeService.closeAll();
});

describe('ROS2 API node', () => {
    it('lists topics, services, actions and nodes from the live graph', async () => {
        const [topics] = await run(new RosApi(), {
            resource: 'topic',
            operation: 'list',
            grep: '',
            combineTopicsAndTypes: false,
        });
        expect(topics.topics).toEqual(expect.arrayContaining([CHATTER, '/commands']));

        const [services] = await run(new RosApi(), {
            resource: 'service',
            operation: 'list',
            grep: '',
        });
        expect(services.services).toEqual(expect.arrayContaining([ADD_TWO_INTS]));

        const [actions] = await run(new RosApi(), {
            resource: 'action',
            operation: 'list',
            grep: '',
        });
        expect(actions.actionServers).toEqual(expect.arrayContaining([FIBONACCI]));

        const [nodes] = await run(new RosApi(), {
            resource: 'node',
            operation: 'list',
            grep: '',
        });
        expect(nodes.nodes).toEqual(expect.arrayContaining([FIXTURE_NODE]));
    });

    it('resolves a topic type and its expanded definition', async () => {
        const [type] = await run(new RosApi(), {
            resource: 'topic',
            operation: 'getType',
            topicName: CHATTER,
            includeDescription: false,
            includeRawDefinition: false,
        });
        expect(type.topicType).toBe(STRING_TYPE);

        const [definition] = await run(new RosApi(), {
            resource: 'topic',
            operation: 'getDefinition',
            topicName: CHATTER,
            messageType: '',
        });
        expect(definition.definition).toEqual({ data: 'string' });
    });

    it('reads the latched <topic>/desc documentation convention', async () => {
        const [type] = await run(new RosApi(), {
            resource: 'topic',
            operation: 'getType',
            topicName: CHATTER,
            includeDescription: true,
            includeRawDefinition: false,
        });
        expect(type.description).toContain('n8n system test fixture');
    });

    it('resolves the action type and expands goal, result and feedback', async () => {
        const [type] = await run(new RosApi(), {
            resource: 'action',
            operation: 'getType',
            actionName: FIBONACCI,
        });
        expect(type.actionType).toBe(FIBONACCI_TYPE);

        const [definition] = await run(new RosApi(), {
            resource: 'action',
            operation: 'getDefinition',
            actionName: FIBONACCI,
        });
        expect(definition.goal).toEqual({ order: 'int32' });
        expect(definition.result).toEqual({ sequence: ['int32'] });
        expect(definition.feedback).toEqual({ sequence: ['int32'] });
    });

    it('expands a service definition', async () => {
        const [definition] = await run(new RosApi(), {
            resource: 'service',
            operation: 'getDefinition',
            serviceName: ADD_TWO_INTS,
        });
        expect(definition.request).toEqual({ a: 'int64', b: 'int64' });
        expect(definition.response).toEqual({ sum: 'int64' });
    });

    it('describes the fixture node, folding _action internals into one action entry', async () => {
        const [details] = await run(new RosApi(), {
            resource: 'node',
            operation: 'getDefinition',
            nodeName: FIXTURE_NODE,
        });

        const topics = (details.publishing as Array<{ name: string; type?: string }>).map(
            (topic) => topic.name,
        );
        expect(topics).toEqual(expect.arrayContaining([CHATTER, '/command_echo']));

        const subscribed = (details.subscribing as Array<{ name: string }>).map(
            (topic) => topic.name,
        );
        expect(subscribed).toEqual(expect.arrayContaining(['/commands']));

        const services = details.services as Array<{ name: string; type?: string }>;
        expect(services.map((service) => service.name)).toContain(ADD_TWO_INTS);
        // The `<action>/_action/*` services must not leak into the service list.
        expect(services.every((service) => !service.name.includes('/_action/'))).toBe(true);

        // Known limitation, asserted so it fails loudly if rosapi ever changes:
        // getNodeDefinition finds a node's actions by looking for an
        // `<action>/_action/send_goal` entry in its service list, but rosapi's
        // node_details is built from get_service_names_and_types_by_node(),
        // which omits *hidden* names - and every `_action/*` service and topic
        // is hidden. So the per-node action list is always empty here, even
        // though /fibonacci is plainly owned by this node and shows up fine in
        // the global action list above.
        expect(details.actions).toEqual([]);
    });
});

describe('ROS2 Topic nodes', () => {
    it('receives the next message on a live topic', async () => {
        const [message] = await run(new RosTopicNextMessage(), {
            topicName: id(CHATTER),
            messageType: id(STRING_TYPE),
            timeoutMs: 10000,
            conditions: {},
            options: {},
        });

        expect(message.message).toMatchObject({ data: expect.stringMatching(/^hello \d+$/) });
    });

    it('publishes a message the fixture receives and echoes back', async () => {
        // Subscribe first so the echo cannot arrive before we are listening.
        const echo = run(new RosTopicNextMessage(), {
            topicName: id('/command_echo'),
            messageType: id(STRING_TYPE),
            timeoutMs: 15000,
            conditions: {},
            options: {},
        });

        // Give the subscription a moment, then publish.
        await new Promise((resolve) => setTimeout(resolve, 500));
        await publishString('/commands', 'system-test');

        const [received] = await echo;
        expect(received.message).toMatchObject({ data: 'echo:system-test' });
    });

    it('captures an image as binary data', async () => {
        const captureImage = new RosTopicCaptureImage();
        const context = createExecuteFunctions(captureImage, {
            topicName: id('/camera/image_raw'),
            messageType: id('sensor_msgs/msg/CompressedImage'),
            timeoutMs: 15000,
            dataPropertyName: 'data',
            resize: false,
        });
        const result = (await captureImage.execute!.call(context)) as INodeExecutionData[][];

        expect(result[0][0].binary?.data).toBeDefined();
        expect(result[0][0].json).toMatchObject({ format: 'jpeg' });
    });

    it('triggers a workflow on each incoming message', async () => {
        const topicTrigger = new RosTopicTrigger();
        const harness = createTriggerFunctions(topicTrigger, {
            topicName: id(CHATTER),
            messageType: id(STRING_TYPE),
            includeMetadata: true,
            conditions: {},
            options: {},
        });

        const response = await topicTrigger.trigger!.call(harness.functions);
        try {
            const emitted = await harness.waitForEmit(2, 15000);
            expect(emitted[0]).toMatchObject({
                message: { data: expect.stringMatching(/^hello \d+$/) },
            });
        } finally {
            await response.closeFunction?.();
        }
    });
});

describe('ROS2 Service nodes', () => {
    it('calls a live service and returns its response', async () => {
        const [result] = await run(new RosServiceCall(), {
            serviceName: id(ADD_TWO_INTS),
            serviceType: id(ADD_TWO_INTS_TYPE),
            requestInputMode: 'raw',
            requestJson: JSON.stringify({ a: 7, b: 5 }),
            timeoutMs: 15000,
        });

        expect(result.response).toMatchObject({ sum: 12 });
    });

    it('advertises a service that the fixture can call', async () => {
        const serviceTrigger = new RosServiceTrigger();
        const harness = createTriggerFunctions(serviceTrigger, {
            serviceName: '/n8n_add',
            serviceType: ADD_TWO_INTS_TYPE,
            responseInputMode: 'raw',
            responseJson: JSON.stringify({ sum: 42 }),
        });

        const response = await serviceTrigger.trigger!.call(harness.functions);
        try {
            // Wait for the advertisement to reach the ROS graph, then have the
            // fixture call it and report back on /test/result.
            await new Promise((resolve) => setTimeout(resolve, 1500));

            const resultPromise = run(new RosTopicNextMessage(), {
                topicName: id('/test/result'),
                messageType: id(STRING_TYPE),
                timeoutMs: 30000,
                conditions: {},
                options: {},
            });
            await new Promise((resolve) => setTimeout(resolve, 500));
            await publishString('/test/command', 'call_service:/n8n_add');

            const [received] = await resultPromise;
            expect(received.message).toMatchObject({ data: 'service:42' });

            const emitted = await harness.waitForEmit(1, 5000);
            expect(emitted[0]).toMatchObject({ request: { a: 2, b: 3 } });
        } finally {
            await response.closeFunction?.();
        }
    });
});

describe('ROS2 Action node', () => {
    it('sends a goal, streams feedback and returns the result', async () => {
        const [result] = await run(new RosAction(), {
            operation: 'sendGoalAndWait',
            serverName: id(FIBONACCI),
            actionType: id(FIBONACCI_TYPE),
            goalInputMode: 'raw',
            goalJson: JSON.stringify({ order: 5 }),
            includeFeedback: true,
            timeoutMs: 30000,
        });

        expect(result).toMatchObject({
            status: 'SUCCEEDED',
            statusCode: 4,
            succeeded: true,
            result: { sequence: [0, 1, 1, 2, 3, 5] },
        });
        expect((result.feedback as unknown[]).length).toBeGreaterThan(0);
    });

    it('reports a rejected goal as data instead of throwing', async () => {
        // The fixture rejects a negative order.
        const [result] = await run(new RosAction(), {
            operation: 'sendGoalAndWait',
            serverName: id(FIBONACCI),
            actionType: id(FIBONACCI_TYPE),
            goalInputMode: 'raw',
            goalJson: JSON.stringify({ order: -1 }),
            includeFeedback: false,
            timeoutMs: 30000,
        });

        expect(result.succeeded).toBe(false);
        expect(result.error).toBeTruthy();
    });

    it('sends a goal without waiting, then cancels it', async () => {
        const [sent] = await run(new RosAction(), {
            operation: 'sendGoal',
            serverName: id(FIBONACCI),
            actionType: id(FIBONACCI_TYPE),
            goalInputMode: 'raw',
            goalJson: JSON.stringify({ order: 25 }),
            includeFeedback: false,
        });

        const goalHandle = sent.goalHandle as string;
        expect(goalHandle).toBeTruthy();

        // Let it start executing, then cancel and collect the outcome.
        await new Promise((resolve) => setTimeout(resolve, 1000));

        await run(new RosAction(), { operation: 'cancelGoal', goalHandle });

        const [outcome] = await run(new RosAction(), {
            operation: 'getResult',
            goalHandle,
            timeoutMs: 30000,
        });

        expect(outcome.status).toBe('CANCELED');
        expect(outcome.statusCode).toBe(5);
        expect(outcome.succeeded).toBe(false);
    });

    it('reads the status topic with ROS 2 goal_info nesting', async () => {
        const statusPromise = run(new RosAction(), {
            operation: 'watchStatus',
            serverName: id(FIBONACCI),
            goalId: '',
            watchTimeoutMs: 20000,
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
        const [sent] = await run(new RosAction(), {
            operation: 'sendGoal',
            serverName: id(FIBONACCI),
            actionType: id(FIBONACCI_TYPE),
            goalInputMode: 'raw',
            goalJson: JSON.stringify({ order: 6 }),
            includeFeedback: false,
        });

        const [status] = await statusPromise;
        const goals = status.goals as Array<{ goalId: string | null; status: string }>;

        expect(goals.length).toBeGreaterThan(0);
        // A real UUID, not the ROS 1 `goal_id.id` string that used to be read here.
        expect(goals[0].goalId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
        expect(['ACCEPTED', 'EXECUTING', 'SUCCEEDED']).toContain(goals[0].status);

        await run(new RosAction(), {
            operation: 'getResult',
            goalHandle: sent.goalHandle as string,
            timeoutMs: 30000,
        });
    });

    it('reads the feedback topic and decodes the goal UUID', async () => {
        const feedbackPromise = run(new RosAction(), {
            operation: 'watchFeedback',
            serverName: id(FIBONACCI),
            actionType: id(FIBONACCI_TYPE),
            goalId: '',
            watchTimeoutMs: 20000,
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
        const [sent] = await run(new RosAction(), {
            operation: 'sendGoal',
            serverName: id(FIBONACCI),
            actionType: id(FIBONACCI_TYPE),
            goalInputMode: 'raw',
            goalJson: JSON.stringify({ order: 6 }),
            includeFeedback: false,
        });

        const [feedback] = await feedbackPromise;
        expect(feedback.goalId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
        expect(feedback.feedback).toMatchObject({ sequence: expect.any(Array) });

        await run(new RosAction(), {
            operation: 'getResult',
            goalHandle: sent.goalHandle as string,
            timeoutMs: 30000,
        });
    });
});

describe('ROS2 Action Trigger and Respond', () => {
    it('advertises an action server that a real rclpy client can drive', async () => {
        const actionTrigger = new RosActionTrigger();
        const harness = createTriggerFunctions(actionTrigger, {
            serverName: '/n8n_fib',
            actionType: FIBONACCI_TYPE,
            emitCancelRequests: true,
        });

        const response = await actionTrigger.trigger!.call(harness.functions);
        try {
            // Let the advertisement propagate, then have the fixture send a goal.
            await new Promise((resolve) => setTimeout(resolve, 1500));

            const resultPromise = run(new RosTopicNextMessage(), {
                topicName: id('/test/result'),
                messageType: id(STRING_TYPE),
                timeoutMs: 30000,
                conditions: {},
                options: {},
            });
            await new Promise((resolve) => setTimeout(resolve, 500));
            await publishString('/test/command', 'send_goal:/n8n_fib:4');

            // The trigger emits the goal; respond with feedback then the result.
            const emitted = await harness.waitForEmit(1, 20000);
            expect(emitted[0]).toMatchObject({
                eventType: 'goal',
                goal: { order: 4 },
                serverName: '/n8n_fib',
            });

            const goalId = emitted[0].goalId as string;

            await run(new RosActionRespond(), {
                goalId,
                operation: 'sendFeedback',
                payloadJson: JSON.stringify({ sequence: [0, 1] }),
            });

            await run(new RosActionRespond(), {
                goalId,
                operation: 'setSucceeded',
                payloadJson: JSON.stringify({ sequence: [0, 1, 1, 2] }),
            });

            const [received] = await resultPromise;
            expect(received.message).toMatchObject({ data: 'action:0,1,1,2' });
        } finally {
            await response.closeFunction?.();
        }
    });
});
