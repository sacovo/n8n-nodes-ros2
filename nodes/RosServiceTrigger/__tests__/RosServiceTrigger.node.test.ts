import { RosServiceTrigger } from '../RosServiceTrigger.node';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import type { ITriggerFunctions } from 'n8n-workflow';

jest.mock('../../shared/services/RosBridgeService');

describe('RosServiceTrigger', () => {
    let node: RosServiceTrigger;
    let triggerFunctions: jest.Mocked<ITriggerFunctions>;

    beforeEach(() => {
        node = new RosServiceTrigger();
        triggerFunctions = {
            getCredentials: jest.fn().mockResolvedValue({
                protocol: 'ws',
                host: 'localhost',
                port: 9090,
            }),
            getNodeParameter: jest.fn(),
            emit: jest.fn(),
            helpers: {
                returnJsonArray: jest.fn().mockImplementation((val) => val),
            },
        } as unknown as jest.Mocked<ITriggerFunctions>;

        (RosBridgeService.connect as jest.Mock).mockResolvedValue({} as any);
    });

    it('should advertise a service and emit request on call', async () => {
        triggerFunctions.getNodeParameter.mockImplementation((param) => {
            if (param === 'serviceName') return '/test_service';
            if (param === 'serviceType') return 'std_srvs/srv/SetBool';
            if (param === 'responseInputMode') return 'raw';
            if (param === 'responseJson') return '{"success": true}';
            return undefined;
        });

        const mockUnsubscribe = jest.fn();
        (RosBridgeService.advertiseService as jest.Mock).mockImplementation(
            (ros, name, type, callback) => {
                // Simulate a service call
                const request = { data: true };
                const response = {};
                const result = callback(request, response);
                
                expect(result).toBe(true);
                expect(response).toEqual({ success: true });
                
                return Promise.resolve(mockUnsubscribe);
            }
        );

        const result = await node.trigger.call(triggerFunctions);
        
        expect(RosBridgeService.connect).toHaveBeenCalled();
        expect(RosBridgeService.advertiseService).toHaveBeenCalledWith(
            expect.anything(),
            '/test_service',
            'std_srvs/srv/SetBool',
            expect.any(Function)
        );
        
        expect(triggerFunctions.emit).toHaveBeenCalledWith([
            [
                {
                    json: expect.objectContaining({
                        request: { data: true },
                        serviceName: '/test_service',
                        serviceType: 'std_srvs/srv/SetBool',
                        respondedWith: { success: true },
                    }),
                },
            ],
        ]);
        
        expect(result).toBeDefined();
        if (result && result.closeFunction) {
            await result.closeFunction();
            expect(mockUnsubscribe).toHaveBeenCalled();
            expect(RosBridgeService.close).toHaveBeenCalled();
        }
    });
});
