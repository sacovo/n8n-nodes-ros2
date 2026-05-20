FROM n8nio/runners:2.21.5

USER root
RUN cd /opt/runners/task-runner-javascript && pnpm add moment uuid
# RUN cd /opt/runners/task-runner-python && uv pip install numpy pandas polars scipy matplotlib seaborn
COPY docker/runner/n8n-task-runners.json /etc/n8n-task-runners.json
USER runner
