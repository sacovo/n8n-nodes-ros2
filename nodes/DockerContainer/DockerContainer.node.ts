import type {
    IDataObject,
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';
import Docker from 'dockerode';

export class DockerContainer implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Docker Container',
        name: 'dockerContainer',
        icon: 'file:docker.svg',
        group: ['transform'],
        version: 1,
        description: 'Control Docker containers',
        defaults: {
            name: 'Docker Container',
        },
        usableAsTool: true,
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
        properties: [
            {
                displayName: 'Socket Path',
                name: 'socketPath',
                type: 'string',
                default: '/var/run/docker.sock',
                description: 'Path to the Docker socket',
                required: true,
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                options: [
                    {
                        name: 'Execute Command',
                        value: 'exec',
                        description: 'Execute a command in a running container',
                        action: 'Execute a command in a container',
                    },
                    {
                        name: 'Get Logs',
                        value: 'logs',
                        description: 'Get logs from a container',
                        action: 'Get logs from a container',
                    },
                    {
                        name: 'Restart',
                        value: 'restart',
                        description: 'Restart a container',
                        action: 'Restart a container',
                    },
                    {
                        name: 'Start',
                        value: 'start',
                        description: 'Start a container',
                        action: 'Start a container',
                    },
                    {
                        name: 'Stop',
                        value: 'stop',
                        description: 'Stop a container',
                        action: 'Stop a container',
                    },
                ],
                default: 'start',
            },
            {
                displayName: 'Container ID or Name',
                name: 'containerId',
                type: 'string',
                default: '',
                required: true,
                description: 'The ID or name of the Docker container',
            },
            {
                displayName: 'Lines',
                name: 'lines',
                type: 'number',
                displayOptions: {
                    show: {
                        operation: ['logs'],
                    },
                },
                default: 100,
                description: 'Number of lines to return from the end of the logs',
            },
            {
                displayName: 'Command',
                name: 'command',
                type: 'string',
                displayOptions: {
                    show: {
                        operation: ['exec'],
                    },
                },
                default: '',
                description: 'The command to execute (e.g. ls -la)',
                required: true,
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            try {
                const operation = this.getNodeParameter('operation', i) as string;
                const socketPath = this.getNodeParameter('socketPath', i) as string;
                const containerId = this.getNodeParameter('containerId', i) as string;

                const docker = new Docker({ socketPath });
                const container = docker.getContainer(containerId);

                const result: IDataObject = { success: true };

                if (operation === 'start') {
                    await container.start();
                    result.message = `Container ${containerId} started successfully`;
                } else if (operation === 'stop') {
                    await container.stop();
                    result.message = `Container ${containerId} stopped successfully`;
                } else if (operation === 'restart') {
                    await container.restart();
                    result.message = `Container ${containerId} restarted successfully`;
                } else if (operation === 'logs') {
                    const lines = this.getNodeParameter('lines', i) as number;
                    const logStream = await container.logs({
                        stdout: true,
                        stderr: true,
                        tail: lines,
                    });

                    // The logstream from dockerode is a buffer, we need to extract the string
                    result.logs = logStream.toString('utf8');
                } else if (operation === 'exec') {
                    const commandStr = this.getNodeParameter('command', i) as string;
                    // very basic command splitting
                    // in real world, you might want to use a shell parser or allow array input
                    const cmdArray = commandStr.match(/(?:[^\s"']+|['"][^'"]*["'])+/g)?.map(arg => {
                        if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
                            return arg.slice(1, -1);
                        }
                        return arg;
                    }) || [];

                    const execInstance = await container.exec({
                        Cmd: cmdArray,
                        AttachStdout: true,
                        AttachStderr: true,
                    });

                    const stream = await execInstance.start({ hijack: true, stdin: false });

                    result.output = await new Promise((resolve, reject) => {
                        let output = '';
                        stream.on('data', (chunk) => {
                            // Docker multiplexes stdout and stderr
                            // The first 8 bytes of the chunk contain the header
                            // We can just get the whole chunk as string for simplicity here,
                            // or properly parse it:
                            // The payload starts at offset 8
                            if (chunk.length > 8) {
                                output += chunk.slice(8).toString('utf8');
                            }
                        });
                        stream.on('end', () => resolve(output));
                        stream.on('error', reject);
                    });
                }

                returnData.push({
                    json: result,
                    pairedItem: { item: i },
                });
            } catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: { error: error.message },
                        pairedItem: { item: i },
                    });
                } else {
                    throw new NodeApiError(this.getNode(), error as JsonObject);
                }
            }
        }

        return [returnData];
    }
}