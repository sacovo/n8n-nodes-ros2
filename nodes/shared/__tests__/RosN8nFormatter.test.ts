import { RosN8nFormatter } from '../utils/RosN8nFormatter';

describe('RosN8nFormatter', () => {
    describe('formatTopicListForN8n', () => {
        const topics = ['/cmd_vel', '/sensor_data', '/odom', '/tf'];

        it('should format topic list without filter', () => {
            const result = RosN8nFormatter.formatTopicListForN8n(topics);
            expect(result).toEqual([
                { name: '/cmd_vel', value: '/cmd_vel' },
                { name: '/sensor_data', value: '/sensor_data' },
                { name: '/odom', value: '/odom' },
                { name: '/tf', value: '/tf' },
            ]);
        });

        it('should filter topic list', () => {
            const result = RosN8nFormatter.formatTopicListForN8n(topics, 'sensor');
            expect(result).toEqual([
                { name: '/sensor_data', value: '/sensor_data' },
            ]);
        });

        it('should perform case-insensitive filtering', () => {
            const result = RosN8nFormatter.formatTopicListForN8n(topics, 'ODOM');
            expect(result).toEqual([
                { name: '/odom', value: '/odom' },
            ]);
        });

        it('should return empty array if no match', () => {
            const result = RosN8nFormatter.formatTopicListForN8n(topics, 'missing');
            expect(result).toEqual([]);
        });

        it('should handle undefined or null topics', () => {
            /* eslint-disable  @typescript-eslint/no-explicit-any */
            const result = RosN8nFormatter.formatTopicListForN8n(['/topic', null as any, undefined as any, '']);
            expect(result).toEqual([
                { name: '/topic', value: '/topic' },
            ]);
        });
    });

    describe('getRosMessageStructure', () => {
        const twistTypeDefs = [
            {
                type: 'geometry_msgs/msg/Twist',
                fieldnames: ['linear', 'angular'],
                fieldtypes: ['geometry_msgs/msg/Vector3', 'geometry_msgs/msg/Vector3'],
                fieldarraylen: [-1, -1],
                examples: [],
            },
            {
                type: 'geometry_msgs/msg/Vector3',
                fieldnames: ['x', 'y', 'z'],
                fieldtypes: ['float64', 'float64', 'float64'],
                fieldarraylen: [-1, -1, -1],
                examples: [],
            },
        ];

        it('should map primitive fields without a structure hint', () => {
            const result = RosN8nFormatter.getRosMessageStructure([
                {
                    type: 'std_msgs/msg/String',
                    fieldnames: ['data'],
                    fieldtypes: ['string'],
                    fieldarraylen: [-1],
                    examples: [],
                },
            ]);

            expect(result.fields).toEqual([
                expect.objectContaining({
                    id: 'data',
                    type: 'string',
                    description: 'ROS message field of type string',
                }),
            ]);
        });

        it('should embed the expanded structure of nested types in the description', () => {
            const result = RosN8nFormatter.getRosMessageStructure(twistTypeDefs);

            expect(result.fields).toHaveLength(2);
            expect(result.fields[0]).toEqual(
                expect.objectContaining({
                    id: 'linear',
                    type: 'object',
                    description:
                        'ROS message field of type geometry_msgs/msg/Vector3. Structure: {"x":"float64","y":"float64","z":"float64"}',
                }),
            );
        });

        it('should mark array fields and still expand their element structure', () => {
            const result = RosN8nFormatter.getRosMessageStructure([
                {
                    type: 'geometry_msgs/msg/PoseArrayLike',
                    fieldnames: ['vectors'],
                    fieldtypes: ['geometry_msgs/msg/Vector3'],
                    fieldarraylen: [0],
                    examples: [],
                },
                twistTypeDefs[1],
            ]);

            expect(result.fields[0]).toEqual(
                expect.objectContaining({
                    id: 'vectors',
                    type: 'array',
                    description:
                        'ROS message field of type geometry_msgs/msg/Vector3[]. Structure: {"x":"float64","y":"float64","z":"float64"}',
                }),
            );
        });

        it('should return empty fields for missing typedefs', () => {
            expect(RosN8nFormatter.getRosMessageStructure(undefined)).toEqual({ fields: [] });
            expect(RosN8nFormatter.getRosMessageStructure([])).toEqual({ fields: [] });
        });
    });

    describe('formatServiceListForN8n', () => {
        const services = ['/get_map', '/set_parameters', '/reset'];

        it('should format service list without filter', () => {
            const result = RosN8nFormatter.formatServiceListForN8n(services);
            expect(result).toEqual([
                { name: '/get_map', value: '/get_map' },
                { name: '/set_parameters', value: '/set_parameters' },
                { name: '/reset', value: '/reset' },
            ]);
        });

        it('should filter service list', () => {
            const result = RosN8nFormatter.formatServiceListForN8n(services, 'set');
            expect(result).toEqual([
                { name: '/set_parameters', value: '/set_parameters' },
                { name: '/reset', value: '/reset' },
            ]);
        });

        it('should perform case-insensitive filtering', () => {
            const result = RosN8nFormatter.formatServiceListForN8n(services, 'MAP');
            expect(result).toEqual([
                { name: '/get_map', value: '/get_map' },
            ]);
        });

        it('should return empty array if no match', () => {
            const result = RosN8nFormatter.formatServiceListForN8n(services, 'missing');
            expect(result).toEqual([]);
        });
    });
});
