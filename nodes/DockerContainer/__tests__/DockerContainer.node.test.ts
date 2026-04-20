import { DockerContainer } from '../DockerContainer.node';

// Mock the dockerode module
jest.mock('dockerode', () => {
    return jest.fn().mockImplementation(() => {
        return {
            getContainer: jest.fn().mockReturnValue({
                start: jest.fn().mockResolvedValue({}),
                stop: jest.fn().mockResolvedValue({}),
                restart: jest.fn().mockResolvedValue({}),
            }),
        };
    });
});

describe('DockerContainer Node', () => {
    let node: DockerContainer;
    let mockExecuteFunctions: any;

    beforeEach(() => {
        node = new DockerContainer();
        mockExecuteFunctions = {
            getInputData: jest.fn(),
            getNodeParameter: jest.fn(),
            continueOnFail: jest.fn().mockReturnValue(false),
            getNode: jest.fn().mockReturnValue({ name: 'dockerContainer' }),
        };
    });

    it('should be correctly initialized', () => {
        expect(node.description.name).toBe('dockerContainer');
        expect(node.description.displayName).toBe('Docker Container');
    });

    it('should handle start operation', async () => {
        mockExecuteFunctions.getInputData.mockReturnValue([{ json: {} }]);
        mockExecuteFunctions.getNodeParameter.mockImplementation((paramName: string) => {
            if (paramName === 'operation') return 'start';
            if (paramName === 'socketPath') return '/var/run/docker.sock';
            if (paramName === 'containerId') return 'test-container';
            return undefined;
        });

        const result = await node.execute.call(mockExecuteFunctions);

        expect(result).toBeDefined();
        expect(result[0][0].json).toHaveProperty('success', true);
        expect(result[0][0].json).toHaveProperty('message', 'Container test-container started successfully');
    });

    it('should handle stop operation', async () => {
        mockExecuteFunctions.getInputData.mockReturnValue([{ json: {} }]);
        mockExecuteFunctions.getNodeParameter.mockImplementation((paramName: string) => {
            if (paramName === 'operation') return 'stop';
            if (paramName === 'socketPath') return '/var/run/docker.sock';
            if (paramName === 'containerId') return 'test-container';
            return undefined;
        });

        const result = await node.execute.call(mockExecuteFunctions);

        expect(result).toBeDefined();
        expect(result[0][0].json).toHaveProperty('success', true);
        expect(result[0][0].json).toHaveProperty('message', 'Container test-container stopped successfully');
    });
});