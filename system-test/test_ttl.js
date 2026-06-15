import { Ros, Topic } from 'roslib';
import { execSync } from 'child_process';

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRos2TopicInfo(topicName) {
    try {
        const out = execSync(`docker compose exec -T ros2 bash -c "source /opt/ros/jazzy/setup.bash && ros2 topic info ${topicName}"`, {
            cwd: '/home/sandro/work/fhnw/rover/@fhnw-rover/n8n-nodes-ros2/system-test'
        });
        return out.toString().trim();
    } catch (err) {
        return `Error: ${err.message}`;
    }
}

async function main() {
    console.log("Connecting to rosbridge...");
    const ros = new Ros({ url: 'ws://localhost:9090' });
    
    await new Promise((resolve, reject) => {
        ros.on('connection', () => resolve());
        ros.on('error', (err) => reject(err));
    });
    console.log("Connected!");

    const topicName = '/n8n_test_dynamic_topic';
    const topic = new Topic({
        ros,
        name: topicName,
        messageType: 'std_msgs/String'
    });

    console.log("Advertising topic...");
    topic.advertise();
    await sleep(2000);

    console.log("Topic info after advertise:\n", getRos2TopicInfo(topicName));

    console.log("Unadvertising topic...");
    topic.unadvertise();
    
    console.log("Waiting 12 seconds for rosbridge unregister_timeout (10s) and DDS discovery propagation...");
    await sleep(12000);

    console.log("Topic info after 12s sleep:\n", getRos2TopicInfo(topicName));

    console.log("Closing connection...");
    ros.close();
}

main().catch(console.error);
