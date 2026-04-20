module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>'],
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
