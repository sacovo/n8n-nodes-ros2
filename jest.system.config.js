/**
 * Jest config for the docker-backed system tests. Kept separate from
 * jest.config.js so `npm test` stays fast and hermetic - these need a running
 * rosbridge and are started via `npm run test:system`.
 */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/test/system'],
    testMatch: ['**/*.test.ts'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    // ROS discovery and action goals are slow; run serially so the fixture's
    // single action server is not contended by parallel workers.
    maxWorkers: 1,
    globals: {
        'ts-jest': {
            tsconfig: {
                target: 'es2019',
                module: 'commonjs',
            },
        },
    },
};
