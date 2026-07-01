FROM node:20-alpine

WORKDIR /app

# 仅复制依赖声明，利用构建缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 复制全部源码
COPY . .

# 创建非 root 用户
RUN addgroup -S claudio && adduser -S claudio -G claudio
RUN mkdir -p /app/state/tts-cache && chown -R claudio:claudio /app/state
USER claudio

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:8080/api/health || exit 1

CMD ["node", "--env-file-if-exists=.env", "server.js"]
