import { RosApiService } from '../RosApiService';
import type { Ros } from 'roslib';
import { rosapi } from 'roslib';

describe('RosApiService', () => {
    describe('expandTypeDef', () => {
        it('should expand a simple message with primitive types', () => {
            const typedefs: rosapi.TypeDef[] = [
                {
                    type: 'std_msgs/String',
                    fieldnames: ['data'],
                    fieldtypes: ['string'],
                    fieldarraylen: [-1],
                    examples: [],
                }
            ];

            const result = RosApiService.expandTypeDef('std_msgs/String', typedefs);
            expect(result).toEqual({
                data: 'string'
            });
        });

        it('should expand a message with nested types', () => {
            const typedefs: rosapi.TypeDef[] = [
                {
                    type: 'geometry_msgs/Point',
                    fieldnames: ['x', 'y', 'z'],
                    fieldtypes: ['float64', 'float64', 'float64'],
                    fieldarraylen: [-1, -1, -1],
                    examples: [],
                },
                {
                    type: 'geometry_msgs/Pose',
                    fieldnames: ['position'],
                    fieldtypes: ['geometry_msgs/Point'],
                    fieldarraylen: [-1],
                    examples: [],
                }
            ];

            const result = RosApiService.expandTypeDef('geometry_msgs/Pose', typedefs);
            expect(result).toEqual({
                position: {
                    x: 'float64',
                    y: 'float64',
                    z: 'float64'
                }
            });
        });

        it('should handle arrays correctly', () => {
            const typedefs: rosapi.TypeDef[] = [
                {
                    type: 'std_msgs/Float64MultiArray',
                    fieldnames: ['data'],
                    fieldtypes: ['float64'],
                    fieldarraylen: [0], // variable length array
                    examples: [],
                }
            ];

            const result = RosApiService.expandTypeDef('std_msgs/Float64MultiArray', typedefs);
            expect(result).toEqual({
                data: ['float64']
            });
        });

        it('should handle deeply nested types with arrays', () => {
            const typedefs: rosapi.TypeDef[] = [
                {
                    type: 'std_msgs/Header',
                    fieldnames: ['seq', 'stamp', 'frame_id'],
                    fieldtypes: ['uint32', 'time', 'string'],
                    fieldarraylen: [-1, -1, -1],
                    examples: [],
                },
                {
                    type: 'sensor_msgs/Image',
                    fieldnames: ['header', 'height', 'width', 'data'],
                    fieldtypes: ['std_msgs/Header', 'uint32', 'uint32', 'uint8'],
                    fieldarraylen: [-1, -1, -1, 0],
                    examples: [],
                }
            ];

            const result = RosApiService.expandTypeDef('sensor_msgs/Image', typedefs);
            expect(result).toEqual({
                header: {
                    seq: 'uint32',
                    stamp: 'time',
                    frame_id: 'string'
                },
                height: 'uint32',
                width: 'uint32',
                data: ['uint8']
            });
        });

        it('should return the type name if typedef is not found (primitive)', () => {
            const typedefs: rosapi.TypeDef[] = [];
            const result = RosApiService.expandTypeDef('int32', typedefs);
            expect(result).toBe('int32');
        });

        it('should avoid infinite recursion (though ROS messages are DAG)', () => {
             const typedefs: rosapi.TypeDef[] = [
                {
                    type: 'recursive/Type',
                    fieldnames: ['self'],
                    fieldtypes: ['recursive/Type'],
                    fieldarraylen: [-1],
                    examples: [],
                }
            ];

            const result = RosApiService.expandTypeDef('recursive/Type', typedefs);
            expect(result).toEqual({
                self: 'recursive/Type'
            });
        });
    });

    describe('getActionType', () => {
        afterEach(() => {
            jest.restoreAllMocks();
        });

        /**
         * Stubs the dynamically imported roslib `Service` so `/rosapi/*` calls
         * are answered by `respond`, which either resolves or rejects.
         */
        function mockRosapiService(
            respond: (serviceName: string, request: unknown) => unknown,
        ): jest.Mock {
            const callService = jest.fn(
                (
                    request: unknown,
                    onSuccess: (result: unknown) => void,
                    onError: (error: string) => void,
                    serviceName?: string,
                ) => {
                    try {
                        onSuccess(respond(serviceName as string, request));
                    } catch (error) {
                        onError((error as Error).message);
                    }
                },
            );

            class ServiceStub {
                constructor(private readonly options: { name: string }) {}
                callService(request: unknown, onSuccess: (result: unknown) => void, onError: (error: string) => void) {
                    callService(request, onSuccess, onError, this.options.name);
                }
            }

            jest.spyOn(
                RosApiService as unknown as { loadRoslib: () => Promise<unknown> },
                'loadRoslib',
            ).mockResolvedValue({ Service: ServiceStub });

            return callService;
        }

        function buildRos(serviceTypes: Record<string, string>): Ros {
            return {
                getServiceType: jest.fn((service: string, onSuccess: (type: string) => void, onError: (error: string) => void) => {
                    const type = serviceTypes[service];
                    // rosapi answers with an empty type for services it cannot see.
                    if (type === undefined) {
                        onError('no such service');
                        return;
                    }
                    onSuccess(type);
                }),
            } as unknown as Ros;
        }

        it('resolves the type through /rosapi/action_type', async () => {
            const callService = mockRosapiService(() => ({ type: 'test_msgs/action/Fibonacci' }));

            const type = await RosApiService.getActionType(buildRos({}), '/fibonacci');

            expect(type).toBe('test_msgs/action/Fibonacci');
            expect(callService).toHaveBeenCalledWith(
                { action: '/fibonacci' },
                expect.any(Function),
                expect.any(Function),
                '/rosapi/action_type',
            );
        });

        it('strips a trailing slash from the action name', async () => {
            const callService = mockRosapiService(() => ({ type: 'test_msgs/action/Fibonacci' }));

            await RosApiService.getActionType(buildRos({}), '/fibonacci/');

            expect(callService).toHaveBeenCalledWith(
                { action: '/fibonacci' },
                expect.any(Function),
                expect.any(Function),
                '/rosapi/action_type',
            );
        });

        it('falls back to the send_goal service type when action_type is unavailable', async () => {
            mockRosapiService(() => {
                throw new Error('service /rosapi/action_type does not exist');
            });
            const ros = buildRos({
                '/fibonacci/_action/send_goal': 'test_msgs/action/Fibonacci_SendGoal',
            });

            expect(await RosApiService.getActionType(ros, '/fibonacci')).toBe('test_msgs/action/Fibonacci');
        });

        it('returns an empty type when neither lookup resolves', async () => {
            mockRosapiService(() => ({ type: '' }));

            expect(await RosApiService.getActionType(buildRos({}), '/fibonacci')).toBe('');
        });
    });
});
