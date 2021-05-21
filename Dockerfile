# syntax=docker/dockerfile:1.0.0-experimental

FROM node:14.15.3  

RUN apt-get install git openssh-client

WORKDIR /usr/src/app
COPY package.json .
RUN mkdir -p -m 0600 ~/.ssh && ssh-keyscan version.aalto.fi >> ~/.ssh/known_hosts

RUN --mount=type=ssh,id=version_aalto npm install
COPY server.js .
COPY . .

ENTRYPOINT [ "node", "server.js" ]