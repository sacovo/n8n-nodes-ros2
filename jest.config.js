module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>'],
    // The docker-backed system tests need a live rosbridge; run them via
    // `npm run test:system` (jest.system.config.js) instead of `npm test`.
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test/system/'],
    testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    collectCoverageFrom: [
        'nodes/**/*.ts',
        'credentials/**/*.ts',
        '!nodes/**/*.node.ts',
        '!nodes/shared/**',
        '!**/*.d.ts',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    globals: {
        'ts-jest': {
            tsconfig: {
                target: 'es2019',
                module: 'commonjs',
            },
        },
    },
};
