FROM ubuntu:24.04

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update && \
    apt-get install -y procps libsecp256k1-dev && \
    apt-get clean

WORKDIR /tcpsigner-bundle

COPY bin bin
COPY entrypoint.sh entrypoint.sh
COPY key.json key.json

RUN tar xzf bin/manager-tcp.tgz -C bin/ && \
    chmod +x entrypoint.sh && \
    chmod +x bin/tcpsigner && \
    chmod +x bin/manager-tcp

CMD ["./entrypoint.sh"]
