/**
 * Unit tests for RosApiService.getNodeDefinition
 */

import { RosApiService } from '../services/RosApiService';
import { RosBridgeService } from '../services/RosBridgeService';
import type { Ros, rosapi } from 'roslib';

type SuccessCallback<T> = (result: T) => void;
type ErrorCallback = (error: string) => void;

describe('RosApiService.getInterfaceDescription', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    function buildRosWithTopics(topics: string[]): Ros {
        return {
            getTopics: jest.fn((cb: (result: rosapi.TopicsResponse) => void) =>
                cb({ topics, types: topics.map(() => 'std_msgs/msg/String') }),
            ),
        } as unknown as Ros;
    }

    it('reads the latched /desc topic when it exists', async () => {
        const ros = buildRosWithTopics(['/cmd_vel', '/cmd_vel/desc']);
        const waitSpy = jest
            .spyOn(RosBridgeService, 'waitForTopicMessage')
            .mockResolvedValue({ data: 'Drive command for the rover base, m/s and rad/s' });

        const description = await RosApiService.getInterfaceDescription(ros, '/cmd_vel');

        expect(description).toBe('Drive command for the rover base, m/s and rad/s');
        expect(waitSpy).toHaveBeenCalledWith(ros, '/cmd_vel/desc', 'std_msgs/msg/String', 2000);
    });

    it('returns null without subscribing when no /desc topic exists', async () => {
        const ros = buildRosWithTopics(['/cmd_vel']);
        const waitSpy = jest.spyOn(RosBridgeService, 'waitForTopicMessage');

        const description = await RosApiService.getInterfaceDescription(ros, '/cmd_vel');

        expect(description).toBeNull();
        expect(waitSpy).not.toHaveBeenCalled();
    });

    it('returns null when the /desc subscription times out', async () => {
        const ros = buildRosWithTopics(['/cmd_vel', '/cmd_vel/desc']);
        jest.spyOn(RosBridgeService, 'waitForTopicMessage').mockRejectedValue(new Error('timeout'));

        expect(await RosApiService.getInterfaceDescription(ros, '/cmd_vel')).toBeNull();
    });
});

describe('RosApiService.getTopicRawDefinition', () => {
    const rawTypesResponse = {
        topics: ['/cmd_vel', '/chatter'],
        types: ['geometry_msgs/msg/Twist', 'std_msgs/msg/String'],
        typedefs_full_text: ['# Velocity command\nVector3 linear # m/s\nVector3 angular # rad/s', 'string data'],
    };

    function buildRos(): Ros {
        return {
            getTopicsAndRawTypes: jest.fn((cb: (result: typeof rawTypesResponse) => void) => cb(rawTypesResponse)),
        } as unknown as Ros;
    }

    it('returns the raw definition for a topic name', async () => {
        const raw = await RosApiService.getTopicRawDefinition(buildRos(), '/cmd_vel');
        expect(raw).toContain('# m/s');
    });

    it('falls back to matching by message type', async () => {
        const raw = await RosApiService.getTopicRawDefinition(buildRos(), '/some_other_topic', 'std_msgs/msg/String');
        expect(raw).toBe('string data');
    });

    it('returns null when neither topic nor type is active', async () => {
        const raw = await RosApiService.getTopicRawDefinition(buildRos(), '/unknown', 'pkg/msg/Unknown');
        expect(raw).toBeNull();
    });
});

describe('RosApiService.expandRootTypeDef', () => {
    const requestTypeDef: rosapi.TypeDef = {
        type: 'rcl_interfaces/GetParameters_Request',
        fieldnames: ['names', 'options'],
        fieldtypes: ['string', 'rcl_interfaces/ListParametersResult'],
        fieldarraylen: [0, -1],
        examples: [],
    };
    const nestedTypeDef: rosapi.TypeDef = {
        type: 'rcl_interfaces/ListParametersResult',
        fieldnames: ['names'],
        fieldtypes: ['string'],
        fieldarraylen: [0],
        examples: [],
    };

    it('expands via exact root name when it matches', () => {
        const result = RosApiService.expandRootTypeDef('rcl_interfaces/GetParameters_Request', [
            requestTypeDef,
            nestedTypeDef,
        ]);
        expect(result).toEqual({ names: ['string'], options: { names: ['string'] } });
    });

    it('falls back to the first typedef when the root name is mangled by rosapi', () => {
        const result = RosApiService.expandRootTypeDef('rcl_interfaces/srv/GetParameters', [
            requestTypeDef,
            nestedTypeDef,
        ]);
        expect(result).toEqual({ names: ['string'], options: { names: ['string'] } });
    });

    it('returns the type name when there are no typedefs at all', () => {
        expect(RosApiService.expandRootTypeDef('std_msgs/msg/Empty', [])).toBe('std_msgs/msg/Empty');
    });
});

describe('RosApiService.getNodeDefinition', () => {
    const stringTypeDef: rosapi.TypeDef = {
        type: 'std_msgs/msg/String',
        fieldnames: ['data'],
        fieldtypes: ['string'],
        fieldarraylen: [-1],
        examples: [],
    };

    // rosapi derives typedef root names from the generated Python classes,
    // so service sub-definitions come back as `<pkg>/<Type>_Request` — never
    // as the `<pkg>/srv/<Type>` name the lookup was made with.
    const getParametersRequestTypeDef: rosapi.TypeDef = {
        type: 'rcl_interfaces/GetParameters_Request',
        fieldnames: ['names'],
        fieldtypes: ['string'],
        fieldarraylen: [0],
        examples: [],
    };

    const getParametersResponseTypeDef: rosapi.TypeDef = {
        type: 'rcl_interfaces/GetParameters_Response',
        fieldnames: ['values'],
        fieldtypes: ['string'],
        fieldarraylen: [0],
        examples: [],
    };

    function buildMockRos(details: rosapi.NodeDetailsResponse): Ros {
        return {
            getNodeDetails: jest.fn((node: string, cb: SuccessCallback<rosapi.NodeDetailsResponse>) => cb(details)),
            getTopicType: jest.fn((topic: string, cb: SuccessCallback<string>, errCb: ErrorCallback) => {
                if (topic === '/broken') {
                    errCb('type lookup failed');
                } else {
                    cb('std_msgs/msg/String');
                }
            }),
            getMessageDetails: jest.fn((type: string, cb: SuccessCallback<rosapi.TypeDef[]>) => cb([stringTypeDef])),
            getServiceType: jest.fn((service: string, cb: SuccessCallback<string>) => {
                if (service.endsWith('/_action/send_goal')) {
                    cb('test_msgs/action/Fibonacci_SendGoal');
                } else {
                    cb('rcl_interfaces/srv/GetParameters');
                }
            }),
            getServiceRequestDetails: jest.fn(
                (type: string, cb: SuccessCallback<rosapi.ServiceRequestDetailsResponse>) =>
                    cb({ typedefs: [getParametersRequestTypeDef] }),
            ),
            getServiceResponseDetails: jest.fn(
                (type: string, cb: SuccessCallback<rosapi.ServiceResponseDetailsResponse>) =>
                    cb({ typedefs: [getParametersResponseTypeDef] }),
            ),
        } as unknown as Ros;
    }

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should expand topics and services with their definitions', async () => {
        const ros = buildMockRos({
            publishing: ['/chatter'],
            subscribing: ['/listen'],
            services: ['/talker/get_parameters'],
        });

        const result = await RosApiService.getNodeDefinition(ros, '/talker');

        expect(result).toEqual({
            publishing: [{ name: '/chatter', type: 'std_msgs/msg/String', definition: { data: 'string' } }],
            subscribing: [{ name: '/listen', type: 'std_msgs/msg/String', definition: { data: 'string' } }],
            services: [
                {
                    name: '/talker/get_parameters',
                    type: 'rcl_interfaces/srv/GetParameters',
                    request: { names: ['string'] },
                    response: { values: ['string'] },
                },
            ],
            actions: [],
        });
    });

    it('should resolve each distinct type only once', async () => {
        const ros = buildMockRos({
            publishing: ['/chatter', '/chatter_debug'],
            subscribing: [],
            services: ['/talker/get_parameters', '/talker/get_parameters_backup'],
        });

        await RosApiService.getNodeDefinition(ros, '/talker');

        expect(ros.getMessageDetails).toHaveBeenCalledTimes(1);
        expect(ros.getServiceRequestDetails).toHaveBeenCalledTimes(1);
        expect(ros.getServiceResponseDetails).toHaveBeenCalledTimes(1);
    });

    it('should report per-entry errors without failing the whole lookup', async () => {
        const ros = buildMockRos({
            publishing: ['/chatter', '/broken'],
            subscribing: [],
            services: [],
        });

        const result = await RosApiService.getNodeDefinition(ros, '/talker');

        expect(result.publishing).toEqual([
            { name: '/chatter', type: 'std_msgs/msg/String', definition: { data: 'string' } },
            { name: '/broken', error: 'type lookup failed' },
        ]);
    });

    it('should fold internal _action services and topics into action definitions', async () => {
        const fibonacciGoalTypeDef: rosapi.TypeDef = {
            type: 'test_msgs/Fibonacci_Goal',
            fieldnames: ['order'],
            fieldtypes: ['int32'],
            fieldarraylen: [-1],
            examples: [],
        };
        const fibonacciSequenceTypeDef: rosapi.TypeDef = {
            type: 'test_msgs/Fibonacci_Result',
            fieldnames: ['sequence'],
            fieldtypes: ['int32'],
            fieldarraylen: [0],
            examples: [],
        };
        jest.spyOn(RosApiService, 'getActionGoalDetails').mockResolvedValue([fibonacciGoalTypeDef]);
        jest.spyOn(RosApiService, 'getActionResultDetails').mockResolvedValue([fibonacciSequenceTypeDef]);
        jest.spyOn(RosApiService, 'getActionFeedbackDetails').mockResolvedValue([fibonacciSequenceTypeDef]);

        const ros = buildMockRos({
            publishing: ['/chatter', '/fibonacci/_action/feedback', '/fibonacci/_action/status'],
            subscribing: [],
            services: [
                '/talker/get_parameters',
                '/fibonacci/_action/send_goal',
                '/fibonacci/_action/cancel_goal',
                '/fibonacci/_action/get_result',
            ],
        });

        const result = await RosApiService.getNodeDefinition(ros, '/talker');

        expect(result.publishing.map((t) => t.name)).toEqual(['/chatter']);
        expect(result.services.map((s) => s.name)).toEqual(['/talker/get_parameters']);
        expect(result.actions).toEqual([
            {
                name: '/fibonacci',
                type: 'test_msgs/action/Fibonacci',
                goal: { order: 'int32' },
                result: { sequence: ['int32'] },
                feedback: { sequence: ['int32'] },
            },
        ]);
    });
});
