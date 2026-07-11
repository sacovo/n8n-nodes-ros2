/**
 * Unit tests for RosApiService.getNodeDefinition
 */

import { RosApiService } from '../services/RosApiService';
import type { Ros, rosapi } from 'roslib';

type SuccessCallback<T> = (result: T) => void;
type ErrorCallback = (error: string) => void;

describe('RosApiService.getNodeDefinition', () => {
    const stringTypeDef: rosapi.TypeDef = {
        type: 'std_msgs/msg/String',
        fieldnames: ['data'],
        fieldtypes: ['string'],
        fieldarraylen: [-1],
        examples: [],
    };

    const getParametersRequestTypeDef: rosapi.TypeDef = {
        type: 'rcl_interfaces/srv/GetParameters',
        fieldnames: ['names'],
        fieldtypes: ['string'],
        fieldarraylen: [0],
        examples: [],
    };

    const getParametersResponseTypeDef: rosapi.TypeDef = {
        type: 'rcl_interfaces/srv/GetParameters',
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
            publishing: [
                { name: '/chatter', type: 'std_msgs/msg/String', definition: { data: 'string' } },
            ],
            subscribing: [
                { name: '/listen', type: 'std_msgs/msg/String', definition: { data: 'string' } },
            ],
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
            type: 'test_msgs/action/Fibonacci',
            fieldnames: ['order'],
            fieldtypes: ['int32'],
            fieldarraylen: [-1],
            examples: [],
        };
        const fibonacciSequenceTypeDef: rosapi.TypeDef = {
            type: 'test_msgs/action/Fibonacci',
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
