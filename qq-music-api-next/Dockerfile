FROM node:18-alpine

LABEL maintainer="Rain120 <1085131904@qq.com>"

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --registry=https://registry.npmmirror.com

COPY scripts ./scripts
COPY src ./src
COPY public ./public
COPY tsconfig.json ./

EXPOSE 3200

CMD ["node", "-r", "ts-node/register/transpile-only", "src/app.ts"]
