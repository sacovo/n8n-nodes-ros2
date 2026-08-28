/**
 * Unit tests for the shared load-options factories.
 *
 * These deliberately use the real RosN8nFormatter: the factories hand the
 * formatters around as plain callbacks, and every failure inside a factory is
 * swallowed into an empty dropdown, so a formatter that broke when detached
 * would look exactly like "rosbridge had nothing to offer".
 */

import type { ILoadOptionsFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

import { RosApiService } from '../services/RosApiService';
import { RosBridgeService } from '../services/RosBridgeService';
import { RosN8nFormatter } from '../utils/RosN8nFormatter';
import {
    detectedTypeSearch,
    getLocatorValue,
    listSearch,
    topicListSearch,
    typeFieldsMapper,
    withRosbridge,
} from '../utils/LoadOptions';

jest.mock('../services/RosBridgeService');
jest.mock('../services/RosApiService');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockRosApiService = RosApiService as jest.Mocked<typeof RosApiService>;

const fakeRos = {} as Ros;

function buildLoadOptions(parameters: Record<string, unknown> = {}): ILoadOptionsFunctions {
    return {
        getCredentials: jest.fn().mockResolvedValue({ protocol: 'ws', host: 'localhost', port: 9090 }),
        getNodeParameter: jest
            .fn()
            .mockImplementation((name: string, fallback: unknown) =>
                name in parameters ? parameters[name] : fallback,
            ),
        getNode: jest.fn().mockReturnValue({ name: 'Test Node' }),
    } as unknown as ILoadOptionsFunctions;
}

describe('LoadOptions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRosBridgeService.connect.mockResolvedValue(fakeRos);
        // getRosMessageStructure expands nested types through RosApiService,
        // which is mocked here; leaving primitives as their own name is what
        // the real expandTypeDef does for a type with no further definition.
        mockRosApiService.expandTypeDef.mockImplementation((typeName) => typeName);
    });

    describe('getLocatorValue', () => {
        it('unwraps a resourceLocator object', () => {
            const ctx = buildLoadOptions({ topicName: { mode: 'list', value: '/chatter' } });
            expect(getLocatorValue(ctx, 'topicName')).toBe('/chatter');
        });

        it('passes a plain string through and trims it', () => {
            const ctx = buildLoadOptions({ topicName: '  /chatter  ' });
            expect(getLocatorValue(ctx, 'topicName')).toBe('/chatter');
        });

        it('returns an empty string when the parameter is unset', () => {
            expect(getLocatorValue(buildLoadOptions(), 'topicName')).toBe('');
        });
    });

    describe('withRosbridge', () => {
        it('returns the fallback instead of throwing when the connection fails', async () => {
            mockRosBridgeService.connect.mockRejectedValue(new Error('rosbridge is down'));

            const result = await withRosbridge(buildLoadOptions(), { results: [] }, async () => ({
                results: [{ name: 'never', value: 'never' }],
            }));

            expect(result).toEqual({ results: [] });
        });

        it('returns the fallback when the work itself throws', async () => {
            const result = await withRosbridge(buildLoadOptions(), { fields: [] }, async () => {
                throw new Error('rosapi did not answer');
            });

            expect(result).toEqual({ fields: [] });
        });
    });

    describe('listSearch', () => {
        it('formats what fetch returns', async () => {
            mockRosApiService.getNodes.mockResolvedValue(['/talker', '/listener']);

            const method = listSearch((ros) => RosApiService.getNodes(ros), RosN8nFormatter.formatNodeListForN8n);
            const result = await method.call(buildLoadOptions());

            expect(result).toEqual({
                results: [
                    { name: '/talker', value: '/talker' },
                    { name: '/listener', value: '/listener' },
                ],
            });
        });

        it('applies the search filter', async () => {
            mockRosApiService.getNodes.mockResolvedValue(['/talker', '/listener']);

            const method = listSearch((ros) => RosApiService.getNodes(ros), RosN8nFormatter.formatNodeListForN8n);
            const result = await method.call(buildLoadOptions(), 'talk');

            expect(result).toEqual({ results: [{ name: '/talker', value: '/talker' }] });
        });
    });

    describe('topicListSearch', () => {
        beforeEach(() => {
            mockRosApiService.getTopics.mockResolvedValue({
                topics: ['/mani/cmd_vel', '/other/cmd_vel'],
                types: [],
            } as never);
        });

        it('offers every topic when no scope parameter is configured', async () => {
            const result = await topicListSearch().call(buildLoadOptions());

            expect(result.results).toHaveLength(2);
        });

        it('hides topics outside the configured namespaces', async () => {
            const ctx = buildLoadOptions({ options: { allowedNamespaces: '/mani' } });
            const result = await topicListSearch({ scopeOptionsParameter: 'options' }).call(ctx);

            expect(result.results).toEqual([{ name: '/mani/cmd_vel', value: '/mani/cmd_vel' }]);
        });
    });

    describe('detectedTypeSearch', () => {
        it('reports the type of the selected source', async () => {
            mockRosApiService.getTopicType.mockResolvedValue('std_msgs/msg/String');

            const method = detectedTypeSearch('topicName', (ros, topic) => RosApiService.getTopicType(ros, topic));
            const result = await method.call(buildLoadOptions({ topicName: '/chatter' }));

            expect(result).toEqual({
                results: [{ name: 'Detected: std_msgs/msg/String', value: 'std_msgs/msg/String' }],
            });
        });

        it('does not connect while the source parameter is empty', async () => {
            const method = detectedTypeSearch('topicName', (ros, topic) => RosApiService.getTopicType(ros, topic));
            const result = await method.call(buildLoadOptions());

            expect(result).toEqual({ results: [] });
            expect(mockRosBridgeService.connect).not.toHaveBeenCalled();
        });

        it('returns nothing when the type does not match the filter', async () => {
            mockRosApiService.getTopicType.mockResolvedValue('std_msgs/msg/String');

            const method = detectedTypeSearch('topicName', (ros, topic) => RosApiService.getTopicType(ros, topic));
            const result = await method.call(buildLoadOptions({ topicName: '/chatter' }), 'geometry');

            expect(result).toEqual({ results: [] });
        });
    });

    describe('typeFieldsMapper', () => {
        const stringTypeDefs = [
            {
                type: 'std_msgs/msg/String',
                fieldnames: ['data'],
                fieldtypes: ['string'],
                fieldarraylen: [-1],
                examples: [],
            },
        ];

        it('uses the explicit type parameter when it is set', async () => {
            mockRosApiService.getMessageDetails.mockResolvedValue(stringTypeDefs);

            const method = typeFieldsMapper({
                typeParameter: 'messageType',
                fetchTypeDefs: (ros, type) => RosApiService.getMessageDetails(ros, type),
            });
            const result = await method.call(buildLoadOptions({ messageType: 'std_msgs/msg/String' }));

            expect(mockRosApiService.getMessageDetails).toHaveBeenCalledWith(fakeRos, 'std_msgs/msg/String');
            expect(result.fields).toHaveLength(1);
            expect(result.fields[0]).toMatchObject({ id: 'data', type: 'string' });
        });

        it('falls back to resolving the type from the source parameter', async () => {
            mockRosApiService.getTopicType.mockResolvedValue('std_msgs/msg/String');
            mockRosApiService.getMessageDetails.mockResolvedValue(stringTypeDefs);

            const method = typeFieldsMapper({
                typeParameter: 'messageType',
                source: {
                    parameter: 'topicName',
                    resolve: (ros, topic) => RosApiService.getTopicType(ros, topic),
                },
                fetchTypeDefs: (ros, type) => RosApiService.getMessageDetails(ros, type),
            });
            const result = await method.call(buildLoadOptions({ topicName: '/chatter' }));

            expect(mockRosApiService.getTopicType).toHaveBeenCalledWith(fakeRos, '/chatter');
            expect(result.fields).toHaveLength(1);
        });

        it('applies normalizeType before fetching the definition', async () => {
            mockRosApiService.getMessageDetails.mockResolvedValue([]);

            const method = typeFieldsMapper({
                typeParameter: 'serviceType',
                normalizeType: (type) => (type.endsWith('_Request') ? type : `${type}_Request`),
                fetchTypeDefs: (ros, type) => RosApiService.getMessageDetails(ros, type),
            });
            await method.call(buildLoadOptions({ serviceType: 'std_srvs/srv/SetBool' }));

            expect(mockRosApiService.getMessageDetails).toHaveBeenCalledWith(
                fakeRos,
                'std_srvs/srv/SetBool_Request',
            );
        });

        it('returns no fields when no type can be resolved', async () => {
            const method = typeFieldsMapper({
                typeParameter: 'messageType',
                fetchTypeDefs: (ros, type) => RosApiService.getMessageDetails(ros, type),
            });
            const result = await method.call(buildLoadOptions());

            expect(result).toEqual({ fields: [] });
            expect(mockRosApiService.getMessageDetails).not.toHaveBeenCalled();
        });
    });
});
