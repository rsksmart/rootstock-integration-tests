FROM kylemanna/bitcoind:latest AS builder

RUN apt-get update \
    && apt-get install -y wget gnupg2 curl git

# -- nodeJs ---------------------------------------------------------
ENV NODE_VERSION  v20.14.0
RUN mkdir -p /usr/local/nvm
ENV NVM_DIR /usr/local/nvm

RUN  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash \
     && . $NVM_DIR/nvm.sh \
     &&  nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default

ENV NODE_PATH $NVM_DIR/$NODE_VERSION/lib/node_modules
ENV PATH $NVM_DIR/versions/node/$NODE_VERSION/bin:$PATH

# -- java ---------------------------------------------------------
ENV JAVA_VERSION 11

RUN apt-get  -y install "openjdk-$JAVA_VERSION-jdk"

ENV JAVA_HOME=/opt/java/openjdk \
    PATH="/opt/java/openjdk/bin:$PATH"

# -- python ---------------------------------------------------------
ENV PYTHON_VERSION=2.7.16

# Install dependencies
RUN apt-get update \
  && apt-get install -y  gcc make openssl libffi-dev libgdbm-dev libsqlite3-dev libssl-dev zlib1g-dev \
  && apt-get clean

RUN export PREVIOUS_PATH=$(pwd)
RUN cd /tmp

# Build Python from source
RUN wget https://www.python.org/ftp/python/$PYTHON_VERSION/Python-$PYTHON_VERSION.tgz \
  && tar --extract -f Python-$PYTHON_VERSION.tgz \
  && cd ./Python-$PYTHON_VERSION/ \
  && ./configure --with-ensurepip=install --enable-optimizations --prefix=/usr/local \
  && make && make install \
  && cd ../ \
  && rm -r ./Python-$PYTHON_VERSION*

RUN python --version \
  && pip --version

RUN cd $PREVIOUS_PATH

# -- bitcoind ---------------------------------------------------------
COPY entrypoint_bitcoind.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["31591", "http://localhost:31592", "0.0.0.0:32591", "0.0.0.0/0", "admin", "admin"]

FROM builder AS rit-tests
LABEL Description="Custom RSK node image to execute Rootstock Integration Tests"

