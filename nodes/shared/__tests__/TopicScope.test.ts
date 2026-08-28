/**
 * Unit tests for TopicScope
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { assertInScope, filterByScope, isInScope, normalizeRosName, parseTopicScope } from '../utils/TopicScope';

describe('TopicScope', () => {
    describe('normalizeRosName', () => {
        it('should add a leading slash to relative names', () => {
            expect(normalizeRosName('mani/cmd_vel')).toBe('/mani/cmd_vel');
        });

        it('should strip trailing, repeated and surrounding whitespace slashes', () => {
            expect(normalizeRosName('  //mani//cmd_vel/  ')).toBe('/mani/cmd_vel');
        });

        it('should return an empty string for blank or non-string input', () => {
            expect(normalizeRosName('')).toBe('');
            expect(normalizeRosName('   ')).toBe('');
            expect(normalizeRosName('/')).toBe('');
            expect(normalizeRosName(undefined)).toBe('');
            expect(normalizeRosName(42)).toBe('');
        });
    });

    describe('parseTopicScope', () => {
        it('should split on commas and newlines and normalize each prefix', () => {
            expect(parseTopicScope(' /mani, any-safe-system/ \n/other')).toEqual([
                '/mani',
                '/any-safe-system',
                '/other',
            ]);
        });

        it('should drop empty entries and duplicates', () => {
            expect(parseTopicScope('/mani,,/mani/, \n')).toEqual(['/mani']);
        });

        it('should return an empty scope for blank or non-string input', () => {
            expect(parseTopicScope('')).toEqual([]);
            expect(parseTopicScope(undefined)).toEqual([]);
        });
    });

    describe('isInScope', () => {
        it('should allow everything when the scope is empty', () => {
            expect(isInScope('/anything', [])).toBe(true);
            expect(isInScope('', [])).toBe(true);
        });

        it('should allow the prefix itself and names below it', () => {
            expect(isInScope('/mani', ['/mani'])).toBe(true);
            expect(isInScope('/mani/cmd_vel', ['/mani'])).toBe(true);
            expect(isInScope('/mani/arm/joint_states', ['/mani'])).toBe(true);
        });

        it('should not allow names that only share a string prefix', () => {
            expect(isInScope('/manipulator/cmd_vel', ['/mani'])).toBe(false);
            expect(isInScope('/mani_unsafe', ['/mani'])).toBe(false);
        });

        it('should not allow names outside every prefix', () => {
            expect(isInScope('/cmd_vel', ['/mani', '/any-safe-system'])).toBe(false);
        });

        it('should allow a name matching any of several prefixes', () => {
            expect(isInScope('/any-safe-system/go', ['/mani', '/any-safe-system'])).toBe(true);
        });

        it('should normalize the checked name before matching', () => {
            expect(isInScope('mani/cmd_vel/', ['/mani'])).toBe(true);
        });

        it('should treat a "*" segment as exactly one segment', () => {
            expect(isInScope('/robot/left/cmd_vel', ['/robot/*/cmd_vel'])).toBe(true);
            expect(isInScope('/robot/left/arm/cmd_vel', ['/robot/*/cmd_vel'])).toBe(false);
            expect(isInScope('/robot/cmd_vel', ['/robot/*/cmd_vel'])).toBe(false);
        });

        it('should reject empty names when a scope is set', () => {
            expect(isInScope('', ['/mani'])).toBe(false);
            expect(isInScope(undefined, ['/mani'])).toBe(false);
        });
    });

    describe('filterByScope', () => {
        it('should keep only in-scope names', () => {
            expect(filterByScope(['/mani/cmd_vel', '/manipulator/x', '/cmd_vel'], ['/mani'])).toEqual([
                '/mani/cmd_vel',
            ]);
        });

        it('should return the list unchanged when the scope is empty', () => {
            const topics = ['/a', '/b'];
            expect(filterByScope(topics, [])).toBe(topics);
        });
    });

    describe('assertInScope', () => {
        const executeFunctions = {
            getNode: jest.fn().mockReturnValue({ name: 'ROS2 Topic Publish', type: 'rosTopicPublish' }),
        } as unknown as IExecuteFunctions;

        it('should not throw for in-scope names', () => {
            expect(() => assertInScope(executeFunctions, '/mani/cmd_vel', ['/mani'], 0)).not.toThrow();
        });

        it('should throw naming the topic and the allowed namespaces', () => {
            expect(() => assertInScope(executeFunctions, '/cmd_vel', ['/mani', '/any-safe-system'], 0)).toThrow(
                /\/cmd_vel.*\/mani, \/any-safe-system/,
            );
        });
    });
});
