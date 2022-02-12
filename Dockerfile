FROM node:16.13-alpine as base

RUN apk --no-cache add git

WORKDIR /usr/src/app

COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
COPY index.ts ./

RUN npm install

RUN npm run build


FROM base AS dependencies

WORKDIR /usr/src/app

COPY package.json ./
COPY ecosystem.config.js ./


RUN npm set progress=false && \
    npm config set depth 0 && \
    npm install --only=production && \
    npm install pm2 -g

COPY --from=base /usr/src/app/build ./build


CMD ["pm2-runtime", "ecosystem.config.js", "--env", "development"]