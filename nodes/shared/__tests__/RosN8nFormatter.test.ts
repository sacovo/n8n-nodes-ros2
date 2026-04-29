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
            const result = RosN8nFormatter.formatTopicListForN8n(['/topic', null as any, undefined as any, '']);
            expect(result).toEqual([
                { name: '/topic', value: '/topic' },
            ]);
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
