FROM node:20-alpine

WORKDIR /app

# 仅复制依赖声明，利用构建缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 复制全部源码
COPY . .

# 创建非 root 用户
RUN addgroup -S claudio && adduser -S claudio -G claudio
RUN chown -R claudio:claudio /app/state
USER claudio

EXPOSE 8080

CMD ["node", "--env-file-if-exists=.env", "server.js"]
