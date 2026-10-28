# Jérôme Director (D153), the coordinator of the Macs, on the server. Written by hand on the official Node 24 image:
# Jérôme has no dependencies, so the image is the package's own files and nothing else. It runs as the image's
# unprivileged `node` user, and keeps its data, the Director's keys included, in the /data volume.
FROM node:24-slim
WORKDIR /opt/jerome
COPY package.json LICENSE ./
COPY bin ./bin
COPY src ./src
COPY migrations ./migrations
COPY template ./template
COPY viewer ./viewer
RUN chmod +x bin/jerome.js && ln -s /opt/jerome/bin/jerome.js /usr/local/bin/jerome \
  && mkdir -p /data && chown node:node /data
USER node
ENV XDG_DATA_HOME=/data \
    JEROME_DIRECTOR_LISTEN=0.0.0.0:7788
VOLUME /data
EXPOSE 7788
CMD ["jerome", "director", "serve"]
