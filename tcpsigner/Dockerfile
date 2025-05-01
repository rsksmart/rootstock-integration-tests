FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y procps libsecp256k1-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /tcpsigner-bundle

COPY bin bin
COPY entrypoint.sh entrypoint.sh
COPY key.json key.json

RUN tar xzf bin/manager-tcp.tgz -C bin/

RUN chmod +x entrypoint.sh \
    && chmod +x bin/tcpsigner \
    && chmod +x bin/manager-tcp

CMD ["./entrypoint.sh"]
