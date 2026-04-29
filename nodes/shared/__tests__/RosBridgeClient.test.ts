import { formatTopicListForN8n, formatServiceListForN8n } from '../RosBridgeClient';

describe('RosBridgeClient Formatter Functions', () => {
    describe('formatTopicListForN8n', () => {
        const topics = ['/cmd_vel', '/sensor_data', '/odom', '/tf'];

        it('should format topic list without filter', () => {
            const result = formatTopicListForN8n(topics);
            expect(result).toEqual([
                { name: '/cmd_vel', value: '/cmd_vel' },
                { name: '/sensor_data', value: '/sensor_data' },
                { name: '/odom', value: '/odom' },
                { name: '/tf', value: '/tf' },
            ]);
        });

        it('should filter topic list', () => {
            const result = formatTopicListForN8n(topics, 'sensor');
            expect(result).toEqual([
                { name: '/sensor_data', value: '/sensor_data' },
            ]);
        });

        it('should perform case-insensitive filtering', () => {
            const result = formatTopicListForN8n(topics, 'ODOM');
            expect(result).toEqual([
                { name: '/odom', value: '/odom' },
            ]);
        });

        it('should return empty array if no match', () => {
            const result = formatTopicListForN8n(topics, 'missing');
            expect(result).toEqual([]);
        });
    });

    describe('formatServiceListForN8n', () => {
        const services = ['/get_map', '/set_parameters', '/reset'];

        it('should format service list without filter', () => {
            const result = formatServiceListForN8n(services);
            expect(result).toEqual([
                { name: '/get_map', value: '/get_map' },
                { name: '/set_parameters', value: '/set_parameters' },
                { name: '/reset', value: '/reset' },
            ]);
        });

        it('should filter service list', () => {
            const result = formatServiceListForN8n(services, 'set');
            expect(result).toEqual([
                { name: '/set_parameters', value: '/set_parameters' },
                { name: '/reset', value: '/reset' },
            ]);
        });

        it('should perform case-insensitive filtering', () => {
            const result = formatServiceListForN8n(services, 'MAP');
            expect(result).toEqual([
                { name: '/get_map', value: '/get_map' },
            ]);
        });
    });
});
